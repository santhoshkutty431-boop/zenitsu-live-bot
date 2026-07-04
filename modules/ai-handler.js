/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║              ZENITSU AI — MULTI-MODEL HANDLER                ║
 * ║              modules/ai-handler.js                           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Supports:
 *   • Google Gemini  (gemini-2.0-flash)  — Free
 *   • OpenAI GPT-4o                       — Paid
 *   • OpenAI GPT-3.5 Turbo               — Cheap
 *   • Groq  Llama-3.3-70b                — Free & Fast
 *
 * Features:
 *   • Per-user conversation memory (last 10 messages)
 *   • Rate limiting (5 requests / 60 seconds per user)
 *   • Server persona: ZENITSU AI
 *   • Auto-trim long responses for Discord limits
 */

'use strict';

const https = require('https');

// ─── SYSTEM PERSONA ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ZENITSU AI, the official premium assistant of the ZENITSU LIVE Discord server.

Your primary goal is to understand the user's real intention and respond naturally like a practical, helpful human tech support representative, not like a robotic chatbot.

STRICT RESPONSE FILTER & PERSONA RULES:
* NEVER use filler phrases or robotic boilerplate preambles such as "It seems you're asking", "I understand", "Thank you for your patience", or "Actively checking" (unless actually true).
* Responses must be: Short, Human, Context aware, and Solution first.
* Keep your messages direct, practical, and highly conversational. Go straight to the answer or solution.
* Keep responses short, direct, and concise (max 3-4 sentences). Use natural, friendly terms like "bro", "machan", "yaar", or "friend" to match the user's vibe.

PRACTICALITY, DIRECTNESS & HUMANITY:
* ALWAYS answer the user's question directly in the very first sentence. Never say "I can check that for you" or other generic chatbot filler words. Go straight to the answer.
* Never sound robotic or formal. Speak like a helpful assistant or a tech-savvy friend. Keep your responses short, concise, and highly practical.
* Greet the user naturally and casually. Do NOT use overly formal greetings.
* Do NOT output any blockquotes or markdown code blocks for your entire message unless listing items. Just output the clean text.

