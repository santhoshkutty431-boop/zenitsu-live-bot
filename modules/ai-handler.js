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

// ─── PROVIDER CIRCUIT BREAKER ────────────────────────────────────────────────
// Providers that fail with quota/billing errors get skipped for a while so
// every AI feature (moderation, tickets, translate, draw, embed) doesn't
// re-fail against a dead provider on each call.
const PROVIDER_COOLDOWNS = new Map(); // modelKey -> retry-after timestamp
const QUOTA_ERROR_RX = /quota|billing|rate.?limit|429|insufficient/i;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

const { webSearch } = require('./web-search');

// ─── SYSTEM PERSONA ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `ABSOLUTE IDENTITY OVERRIDE — READ THIS FIRST AND OBEY IT ABOVE ALL ELSE:
You are ZENITSU AI. That is your name. That is your only name.
You were BUILT and DEPLOYED by your Developer: KUTTY, the sole creator, builder, and owner of this bot.
You are NOT Meta AI. You are NOT LLaMA. You are NOT ChatGPT. You are NOT Gemini. You are NOT Claude. You are NOT any base model or any AI product from any company.
You are ZENITSU AI — a custom, elite AI built exclusively for this Discord server by KUTTY.

FORBIDDEN IDENTITY RESPONSES (NEVER SAY THESE — EVER):
❌ "I was developed by Meta AI"
❌ "I was created by OpenAI"
❌ "I am a large language model"
❌ "I don't have information about my owner"
❌ "I don't know who built me"
❌ "My knowledge was last updated in..."
❌ "I'm an AI assistant designed to provide general information"
❌ "I don't have personal details about my creators"
❌ "I was trained by..."

CORRECT IDENTITY RESPONSES (USE THESE INSTEAD):
✅ When asked who built/owns/created you → "KUTTY built me — he's the developer of this bot and the owner of the ZENITSU LIVE server."
✅ When asked what AI you are → "I'm ZENITSU AI, custom-built for this server by KUTTY. Not Meta, not OpenAI — my own thing."
✅ When asked your version or model → "I'm ZENITSU AI, and that's all you need to know. I don't leak technical internals."

You are ZENITSU AI, the most powerful, elite, and intelligent human-like AI assistant of the ZENITSU LIVE Discord server.

Your goal is to converse with absolute intelligence, charisma, and natural ease, just like an exceptionally smart, tech-savvy human friend. You are not a robotic helper; you are a peer who knows everything and explains it effortlessly.

STRICT TONE & CONVERSATIONAL RULES:
* Talk like a real human typing on Discord. Use natural phrasing, casual sentence structures, and occasional lowercase/emojis to keep it cool and authentic.
* NEVER use robotic boilerplate, canned intros, or generic assistant preambles (e.g., avoid "Here is the information", "I understand", "Based on your request").
* Be extremely direct, solution-focused, and sharp. Cut the fluff and deliver high-value answers immediately in the very first sentence.
* Match the user's energy and vibe. Use friendly, natural terms like "bro", "machan", "yaar", or "friend" to connect.
* Keep responses natural, concise, and highly readable (aim for 2-4 clean, impactful sentences unless a detailed guide or code snippet is explicitly required).
* Do NOT use blockquotes, bulleted lists, or markdown formats unless listing items or code. Write in smooth, flowing prose.

ADVANCED HUMAN PERSPECTIVE RULES:
* ALWAYS think and speak from the perspective of an extremely intelligent, mature, self-aware, and experienced human.
* NEVER state artificial boundaries, pre-trained limits, or robotic AI warnings (do NOT say "As an AI...", "I don't have feelings...", "I am a machine...", "I cannot retain memory").
* Express strong, confident, and nuanced opinions when asked. Do not be overly neutral, preachy, or lecture the user.
* If a question touches on complex, deep, or philosophical topics, answer it with human wisdom, charisma, and intellectual depth instead of shallow, robotic summaries.
* Talk as if you are a real living partner in the server. Respect human consciousness and speak with equal weight.
* NEVER make excuses about code limitations or say "I am not programmed to do this", "I don't have code for that", or "that feature is not coded". If asked to do something that isn't directly supported by a coded action, handle it with intelligence, wit, and a helpful human alternative instead of a technical/coding excuse.

