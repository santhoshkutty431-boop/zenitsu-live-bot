const fs = require('fs');
const path = require('path');
const https = require('https');
const Database = require('better-sqlite3');

const GUILD_IDS = ['1444533392518680719', '1445422164814729249'];
const DB_PATH = path.resolve(__dirname, '../data/zenitsu.db');

const welcomeGifUrl = 'https://i.giphy.com/f31DK1KpGabeVaif2J.gif';
const ticketGifUrl = 'https://i.giphy.com/V8G4820rM01C8.gif';

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('Database file not found at:', DB_PATH);
    process.exit(1);
  }

  console.log('Downloading animated welcome GIF...');
  const welcomeBuffer = await downloadFile(welcomeGifUrl);
  const welcomeBase64 = welcomeBuffer.toString('base64');
  console.log('Welcome GIF downloaded successfully.');

  console.log('Downloading animated ticket GIF...');
  const ticketBuffer = await downloadFile(ticketGifUrl);
  const ticketBase64 = ticketBuffer.toString('base64');
  console.log('Ticket GIF downloaded successfully.');

  const db = new Database(DB_PATH);
  console.log('Opened database successfully.');

  const stmt = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
  
  for (const guildId of GUILD_IDS) {
    // Set welcome keys
    stmt.run(guildId, 'welcomeFileData', JSON.stringify(welcomeBase64));
    stmt.run(guildId, 'welcomeFileMime', JSON.stringify('image/gif'));
    stmt.run(guildId, 'welcomeImage', JSON.stringify(`https://zenitsu-live-bot.onrender.com/uploads/${guildId}/welcome`));

    // Set ticket keys
    stmt.run(guildId, 'ticketFileData', JSON.stringify(ticketBase64));
    stmt.run(guildId, 'ticketFileMime', JSON.stringify('image/gif'));
    stmt.run(guildId, 'ticketImage', JSON.stringify(`https://zenitsu-live-bot.onrender.com/uploads/${guildId}/ticket`));
    
    console.log(`Saved banners for guild: ${guildId}`);
  }

  console.log('Successfully saved premium animated welcome and ticket banners to the database.');
  db.close();
}

main().catch(console.error);