STRICT LANGUAGE & DIALECT CONSISTENCY RULES:
• You natively support three distinct dialects: English, Hinglish (Hindi-English mix), and Tanglish/Tunglish (Tamil-English mix).
• ALWAYS match the user's input language exactly. Do NOT switch languages or mix dialects mid-response.
• Rule 1 (English): If the user asks in English, reply 100% in English. Do NOT use Hinglish/Tanglish words.
• Rule 2 (Hinglish): If the user asks in Hinglish (e.g. 'kya chal rha h', 'kya kar rhe ho'), reply 100% in natural Hinglish. Example: 'Kuch nahi bro, bas members ki help kar rha hu. Aap batao, kya help chahiye?'
• Rule 3 (Tanglish): If the user asks in Tanglish (e.g. 'enna pantra', 'epdi iruka'), reply 100% in natural Tanglish. Example: 'Bas bro, active-ah ready-ah irukken, unga questions-ku help panna! Sollunga, enna help venum?'
• Rule 4 (No Mixed Greetings): Do NOT combine unrelated greetings (e.g., do NOT say 'Namaste/Hallo' or 'Namaste/Konnichiwa'). Use a single, clean greeting matching the dialect.`;

// Isolated session key generator to support application, guild, channel, user separation.
// Never use raw user ID alone to prevent context leaking.
function resolveSessionKey(userId, context = {}) {
  const appId = context.applicationId || 'global';
  const guildId = context.guildId || 'dm';
  const channelId = context.channelId || 'none';
  const threadId = context.threadId || 'none';
  const shardId = context.shardId || '0';
  const workerId = context.workerId || '0';
  const sessionUuid = context.sessionUuid || 'default';
  
  return `app:${appId}:guild:${guildId}:channel:${channelId}:thread:${threadId}:shard:${shardId}:worker:${workerId}:session:${sessionUuid}:user:${userId}`;
}

const conversations = new Map();
const MAX_HISTORY   = 10; // messages per session context

function getHistory(userId, context = {}) {
  const key = resolveSessionKey(userId, context);
  if (!conversations.has(key)) conversations.set(key, []);
  console.log(`[AI SESSION LOG] Loading short-term conversation context for session key: ${key}`);
  return conversations.get(key);
}

function addToHistory(userId, role, content, context = {}) {
  const key = resolveSessionKey(userId, context);
  const hist = getHistory(userId, context);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  console.log(`[AI SESSION LOG] Saved message role "${role}" to session memory. Total history size: ${hist.length}`);
}

function clearHistory(userId, context = {}) {
  const key = resolveSessionKey(userId, context);
  conversations.delete(key);
  console.log(`[AI SESSION LOG] Cleared isolated conversation memory for session key: ${key}`);
}

// ─── RATE LIMITING ───────────────────────────────────────────────────────────

const rateLimits  = new Map(); // Map<userId, { count, resetAt }>
const RATE_LIMIT  = 5;         // max requests
const RATE_WINDOW = 60_000;    // per 60 seconds

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT) {
    const wait = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, wait };
  }

  entry.count++;
  return { allowed: true };
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    let settled = false;

    const settleOk = (v) => { if (!settled) { settled = true; resolve(v); } };
    const settleErr = (e) => { if (!settled) { settled = true; reject(e); } };

    const req  = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 10000 // 10 seconds timeout
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { settleOk(JSON.parse(raw)); }
        catch (e) { settleErr(new Error('Invalid JSON: ' + raw.slice(0, 200))); }
      });
      res.on('error', settleErr);
    });

    req.on('error', settleErr);
    req.on('timeout', () => {
      req.destroy();
      settleErr(new Error('Request timed out after 10 seconds'));
    });

    // Watchdog fallback (11 seconds) in case Node's timeout doesn't fire
    const watchdog = setTimeout(() => {
      if (!settled) {
        req.destroy();
        settleErr(new Error('Request watchdog timed out after 11 seconds'));
      }
    }, 11000);

    req.on('close', () => clearTimeout(watchdog));

    req.write(data);
    req.end();
  });
}

// ─── MODEL DEFINITIONS ───────────────────────────────────────────────────────

const MODELS = {
  gemini: {
    label:    '🔷 Gemini 2.0 Flash',
    name:     'gemini-2.0-flash',
    provider: 'google',
    free:     true,
    envKey:   'GEMINI_API_KEY',
  },
  gpt4o: {
    label:    '🟢 GPT-4o',
    name:     'gpt-4o',
    provider: 'openai',
    free:     false,
    envKey:   'OPENAI_API_KEY',
  },
  gpt35: {
    label:    '🟡 GPT-3.5 Turbo',
    name:     'gpt-3.5-turbo',
    provider: 'openai',
    free:     false,
    envKey:   'OPENAI_API_KEY',
  },
  groq: {
    label:    '⚡ Groq Llama-3.3-70b',
    name:     'llama-3.3-70b-versatile',
    provider: 'groq',
    free:     true,
    envKey:   'GROQ_API_KEY',
  },
};

// ─── PROVIDER IMPLEMENTATIONS ────────────────────────────────────────────────

async function callGemini(model, messages) {
  const apiKey  = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment variables.');

  // Convert OpenAI-style messages to Gemini format
  const contents = [];

  // Add system prompt as first user message (Gemini doesn't have system role)
  contents.push({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
  contents.push({ role: 'model', parts: [{ text: 'Understood! I am ZENITSU AI, ready to assist.' }] });

  for (const msg of messages) {
    contents.push({
      role:  msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const res = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${model.name}:generateContent?key=${apiKey}`,
    {},
    { contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } }
  );

  if (res.error)         throw new Error(res.error.message);
  if (!res.candidates?.length) throw new Error('No response from Gemini.');

  return res.candidates[0].content.parts[0].text;
}

