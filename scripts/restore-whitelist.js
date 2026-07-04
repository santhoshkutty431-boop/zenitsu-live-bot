const Database = require('better-sqlite3');
const fs = require('fs');
const https = require('https');

require('dotenv').config();
const DB_PATH = 'data/zenitsu.db';
const token = process.env.HF_TOKEN;
const repoId = process.env.HF_REPO || 'kutty-35/zenitsu-live-bot';

async function main() {
  console.log('1. Opening local database...');
  const db = new Database(DB_PATH);
  
  const whitelist = [
    "1460908819335876756",
    "1522873046036250676"
  ];
  
  console.log('2. Inserting whitelisted servers into global_config...');
  db.prepare("INSERT OR REPLACE INTO global_config (key, value_json) VALUES (?, ?)")
    .run('serverWhitelist', JSON.stringify(whitelist));
  
  // Close DB to flush WAL
  db.close();
  console.log('3. Local database updated successfully.');

  // Push to Hugging Face
  console.log('4. Reading updated binary database...');
  const content = fs.readFileSync(DB_PATH);
  const action = {
    action: 'add',
    path: 'data/zenitsu.db',
    content: content.toString('base64')
  };

  const commitPayload = {
    actions: [action],
    summary: 'Restore whitelisted servers to SQLite database',
    parentCommit: undefined
  };

  const payloadString = JSON.stringify(commitPayload);

  const options = {
    hostname: 'huggingface.co',
    port: 443,
    path: `/api/spaces/${repoId}/commit/main`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payloadString)
    }
  };

  console.log('5. Uploading updated database to Hugging Face Spaces...');
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log('✅ SQLite Database successfully synced to Hugging Face Cloud.');
      } else {
        console.error(`❌ Hugging Face upload failed: Status ${res.statusCode} - ${body}`);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Upload request error:', err.message);
  });

  req.write(payloadString);
  req.end();
}

main().catch(err => console.error('Error:', err.message));
