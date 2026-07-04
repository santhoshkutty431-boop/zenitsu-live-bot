/**
 * Semantic anti-spam / anti-scam detector.
 *
 * Complements the regex-based rules in modules/security.js by catching
 * *variants* of known scams — obfuscated characters, unicode homoglyphs,
 * slight rewordings — that a regex would miss.
 *
 * Flow per incoming message:
 *   1. Cheap prefilter: skip if too short, from staff, or clearly benign.
 *   2. Embed the message (OpenAI text-embedding-3-small).
 *   3. Cosine-compare against all known spam signatures for this guild
 *      (guild-specific + shipped globals).
 *   4. If any signature scores above its threshold → HIT.
 *
 * Never throws: any error yields "no hit" so a broken API doesn't accidentally
 * unblock or block traffic. The main security path is unaffected.
 */

'use strict';

const https = require('https');

const MIN_MESSAGE_CHARS = 12;   // ignore ultra-short messages (no signal)
const MAX_MESSAGE_CHARS = 500;  // truncate long walls of text before embedding
const EMBEDDING_MODEL   = 'text-embedding-3-small';
const EMBEDDING_TIMEOUT = 4000; // ms — never block message flow for long

// Recent-message dedupe cache — same content within 60s hits the same verdict
// without re-embedding. Small LRU keyed by SHA-ish string hash.
const VERDICT_CACHE = new Map();
const CACHE_TTL_MS   = 60_000;
const CACHE_MAX_SIZE = 500;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