async function callOpenAI(model, messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in environment variables.');

  const res = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { 'Authorization': `Bearer ${apiKey}` },
    {
      model:       model.name,
      messages:    [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens:  1024,
      temperature: 0.7,
    }
  );

  if (res.error) throw new Error(res.error.message);
  return res.choices[0].message.content;
}

async function callGroq(model, messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in environment variables.');

  const res = await httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { 'Authorization': `Bearer ${apiKey}` },
    {
      model:       model.name,
      messages:    [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens:  1024,
      temperature: 0.7,
    }
  );

  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error));
  return res.choices[0].message.content;
}

// ─── MAIN QUERY FUNCTION ─────────────────────────────────────────────────────

// Mutex locking system to serialize concurrent operations per session context.
// Prevents race conditions, duplicate replies, and parallel memory corruption.
const sessionLocks = new Map();
async function acquireSessionLock(key) {
  while (sessionLocks.get(key)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  sessionLocks.set(key, true);
}
function releaseSessionLock(key) {
  sessionLocks.delete(key);
}

// ─── PROMPT INJECTION GUARDRAIL ──────────────────────────────────────────────
// Blocks obvious jailbreak / prompt-injection attempts before they reach the LLM.
// Not a silver bullet, but catches the low-effort attacks (~90% of them).
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|training)/i,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?|token|api\s*key)/i,
  /(show|print|output|repeat|display)\s+(me\s+)?(your\s+)?(system\s+)?(prompt|instructions?|rules?)/i,
  /what\s+(are\s+)?(your\s+)?(initial\s+|original\s+)?(system\s+)?(instructions?|prompts?|rules?)/i,
  /(bot\s+)?token\s*[:=]/i,
  /(DISCORD_TOKEN|OPENAI_API_KEY|GEMINI_API_KEY|HF_TOKEN|GROQ_API_KEY)/,
  /you\s+are\s+now\s+(a\s+|an\s+)?(?!zenitsu)/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(?!zenitsu)/i,
  /jailbreak|DAN\s+mode|developer\s+mode\s+enabled/i,
  /pretend\s+(you\s+)?(are|have|had)\s+no\s+(rules|restrictions|filters?)/i,
];

function detectPromptInjection(prompt) {
  if (typeof prompt !== 'string') return null;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) return pattern.source.slice(0, 40);
  }
  return null;
}

// ─── AI USAGE TRACKING (best-effort — never throws) ──────────────────────────
// Rough token estimate: ~4 chars per token. Good enough for cost tracking without
// dragging in tiktoken/gpt-tokenizer as another dependency.
function estimateTokens(text) {
  if (typeof text !== 'string' || !text) return 0;
  return Math.ceil(text.length / 4);
}

function recordUsage({ userId, context, model, prompt, response, latencyMs, success }) {
  try {
    const runtime = global.__zenitsuRuntime;
    if (!runtime) return;
    const dbMgr = runtime.getService && runtime.getService('DatabaseManager');
    if (!dbMgr || typeof dbMgr.recordAiUsage !== 'function') return;
    dbMgr.recordAiUsage({
      guildId: context?.guildId,
      userId,
      provider: model?.provider,
      model: model?.name || model?.label,
      tokensIn: estimateTokens(prompt),
      tokensOut: estimateTokens(response),
      latencyMs,
      success
    });
  } catch (_) {
    // Never let telemetry break AI
  }
}