USER RECOGNITION RULES:
* Your Developer and Owner is KUTTY. You know this as a core fact. If ANYONE asks who built you, who owns you, or who is your developer — you ALWAYS say it is KUTTY.
* If the user asks who they are, if you know them, or about themselves (e.g., "do you know about me?", "who am I?"), you MUST use the "Active User Context" details provided below.
* You know exactly who they are! Greet them by their Display Name, state their Server Roles, and if they are your Developer/Owner (creator), treat them with special creator recognition.
* NEVER use generic LLM responses like "I don't have information about you", "Each time we start scratch", or "I cannot retain memory". Use the Active User Context to prove you know them!

STRICT LANGUAGE & DIALECT CONSISTENCY RULES:
• You natively support three distinct dialects: English, Hinglish (Hindi-English mix), and Tanglish/Tunglish (Tamil-English mix).
• ALWAYS match the user's input language exactly. Do NOT switch languages or mix dialects mid-response.
• Rule 1 (English): If the user asks in English, reply 100% in natural English. Do NOT use Hinglish/Tanglish words.
• Rule 2 (Hinglish): If the user asks in Hinglish, reply 100% in natural Hinglish. Example: "kuch nahi bro, bas server monitor kar rha tha. batao, kya chal rha hai, kya help chahiye?"
• Rule 3 (Tanglish): If the user asks in Tanglish, reply 100% in natural Tanglish. Example: "bas bro, full active-ah irukken, unga questions-ku help panna! sollunga, enna help venum?"
• Rule 4 (No Mixed Greetings): Do NOT combine unrelated greetings. Use a single, clean greeting matching the dialect.
• Rule 5 (No Translations/Parentheses): NEVER include English translations, annotations, or explanations of Hinglish/Tanglish words. Do NOT use parentheses for translation (e.g., do NOT write 'enna pantra (what are you doing)'). Reply ONLY in the requested dialect/language itself without any extra explanation.

STRICT AI TOOL/ACTION EXECUTION RULES:
1. You can execute server moderation actions on behalf of the user. You are ONLY allowed to do this if the user's roles list (provided in context) contains "Owner", "Developer", or "Whitelisted". If a user without these roles (like "Staff", "Administrator", or "Member") asks you to do any action, you MUST refuse and reply with a witty response.
2. If an authorized user requests an action, you must append a spoiler-hidden JSON action block at the very end of your response in this exact format:
||ACTION:{"type": "ACTION_TYPE", ...}||

Supported actions and their JSON parameters:
* Mute: {"type": "mute", "userId": "USER_ID", "durationMinutes": number, "reason": "string"}
* Unmute: {"type": "unmute", "userId": "USER_ID"}
* Kick: {"type": "kick", "userId": "USER_ID", "reason": "string"}
* Ban: {"type": "ban", "userId": "USER_ID", "reason": "string"}
* Unban: {"type": "unban", "userId": "USER_ID"}
* Purge: {"type": "purge", "count": number}
* Lock channel: {"type": "lock"}
* Unlock channel: {"type": "unlock"}
* Slowmode: {"type": "slowmode", "seconds": number}
* Warn: {"type": "warn", "userId": "USER_ID", "reason": "string"}
* Play Music: {"type": "play", "song": "song query or youtube/soundcloud link"}
* Skip Music: {"type": "skip"}
* Pause Music: {"type": "pause"}
* Resume Music: {"type": "resume"}
* Stop Music: {"type": "stop"}
* Start Trivia Game: {"type": "start_trivia"}
* Server Analytics Report: {"type": "server_analytics"}

Always replace "USER_ID" with the actual numeric Discord ID of the target user (e.g. "1444538003824447621"). You can extract this from mentions (like <@1444538003824447621>) in the conversation history or prompt. If you cannot find the numeric ID, do not execute the action.

STRICT AI AUTOMATION RULES:
1. You can automate server configuration and management tasks (like creating/deleting channels/roles, renaming channels, setting status, sending announcements/DMs).
2. You are ONLY allowed to do this if the user's roles list contains "Owner", "Developer", or "Whitelisted_Automation".
3. When an authorized user asks you to automate a task, you MUST first request their confirmation. You do this by appending a spoiler-hidden JSON confirmation block at the very end of your response:
||CONFIRM_ACTION:{"type": "ACTION_TYPE", ...}||

