const https = require('https');
const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const hfToken = process.env.HF_TOKEN || '';
const hfRepo = 'kutty-35/zenitsu-live-bot';
const url = `https://huggingface.co/spaces/${hfRepo}/resolve/main/data/zenitsu.db`;
const tempPath = path.resolve(__dirname, '../data/temp_hf_zenitsu.db');

const options = {
  headers: { 'Authorization': `Bearer ${hfToken}` }
};

function download(targetUrl = url) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status: ${res.statusCode} for ${targetUrl}`));
      }
      const file = fs.createWriteStream(tempPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading HF database...');
  await download();
  console.log('Downloaded. Querying keys...');
  
  const db = new Database(tempPath);
  const GUILD_IDS = ['1444533392518680719', '1445422164814729249'];
  
  for (const guildId of GUILD_IDS) {
    console.log(`\nGuild ID: ${guildId}`);
    const keys = ['welcomeImage', 'welcomeFileData', 'welcomeFileMime', 'ticketImage', 'ticketFileData', 'ticketFileMime'];
    keys.forEach(k => {
      const row = db.prepare('SELECT value_json FROM guild_config WHERE guild_id = ? AND key = ?').get(guildId, k);
      if (row) {
        console.log(`  - ${k}: ${row.value_json}`);
      } else {
        console.log(`  - ${k}: NOT FOUND`);
      }
    });
  }
  
  db.close();
  fs.unlinkSync(tempPath);
}

main().catch(console.error);
