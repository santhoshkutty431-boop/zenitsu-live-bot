const https = require('https');

const MODELS = {
  gemini: {
    name: 'gemini-2.0-flash',
    provider: 'gemini',
    envKey: 'GEMINI_API_KEY',
    label: '🔷 Gemini 2.0 Flash (Free)'
  },
  gpt4o: {
    name: 'gpt-4o',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    label: '🟢 GPT-4o (Best)'
  },
  gpt35: {
    name: 'gpt-3.5-turbo',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    label: '🟡 GPT-3.5 Turbo (Fast & Cheap)'
  },
  groq: {
    name: 'llama-3.3-70b-versatile',
    provider: 'groq',
    envKey: 'GROQ_API_KEY',
    label: '⚡ Groq Llama-3.3-70b (Free+Fast)'
  }
};

// Errors that mean "this provider is dead for a while, don't hammer it"
const QUOTA_ERROR_RX = /quota|billing|rate.?limit|429|insufficient/i;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000; // skip quota-dead providers for 10 min

class AIProviderManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.rateLimits = new Map();
    this.rateLimitMax = 5;
    this.rateLimitWindow = 60000;
    // Circuit breaker: modelKey -> timestamp until which the provider is skipped.
    // Without this, every /ai call retries a quota-dead provider (e.g. a Gemini
    // key with limit:0), adding latency and spamming error logs on every query.
    this.providerCooldowns = new Map();
  }

  async onInit() {
    this.logger.info('Initializing AI Provider Manager...');
  }

  async onShutdown() {
    this.logger.info('Shutting down AI Provider Manager...');
    this.rateLimits.clear();
  }

  checkRateLimit(userId) {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);

    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(userId, { count: 1, resetAt: now + this.rateLimitWindow });
      return { allowed: true };
    }

    if (entry.count >= this.rateLimitMax) {
      const wait = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, wait };
    }

    entry.count++;
    return { allowed: true };
  }

  async query(userId, prompt, modelKey = 'gemini', systemPrompt = '', messages = []) {
    // 1. Check Rate Limit
    const rl = this.checkRateLimit(userId);
    if (!rl.allowed) {
      return { error: true, message: `⏳ Slow down! You're sending too many requests. Please wait **${rl.wait}s**.` };
    }

    // 2. Define failover queue
    let failoverQueue = [];
    if (modelKey === 'gpt4o' || modelKey === 'gpt35') {
      failoverQueue = [modelKey, 'groq', 'gemini'];
    } else {
      failoverQueue = [modelKey, 'gemini', 'groq', 'gpt35'].filter((val, index, self) => self.indexOf(val) === index);
    }

    let lastError = null;
    for (const key of failoverQueue) {
      const model = MODELS[key];
      if (!model) continue;

      // Circuit breaker: skip providers on quota cooldown
      const cooldownUntil = this.providerCooldowns.get(key);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        this.logger.debug(`Skipping ${key}: on quota cooldown for another ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s`);
        lastError = lastError || new Error(`${key} on quota cooldown`);
        continue;
      }

      const apiKey = process.env[model.envKey];
      if (!apiKey) {
        this.logger.warn(`API key missing for ${key} (${model.envKey}), checking next fallback...`);
        lastError = new Error(`API key missing for ${key}`);
        continue;
      }

      this.logger.info(`Attempting AI query via model: ${key} (${model.name})...`);
      const startTime = Date.now();

      try {
        let responseText = '';
        if (model.provider === 'gemini') {
          responseText = await this.callGemini(model, apiKey, systemPrompt, messages);
        } else if (model.provider === 'openai') {
          responseText = await this.callOpenAI(model, apiKey, systemPrompt, messages);
        } else if (model.provider === 'groq') {
          responseText = await this.callGroq(model, apiKey, systemPrompt, messages);
        }

        const latency = Date.now() - startTime;
        this.logger.perf(`AI Query succeeded via ${key} in ${latency}ms.`);
        
        // Publish stats event
        await this.runtime.eventBus.publish('AI_QUERY_SUCCESS', {
          userId,
          model: key,
          latency,
          promptLength: prompt.length,
          responseLength: responseText.length
        });

        return { response: responseText, modelUsed: key };
      } catch (err) {
        this.logger.error(`AI query failed for model ${key}: ${err.message}`);
        lastError = err;
        // Quota/billing failure → put the provider on cooldown so subsequent
        // queries go straight to a working fallback instead of re-failing here.
        if (QUOTA_ERROR_RX.test(err.message)) {
          this.providerCooldowns.set(key, Date.now() + QUOTA_COOLDOWN_MS);
          this.logger.warn(`Provider ${key} placed on ${QUOTA_COOLDOWN_MS / 60000}min quota cooldown.`);
        }
        // Publish failure event
        await this.runtime.eventBus.publish('AI_QUERY_FAILED', {
          userId,
          model: key,
          error: err.message
        });
      }
    }

    return { error: true, message: `❌ All AI models failed to respond. Last error: ${lastError ? lastError.message : 'Unknown error'}` };
  }

  // API wrappers
  callGemini(model, apiKey, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      const contents = [];
      contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood! Persona activated.' }] });

      for (const msg of messages) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }

      this.httpsPost(
        'generativelanguage.googleapis.com',
        `/v1beta/models/${model.name}:generateContent?key=${apiKey}`,
        {},
        { contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } }
      ).then(res => {
        if (res.error) return reject(new Error(res.error.message));
        if (!res.candidates?.length) return reject(new Error('No response candidates from Gemini API'));
        resolve(res.candidates[0].content.parts[0].text);
      }).catch(reject);
    });
  }

  callOpenAI(model, apiKey, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      this.httpsPost(
        'api.openai.com',
        '/v1/chat/completions',
        { 'Authorization': `Bearer ${apiKey}` },
        {
          model: model.name,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 1024,
          temperature: 0.7
        }
      ).then(res => {
        if (res.error) return reject(new Error(res.error.message));
        resolve(res.choices[0].message.content);
      }).catch(reject);
    });
  }

  callGroq(model, apiKey, systemPrompt, messages) {
    return new Promise((resolve, reject) => {
      this.httpsPost(
        'api.groq.com',
        '/openai/v1/chat/completions',
        { 'Authorization': `Bearer ${apiKey}` },
        {
          model: model.name,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 1024,
          temperature: 0.7
        }
      ).then(res => {
        if (res.error) return reject(new Error(res.error.message || JSON.stringify(res.error)));
        resolve(res.choices[0].message.content);
      }).catch(reject);
    });
  }

  httpsPost(hostname, path, headers, payload, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const dataStr = JSON.stringify(payload);
      const options = {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataStr),
          ...headers
        },
        // Node's socket-level timeout — fires if there's no activity on
        // the socket for timeoutMs. Combined with the explicit
        // req.setTimeout below, this defends against sockets that connect
        // but then go silent (Gemini/OpenAI have been known to do this).
        timeout: timeoutMs
      };

      let settled = false;
      const settleOk = (v) => { if (!settled) { settled = true; resolve(v); } };
      const settleErr = (e) => { if (!settled) { settled = true; reject(e); } };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            settleOk(JSON.parse(body));
          } catch {
            settleErr(new Error(`Non-JSON HTTP response received: ${body.slice(0, 200)}`));
          }
        });
        res.on('error', settleErr);
      });

      req.on('error', settleErr);
      req.on('timeout', () => {
        req.destroy(new Error(`AI provider request timed out after ${timeoutMs / 1000}s`));
      });

      // Belt-and-suspenders fallback: if `timeout` event never fires (which
      // happens on some Node builds when the socket is stuck in SYN_SENT),
      // trip a manual watchdog that abort-destroys the request.
      const watchdog = setTimeout(() => {
        if (!settled) {
          req.destroy(new Error(`AI provider watchdog timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs + 1000);
      req.on('close', () => clearTimeout(watchdog));

      req.write(dataStr);
      req.end();
    });
  }
}

module.exports = AIProviderManager;