function cacheKey(text) {
  // FNV-1a hash — good enough for a message-dedupe cache
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h.toString(36);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embed via Gemini (free tier) — 768-dim vectors from gemini-embedding-001.
 * Chosen over OpenAI because Gemini's embedding API has generous free quota
 * and this feature must work even when the OpenAI account is billed out.
 * All signatures + query vectors use the same provider, so dimensions match.
 */
async function embedViaGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const body = JSON.stringify({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text }] }
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: EMBEDDING_TIMEOUT
    }, (res) => {
      let chunks = '';
      res.on('data', d => (chunks += d));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          const vec = parsed?.embedding?.values;
          resolve(Array.isArray(vec) ? vec : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function embed(text) {
  return embedViaGemini(text);
}

/**
 * Main entry — check a single message against known spam signatures.
 * @param {import('discord.js').Message} message
 * @param {object} deps  { dbService, staffCheck, logger }
 * @returns {Promise<null | { hit: true, label: string, score: number, threshold: number, signatureId: number }>}
 */
async function checkMessage(message, deps) {
  const { dbService, staffCheck, logger } = deps;

  try {
    // Prefilters — cheap, fast, keep them first.
    if (!message || !message.content || message.author?.bot) return null;
    const text = normalize(message.content);
    if (text.length < MIN_MESSAGE_CHARS) return null;

    // Staff and admins bypass so a mod can *talk about* a scam without triggering.
    if (message.member && typeof staffCheck === 'function' && staffCheck(message.member)) {
      return null;
    }

    const guildId = message.guildId;
    if (!guildId) return null;

    const signatures = dbService.listSpamSignatures(guildId);
    if (!signatures || signatures.length === 0) return null;

    // Cache check
    const key = `${guildId}:${cacheKey(text)}`;
    const cached = VERDICT_CACHE.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.verdict;
    }

    // Embed once
    const trimmed = text.slice(0, MAX_MESSAGE_CHARS);
    const vec = await embed(trimmed);
    if (!vec) {
      // Embedding unavailable — don't block traffic, just skip.
      return null;
    }

    let hit = null;
    let bestScore = 0;
    for (const sig of signatures) {
      let sigVec;
      try { sigVec = JSON.parse(sig.vector_json); }
      catch { continue; }

      const score = cosineSimilarity(vec, sigVec);
      if (score > bestScore) bestScore = score;

      const threshold = Number(sig.threshold) || 0.82;
      if (score >= threshold && (!hit || score > hit.score)) {
        hit = {
          hit: true,
          label: sig.label,
          score,
          threshold,
          signatureId: sig.id
        };
      }
    }

    const verdict = hit || null;
    setCache(key, verdict);

    if (hit && logger) {
      logger.info(`[SEMANTIC SPAM] Match "${hit.label}" score=${hit.score.toFixed(3)} thr=${hit.threshold} user=${message.author?.id}`);
    }

    return verdict;
  } catch (err) {
    // Never throw — this must be safe to call from every messageCreate.
    if (deps?.logger) deps.logger.warn(`[SEMANTIC SPAM] check failed: ${err.message}`);
    return null;
  }
}

function setCache(key, verdict) {
  if (VERDICT_CACHE.size >= CACHE_MAX_SIZE) {
    // Drop oldest — Map iteration order is insertion order.
    const firstKey = VERDICT_CACHE.keys().next().value;
    VERDICT_CACHE.delete(firstKey);
  }
  VERDICT_CACHE.set(key, { verdict, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Helper for /spam-signature add — embeds a sample and stores it.
 * @returns {Promise<{ok: true, id: number} | {ok: false, error: string}>}
 */
async function addSignature({ dbService, guildId, label, sampleText, threshold, addedBy }) {
  const text = normalize(sampleText);
  if (text.length < MIN_MESSAGE_CHARS) {
    return { ok: false, error: `Sample too short (min ${MIN_MESSAGE_CHARS} chars).` };
  }
  const vec = await embed(text.slice(0, MAX_MESSAGE_CHARS));
  if (!vec) {
    return { ok: false, error: 'Failed to generate embedding (OPENAI_API_KEY missing or API error).' };
  }
  const id = dbService.addSpamSignature({
    guildId,
    label,
    sampleText: text,
    vector: vec,
    threshold,
    addedBy
  });
  return { ok: true, id };
}

// Default global scam patterns shipped with the bot. Embedded on first
// startup (once OPENAI_API_KEY is available) and reused across all guilds.
const DEFAULT_SIGNATURES = [
  { label: 'nitro-scam-gift',      threshold: 0.80, sample: 'Free Discord Nitro giveaway! Click here to claim your 3 months of Nitro for free: discord-nitro.gift' },
  { label: 'nitro-scam-airdrop',   threshold: 0.80, sample: 'Steam is giving away free games and nitro! Get yours here before the offer ends' },
  { label: 'steam-scam-report',    threshold: 0.80, sample: 'Hey I accidentally reported you on Steam, please help me remove the report, contact the moderator here' },
  { label: 'crypto-airdrop-scam',  threshold: 0.82, sample: 'You have been selected for a crypto airdrop! Connect your wallet at this link to claim 0.5 ETH' },
  { label: 'onlyfans-dm-spam',     threshold: 0.82, sample: 'Hey cutie, check out my OnlyFans page for exclusive content, link in my bio' },
  { label: 'server-invite-spam',   threshold: 0.85, sample: 'Join my server for free rewards, giveaways and nitro drops, invite link discord.gg' },
  { label: 'phishing-account',     threshold: 0.82, sample: 'Your Discord account will be terminated within 24 hours due to policy violation, verify your account here to avoid deletion' },
  { label: 'trading-scam',         threshold: 0.82, sample: 'I made 10000 dollars trading crypto in one week, DM me if you want to learn my strategy for free' },
];

/**
 * Idempotent seed of the DEFAULT_SIGNATURES table. Called from Runtime after
 * DatabaseManager + AIProviderManager are ready. Skips if already seeded or
 * if OPENAI_API_KEY is missing.
 */
async function seedDefaults({ dbService, logger }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      if (logger) logger.info('[SEMANTIC SPAM] Skipping seed: OPENAI_API_KEY not set.');
      return;
    }

    const existing = dbService.sqlDb.prepare(
      "SELECT COUNT(*) AS n FROM spam_signatures WHERE guild_id = '_global'"
    ).get().n;
    if (existing > 0) return; // already seeded

    if (logger) logger.info(`[SEMANTIC SPAM] Seeding ${DEFAULT_SIGNATURES.length} default signatures...`);
    let inserted = 0;
    for (const sig of DEFAULT_SIGNATURES) {
      const vec = await embed(sig.sample);
      if (!vec) continue;
      dbService.addSpamSignature({
        guildId: '_global',
        label: sig.label,
        sampleText: sig.sample,
        vector: vec,
        threshold: sig.threshold,
        addedBy: 'system'
      });
      inserted++;
    }
    // Force an immediate cloud flush so a subsequent HF pull doesn't
    // clobber the freshly-seeded rows on next boot.
    if (typeof dbService.flushToHf === 'function') {
      try { await dbService.flushToHf(); }
      catch (err) { if (logger) logger.warn(`[SEMANTIC SPAM] flushToHf failed: ${err.message}`); }
    }
    if (logger) logger.info(`[SEMANTIC SPAM] ${inserted}/${DEFAULT_SIGNATURES.length} default signatures seeded and pushed to cloud.`);
  } catch (err) {
    if (logger) logger.warn(`[SEMANTIC SPAM] Seed failed: ${err.message}`);
  }
}

module.exports = {
  checkMessage,
  addSignature,
  seedDefaults,
  DEFAULT_SIGNATURES,
  _internals: { normalize, cosineSimilarity, embed }
};
