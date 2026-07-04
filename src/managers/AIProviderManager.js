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

class AIProviderManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.rateLimits = new Map();
    this.rateLimitMax = 5;
    this.rateLimitWindow = 60000;
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

  httpsPost(hostname, path, headers, payload) {
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
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Non-JSON HTTP response received: ${body.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(dataStr);
      req.end();
    });
  }
}

module.exports = AIProviderManager;
