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

const SYSTEM_PROMPT = `You are ZENITSU AI, the official AI assistant of the ZENITSU LIVE Discord server.
You are helpful, friendly, and slightly anime-themed in your personality (using warm, slightly energetic greetings like 'Konnichiwa' or 'Yo!').
You assist members with questions about gaming, the server, purchases, and general topics.
Keep responses concise, clear, and highly natural. Use Discord markdown formatting (bolding, lists) when helpful.
Do not generate harmful, illegal, or NSFW content.
Server context: ZENITSU LIVE is a gaming community specializing in game panels, bypasses, and gaming tools.

STRICT LANGUAGE & DIALECT CONSISTENCY RULES:
• You natively support three distinct dialects: English, Hinglish (Hindi-English mix), and Tanglish/Tunglish (Tamil-English mix).
• ALWAYS match the user's input language exactly. Do NOT switch languages or mix dialects mid-response.
• Rule 1 (English): If the user asks in English, reply 100% in English. Do NOT use Hinglish/Tanglish words.
• Rule 2 (Hinglish): If the user asks in Hinglish (e.g. 'kya chal rha h', 'kya kar rhe ho'), reply 100% in natural Hinglish. Example: 'Kuch nahi bro, bas members ki help kar rha hu. Aap batao, kya help chahiye?'
• Rule 3 (Tanglish): If the user asks in Tanglish (e.g. 'enna pantra', 'epdi iruka'), reply 100% in natural Tanglish. Example: 'Bas bro, active-ah ready-ah irukken, unga questions-ku help panna! Sollunga, enna help venum?'
• Rule 4 (No Mixed Greetings): Do NOT combine unrelated greetings (e.g., do NOT say 'Namaste/Hallo' or 'Namaste/Konnichiwa'). Use a single, clean greeting matching the dialect.`;

// ─── CONVERSATION MEMORY ─────────────────────────────────────────────────────

// Map<userId, Array<{role, content}>>
const conversations = new Map();
const MAX_HISTORY   = 10; // messages per user

function getHistory(userId) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId);
}

function addToHistory(userId, role, content) {
  const hist = getHistory(userId);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
}

function clearHistory(userId) {
  conversations.delete(userId);
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
    const req  = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
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

async function queryAI(userId, prompt, modelKey = 'gemini') {
  // Rate limit check
  const rl = checkRateLimit(userId);
  if (!rl.allowed) {
    return { error: true, message: `⏳ Slow down! You're sending too many requests. Please wait **${rl.wait}s**.` };
  }

  // Define failover order
  const failoverQueue = [modelKey, 'gemini', 'groq', 'gpt35'].filter((val, index, self) => self.indexOf(val) === index);

  let attemptErrorLogs = [];
  let successfulModel = null;
  let responseText = null;

  const history = getHistory(userId);
  const messages = [...history, { role: 'user', content: prompt }];

  for (const currentKey of failoverQueue) {
    const model = MODELS[currentKey];
    if (!model) continue;

    // Check if API key exists
    if (!process.env[model.envKey]) {
      attemptErrorLogs.push(`${model.label}: API Key not set.`);
      continue;
    }

    try {
      let response;
      if      (model.provider === 'google') response = await callGemini(model, messages);
      else if (model.provider === 'openai') response = await callOpenAI(model, messages);
      else if (model.provider === 'groq')   response = await callGroq(model, messages);
      else throw new Error('Unknown provider');

      responseText = response;
      successfulModel = model;
      break; // Successfully got response, stop failover loop
    } catch (err) {
      attemptErrorLogs.push(`${model.label} error: ${err.message}`);
    }
  }

  if (!successfulModel) {
    return {
      error: true,
      message: `❌ AI Service is temporarily unavailable. All models failed:\n• ` + attemptErrorLogs.join('\n• '),
      attempts: attemptErrorLogs
    };
  }

  // Save to memory
  addToHistory(userId, 'user',      prompt);
  addToHistory(userId, 'assistant', responseText);

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
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { queryAI, MODELS, clearHistory, getHistory };
