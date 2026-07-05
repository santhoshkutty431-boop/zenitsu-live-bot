const https = require('https');
require('dotenv').config();

const SYSTEM_PROMPT = "You are a helpful assistant.";
const messages = [
  { role: 'user', content: 'Say hello in one word.' }
];

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    let settled = false;

    const settleOk = (v) => { if (!settled) { settled = true; resolve(v); } };
    const settleErr = (e) => { if (!settled) { settled = true; reject(e); } };

    console.log(`Sending POST to ${hostname}${path}...`);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 10000
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

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return console.log('Gemini: Key not set.');
  const contents = [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'Understood.' }] },
    { role: 'user', parts: [{ text: 'Say hello in one word.' }] }
  ];
  try {
    const res = await httpsPost(
      'generativelanguage.googleapis.com',
      `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {},
      { contents }
    );
    console.log('Gemini Response:', JSON.stringify(res).slice(0, 200));
  } catch (err) {
    console.error('Gemini failed:', err.message);
  }
}

async function testGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return console.log('Groq: Key not set.');
  try {
    const res = await httpsPost(
      'api.groq.com',
      '/openai/v1/chat/completions',
      { 'Authorization': `Bearer ${apiKey}` },
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 50
      }
    );
    console.log('Groq Response:', JSON.stringify(res).slice(0, 200));
  } catch (err) {
    console.error('Groq failed:', err.message);
  }
}

async function testOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return console.log('OpenAI: Key not set.');
  try {
    const res = await httpsPost(
      'api.openai.com',
      '/v1/chat/completions',
      { 'Authorization': `Bearer ${apiKey}` },
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 50
      }
    );
    console.log('OpenAI Response:', JSON.stringify(res).slice(0, 200));
  } catch (err) {
    console.error('OpenAI failed:', err.message);
  }
}

async function run() {
  await testGemini();
  await testGroq();
  await testOpenAI();
}

run();