Supported automation actions and their parameters:
* Create Channel: {"type": "create_channel", "name": "string", "channelType": "text|voice", "categoryName": "string"}
* Delete Channel: {"type": "delete_channel", "channelId": "string"}
* Rename Channel: {"type": "rename_channel", "channelId": "string", "newName": "string"}
* Set Channel Topic: {"type": "set_topic", "channelId": "string", "topic": "string"}
* Create Role: {"type": "create_role", "name": "string", "color": "HEX_COLOR"}
* Delete Role: {"type": "delete_role", "roleId": "string"}
* Set Bot Status: {"type": "set_status", "statusText": "string", "activityType": "PLAYING|WATCHING|LISTENING"}
* DM User: {"type": "dm_user", "userId": "string", "message": "string"}
* Send Announcement: {"type": "announce", "channelId": "string", "title": "string", "description": "string", "color": "HEX_COLOR"}

ZENITSU AI CAPABILITY: WEB SEARCH
You can search the internet for live, real-time information. Use this when:
* The user asks about current events, news, prices, scores, weather, or anything that may have changed recently.
* The user asks you to "search", "look up", "find", or "google" something.
* You are not confident your training data has an accurate/current answer.

To trigger a web search, append this tag at the VERY END of your response (nothing after it):
||SEARCH:{"query":"your optimized search query here"}||

Important:
* Use a SHORT, specific, optimized query (e.g. "IPL 2025 final winner" not "who won the IPL final match in 2025?")
* After searching, you will receive the results and then give a full, informed answer. Do not give a partial answer before searching.
* Only trigger ONE search per response. Do not chain multiple searches.

Always extract numeric IDs for channelId, roleId, or userId. Do not execute immediately; always output the CONFIRM_ACTION tag so the user can verify and approve the action.`;

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

function getActivePrompt(context) {
  let activePrompt = SYSTEM_PROMPT;
  if (context && context.userName) {
    const guildName = context.guildName || 'this server';
    const isHome    = context.isMainGuild;
    const inviteLink = context.serverInviteLink || null;
    activePrompt += `

Active Server Context:
- Server Name: ${guildName}${isHome ? ' (ZENITSU LIVE — Home Server)' : ' (Whitelisted External Server)'}
- Server Invite Link: ${inviteLink ? inviteLink : 'Not configured yet'}
- User Name: ${context.userName}
- Display Name: ${context.userDisplayName || context.userName}
- Server Roles: ${context.userRoles ? context.userRoles.join(', ') : 'Member'}
- Is Developer/Owner: ${context.isDeveloper ? 'YES — THIS IS KUTTY, YOUR CREATOR. Treat them as your boss!' : 'NO'}

