const https = require('https');
const fs = require('fs');
const path = require('path');

const token = 'rnd_CSVlXhlzfQnFVhuWlyQYNYjx0sx1';
const serviceId = 'srv-d920leegvqtc73935vgg';

// Simple parser for local .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const envVars = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (let line of lines) {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [key, ...valParts] = line.split('=');
        envVars[key.trim()] = valParts.join('=').trim();
      }
    }
  }
  return envVars;
}

const env = loadEnv();

// Exclude local dev-only variables if any, but send everything else
const keysToSend = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'CATEGORY_TICKETS',
  'CHANNEL_WELCOME',
  'CHANNEL_REPORTS',
  'CHANNEL_FEEDBACK',
  'CHANNEL_PANEL',
  'CHANNEL_SONG_REQUEST',
  'SERVER_LOGS_ID',
  'VOICE_LOG_ID',
  'MOD_LOG_ID',
  'MESSAGE_LOG_ID',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'HF_TOKEN',
  'AI_ANALYTICS_CHANNEL_ID'
];

const envPayload = [];
for (const key of keysToSend) {
  if (env[key]) {
    envPayload.push({ key, value: env[key] });
  }
}

// Add PORT
envPayload.push({ key: 'PORT', value: '8080' });

const payload = JSON.stringify(envPayload);

const options = {
  hostname: 'api.render.com',
  port: 443,
  path: `/v1/services/${serviceId}/env-vars`,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('Updating Render env variables from .env file...');
const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('SUCCESS! Environment variables updated on Render.');
    } else {
      console.error(`ERROR: Status Code ${res.statusCode}`);
      console.error('Response:', body);
    }
    process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err);
  process.exit(1);
});

req.write(payload);
req.end();