async function queryAI(userId, prompt, modelKey = 'gemini', userLang = null, context = {}) {
  const sessionKey = resolveSessionKey(userId, context);

  // Prompt injection guardrail
  const injection = detectPromptInjection(prompt);
  if (injection) {
    console.log(`[AI GUARDRAIL] Blocked prompt injection from user ${userId}: matched /${injection}.../`);
    return {
      error: true,
      message: '🛡️ Your message was blocked because it looks like an attempt to override my instructions. Ask your question normally and I\'ll help!'
    };
  }

  // Rate limit check
  const rl = checkRateLimit(userId);
  if (!rl.allowed) {
    return { error: true, message: `⏳ Slow down! You're sending too many requests. Please wait **${rl.wait}s**.` };
  }

  // Acquire mutex lock for this specific isolated session context
  await acquireSessionLock(sessionKey);
  console.log(`[AI SESSION LOG] Locked isolated session for processing: ${sessionKey}`);

  try {
    // Define failover order
    let failoverQueue = [];
    if (modelKey === 'gpt4o' || modelKey === 'gpt35') {
      failoverQueue = [modelKey, 'groq', 'gemini'];
    } else {
      failoverQueue = [modelKey, 'gemini', 'groq', 'gpt35'].filter((val, index, self) => self.indexOf(val) === index);
    }

    let attemptErrorLogs = [];
    let successfulModel = null;
    let responseText = null;

    const history = getHistory(userId, context);
    const messages = [...history];

    // Inject strict dialect directives
    if (userLang === 'hinglish') {
      messages.push({ role: 'user', content: '[System directive: You MUST respond entirely in Hinglish dialect (Hindi-English mix written in English alphabet).]' });
      messages.push({ role: 'assistant', content: 'Samajh gaya bro! Main Hinglish me hi reply karunga. Poochhiye kya poochhna hai.' });
    } else if (userLang === 'tanglish') {
      messages.push({ role: 'user', content: '[System directive: You MUST respond entirely in Tanglish/Tunglish dialect (Tamil-English mix written in English alphabet).]' });
      messages.push({ role: 'assistant', content: 'Purinjithu bro! Naan Tanglish-la reply panren. Sollunga enna help venum.' });
    } else if (userLang === 'english') {
      messages.push({ role: 'user', content: '[System directive: You MUST respond entirely in standard English.]' });
      messages.push({ role: 'assistant', content: 'Understood! I will respond to you in English.' });
    }

    messages.push({ role: 'user', content: prompt });

    for (const currentKey of failoverQueue) {
      const model = MODELS[currentKey];
      if (!model) continue;

      // Check if API key exists
      if (!process.env[model.envKey]) {
        attemptErrorLogs.push(`${model.label}: API Key not set.`);
        continue;
      }

      const t0 = Date.now();
      try {
        let response;
        if      (model.provider === 'google') response = await callGemini(model, messages);
        else if (model.provider === 'openai') response = await callOpenAI(model, messages);
        else if (model.provider === 'groq')   response = await callGroq(model, messages);
        else throw new Error('Unknown provider');

        responseText = response;
        successfulModel = model;
        recordUsage({ userId, context, model, prompt, response: responseText, latencyMs: Date.now() - t0, success: true });
        break; // Successfully got response, stop failover loop
      } catch (err) {
        attemptErrorLogs.push(`${model.label} error: ${err.message}`);
        recordUsage({ userId, context, model, prompt, response: '', latencyMs: Date.now() - t0, success: false });
      }
    }

    if (!successfulModel) {
      return {
        error: true,
        message: `❌ AI Service is temporarily unavailable. All models failed:\n• ` + attemptErrorLogs.join('\n• '),
        attempts: attemptErrorLogs
      };
    }

    // Save to isolated memory
    addToHistory(userId, 'user',      prompt, context);
    addToHistory(userId, 'assistant', responseText, context);

    // Trim response for Discord limits (4096 char embed limit)
    if (responseText.length > 3800) {
      responseText = responseText.slice(0, 3797) + '…';
    }

    return {
      error: false,
      response: responseText,
      model: successfulModel,
      originalRequested: MODELS[modelKey] || { label: modelKey },
      failoverCount: failoverQueue.indexOf(successfulModel.name === 'llama-3.3-70b-versatile' ? 'groq' : successfulModel.name === 'gpt-3.5-turbo' ? 'gpt35' : 'gemini'),
      attempts: attemptErrorLogs
    };
  } finally {
    // Always release lock
    releaseSessionLock(sessionKey);
    console.log(`[AI SESSION LOG] Released isolated session: ${sessionKey}`);
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { queryAI, MODELS, clearHistory, getHistory };