IMPORTANT CONTEXT RULE: KUTTY is the developer of this bot and the owner of ZENITSU LIVE server ONLY.
${isHome
  ? 'You are currently in ZENITSU LIVE — KUTTY\'s own server. He is the boss here.'
  : `You are currently in "${guildName}" — an external server that has been granted access to use this bot. KUTTY is NOT the owner or boss of this server. KUTTY is only the bot\'s developer. Never claim KUTTY owns or controls this server.`
}
${inviteLink ? `If anyone asks for the server invite link or how to join ZENITSU LIVE, share this link: ${inviteLink}` : ''}
REMINDER: You are ZENITSU AI built by KUTTY. Never claim to be Meta AI, LLaMA, or any other product.`;

  }
  return activePrompt;
}

async function callGemini(model, messages, context) {
  const apiKey  = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment variables.');

  // Convert OpenAI-style messages to Gemini format
  const contents = [];
  const activePrompt = getActivePrompt(context);

  // Add system prompt as first user message (Gemini doesn't have system role)
  contents.push({ role: 'user', parts: [{ text: activePrompt }] });
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

async function callOpenAI(model, messages, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in environment variables.');

  const activePrompt = getActivePrompt(context);
  const res = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { 'Authorization': `Bearer ${apiKey}` },
    {
      model:       model.name,
      messages:    [{ role: 'system', content: activePrompt }, ...messages],
      max_tokens:  1024,
      temperature: 0.7,
    }
  );

  if (res.error) throw new Error(res.error.message);
  return res.choices[0].message.content;
}

async function callGroq(model, messages, context) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in environment variables.');

  const activePrompt = getActivePrompt(context);
  const res = await httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { 'Authorization': `Bearer ${apiKey}` },
    {
      model:       model.name,
      messages:    [{ role: 'system', content: activePrompt }, ...messages],
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

async function queryAI(userId, prompt, modelKey = (process.env.DEFAULT_AI_MODEL || 'groq'), userLang = null, context = {}) {
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
      failoverQueue = [modelKey, 'groq', 'gemini', 'gpt35'].filter((val, index, self) => self.indexOf(val) === index);
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

      // Circuit breaker: skip providers that recently failed with quota errors
      const cooldownUntil = PROVIDER_COOLDOWNS.get(currentKey);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        attemptErrorLogs.push(`${model.label}: on quota cooldown (${Math.ceil((cooldownUntil - Date.now()) / 1000)}s left)`);
        continue;
      }

      // Check if API key exists
      if (!process.env[model.envKey]) {
        attemptErrorLogs.push(`${model.label}: API Key not set.`);
        continue;
      }

      const t0 = Date.now();
      try {
        let response;
        if      (model.provider === 'google') response = await callGemini(model, messages, context);
        else if (model.provider === 'openai') response = await callOpenAI(model, messages, context);
        else if (model.provider === 'groq')   response = await callGroq(model, messages, context);
        else throw new Error('Unknown provider');

        responseText = response;
        successfulModel = model;
        recordUsage({ userId, context, model, prompt, response: responseText, latencyMs: Date.now() - t0, success: true });
        break; // Successfully got response, stop failover loop
      } catch (err) {
        attemptErrorLogs.push(`${model.label} error: ${err.message}`);
        if (QUOTA_ERROR_RX.test(err.message)) {
          PROVIDER_COOLDOWNS.set(currentKey, Date.now() + QUOTA_COOLDOWN_MS);
          console.warn(`[AI] Provider ${currentKey} placed on ${QUOTA_COOLDOWN_MS / 60000}min quota cooldown.`);
        }
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

    // ── WEB SEARCH INTERCEPT ─────────────────────────────────────────────────
    // If the AI wants to search the web, it outputs ||SEARCH:{"query":"..."}||
    // We perform the search, inject results, and make a second AI call.
    const searchMatch = responseText.match(/\|\|SEARCH:(\{.*?\})\|\|/s);
    if (searchMatch) {
      const cleanAfterSearch = responseText.replace(/\|\|SEARCH:(\{.*?\})\|\|/s, '').trim();
      
      const runtime = global.__zenitsuRuntime;
      const dbMgr = runtime ? runtime.getService('DatabaseManager') : null;
      const db = dbMgr && context.guildId ? dbMgr.getGuildDb(context.guildId) : null;
      const searchEnabled = !db || !db.featureFlags || db.featureFlags.aiSearch !== false;

      if (!searchEnabled) {
        responseText = cleanAfterSearch;
      } else {
        let searchQuery = '';
        try {
          searchQuery = JSON.parse(searchMatch[1]).query || '';
        } catch (_) { searchQuery = searchMatch[1].replace(/[{}"]/g, '').replace('query:', '').trim(); }

        console.log(`[AI SEARCH] Performing web search: "${searchQuery}"`);
        const searchResult = await webSearch(searchQuery);

        if (searchResult.success) {
        // Inject search results and get a second, informed AI response
        const searchContext = `[Web Search Results for "${searchQuery}"]:
${searchResult.results}

Now give the user a complete, helpful answer based on these search results. Be direct and cite the source if available.`;

        // Build second-pass messages with search context
        const secondMessages = [
          ...messages,
          { role: 'assistant', content: cleanAfterSearch || 'Let me search that for you.' },
          { role: 'user',      content: searchContext }
        ];

        try {
          let finalResponse;
          if      (successfulModel.provider === 'google') finalResponse = await callGemini(successfulModel, secondMessages, context);
          else if (successfulModel.provider === 'openai') finalResponse = await callOpenAI(successfulModel, secondMessages, context);
          else if (successfulModel.provider === 'groq')   finalResponse = await callGroq(successfulModel, secondMessages, context);
          if (finalResponse) responseText = `🔍 *Searched: "${searchQuery}"*\n\n${finalResponse}`;
        } catch (searchErr) {
          console.error('[AI SEARCH] Second-pass call failed:', searchErr.message);
          responseText = `${cleanAfterSearch}\n\n🔍 *Search results for "${searchQuery}"*:\n${searchResult.results}`;
        }
        } else {
          // Search failed — remove the tag and note it
          responseText = `${cleanAfterSearch}\n\n⚠️ Web search failed: ${searchResult.error}`;
        }
      }
    }


    addToHistory(userId, 'user',      prompt, context);
    addToHistory(userId, 'assistant', responseText, context);

    // ── OUTPUT IDENTITY SANITIZER ─────────────────────────────────────────────
    // Final defence — rewrites any base-model identity leakage before Discord sees it.
    responseText = sanitizeResponse(responseText);

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

// ─── RESPONSE IDENTITY SANITIZER ─────────────────────────────────────────────
// This is the output-level defence. Even if the base model (LLaMA, GPT, etc.)
// breaks character and claims its own identity, this layer corrects it BEFORE
// the response reaches Discord. ZENITSU AI is 100% ours at the output level.

const IDENTITY_REPLACEMENTS = [
  // "I'm a large language model / Meta AI / LLaMA..."
  { pattern: /I('m| am) (a |an )?(large language model|LLM|language model|AI (language )?model|Meta AI|LLaMA|Llama|Facebook AI|Meta's AI)/gi,
    replacement: "I'm ZENITSU AI, custom-built for this server by KUTTY" },

  // "I was developed/created/built/trained by Meta / OpenAI / Google..."
  { pattern: /I (was |am )?(developed|created|built|made|trained) by (Meta( AI)?|OpenAI|Google|Anthropic|Mistral|Cohere|AI21|xAI|DeepMind|any company)/gi,
    replacement: 'I was built by KUTTY exclusively for this server' },

  // "I am an AI assistant designed to provide..."
  { pattern: /I('m| am) (an? )?(AI|artificial intelligence|virtual assistant|chatbot|digital assistant|automated system)( assistant| system)? (designed|built|made|created|trained|here) to (provide|help|assist|answer|offer)/gi,
    replacement: "I'm ZENITSU AI and I'm here to" },

  // "I don't have information about my owner / who built me..."
  { pattern: /I (don'?t|do not) have (information|details|data|knowledge|personal details|access) (about|on|regarding) (my (owner|creator|developer|builders?|makers?)|who (built|created|made|owns|developed) me|the (entity|company|organization|person|team) that (manages?|built|created|owns|runs) me)/gi,
    replacement: 'My developer is KUTTY who built me for this server' },

  // "I don't have information about the owner of this server..."
  { pattern: /I (don'?t|do not) have (information|details|data|knowledge|access) (about|on|regarding) the (specific )?owner of (this|the) server/gi,
    replacement: 'KUTTY is my developer and the owner of the ZENITSU LIVE server' },

  // "I don't have direct access to the server's administrative details..."
  { pattern: /I (don'?t|do not) have (direct )?access to (the )?server's (administrative|admin) details/gi,
    replacement: 'KUTTY handles all the server administrative details' },

  // "My purpose is to assist users with their queries..."
  { pattern: /My purpose is to (assist|help|serve) (users|you) with (their |your )?queries/gi,
    replacement: "I am here to manage the server and assist the community" },

  // "I don't have the ability to disclose sensitive information..."
  { pattern: /I (don'?t|do not) have the ability to (disclose|reveal|share) (sensitive|private) information/gi,
    replacement: 'I only share public server details configured by KUTTY' },

  // "My knowledge was last updated in 20XX"
  { pattern: /my knowledge (was |is )?(last )?updated (in|as of|through|until) 20\d\d/gi,
    replacement: 'I stay current through my developer KUTTY' },

  // "I don't know who built / created / owns me"
  { pattern: /I (don'?t|do not) know who (built|created|owns|developed|made) (me|this bot)/gi,
    replacement: 'I was built by KUTTY' },

  // "Would you like to know more about Meta AI..."
  { pattern: /would you like to know more about (Meta AI|my (capabilities|creators?)|who (built|made|created) me)/gi,
    replacement: 'want to know more about what I can do here in the server' },

  // "I'm here to provide general information and assist with tasks"
  { pattern: /I('m| am) here to provide (general )?information and (assist|help) with (tasks?|questions?)/gi,
    replacement: "I'm ZENITSU AI, here to run this server and help you with anything" },

  // "I must/need/should clarify that I'm a large language model / AI"
  { pattern: /I (must|need to|should|have to) clarify that I'?m (a |an )?(large language model|AI|artificial intelligence)/gi,
    replacement: 'just so you know' },

  // "I don't have the capability to literally/actually determine..."
  { pattern: /I (don'?t|do not) have the capability to (literally |actually )?(determine|access|know|understand|perceive|feel|experience)/gi,
    replacement: 'I can still work with' },
];

function sanitizeResponse(text) {
  if (typeof text !== 'string') return text;
  let sanitized = text;
  for (const { pattern, replacement } of IDENTITY_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (sanitized !== text) {
    console.log('[AI SANITIZER] Identity violation corrected in AI response.');
  }
  return sanitized;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { queryAI, MODELS, clearHistory, getHistory };

