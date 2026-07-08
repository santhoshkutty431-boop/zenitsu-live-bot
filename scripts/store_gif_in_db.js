/**
 * store_gif_in_db.js
 * Downloads real animated Zenitsu GIFs from reliable CDN sources
 * and stores them as base64 in the local SQLite database for both guild IDs.
 *
 * Run: node scripts/store_gif_in_db.js
 */

const https = require('https');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.resolve(__dirname, '../data/zenitsu.db');
const GUILD_IDS = ['1444533392518680719', '1445422164814729249'];

// Multiple candidate sources per type — first valid GIF wins
const GIF_CANDIDATES = {
  welcome: [
    'https://static.wikia.nocookie.net/kimetsu-no-yaiba/images/5/5e/Zenitsu_Agatsuma_Anime_S1.gif?format=original',
    'https://gifdb.com/images/high/zenitsu-agatsuma-cry-face-uzr0vntk1e8gzm5a.gif',
    'https://gifdb.com/images/high/zenitsu-agatsuma-thunderclap-flash-demon-slayer-s8oj9hxbajsncf6k.gif',
    'https://gifdb.com/images/high/demon-slayer-zenitsu-agatsuma-0mgcntqptkyb9o4m.gif',
    'https://gifdb.com/images/high/zenitsu-agatsuma-lightning-speed-slashing-2o4kvaxpf9y1ewi5.gif',
  ],
  ticket: [
    'https://static.wikia.nocookie.net/kimetsu-no-yaiba/images/1/14/Zenitsu_Anime_S2.gif?format=original',
    'https://gifdb.com/images/high/zenitsu-agatsuma-thunder-breathing-first-form-demon-slayer-j0gnzv4tskv1e69d.gif',
    'https://gifdb.com/images/high/zenitsu-demon-slayer-yellow-lightning-kimetsu-no-yaiba-n5x3bj3cg3hdq3vj.gif',
    'https://gifdb.com/images/high/agatsuma-zenitsu-thunder-attack-wr94x1bqd6e5h0dl.gif',
    'https://gifdb.com/images/high/zenitsu-agatsuma-thunderclap-flash-demon-slayer-s8oj9hxbajsncf6k.gif',
  ]
};

// Giphy 404 placeholder md5 signature to reject
const GIPHY_404_B64_LEN = 319096;

function downloadBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/gif,image/webp,image/*,*/*;q=0.8',
        'Referer': 'https://gifdb.com/',
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect with no Location header'));
        // Make absolute if needed
        const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        res.resume();
        return resolve(downloadBuffer(nextUrl, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function isRealGif(buffer) {
  if (!buffer || buffer.length < 6) return false;
  // GIF magic bytes: GIF87a or GIF89a
  const magic = buffer.slice(0, 6).toString('ascii');
  if (!magic.startsWith('GIF')) {
    console.log('    ✗ Not a GIF (magic bytes:', JSON.stringify(magic), ')');
    return false;
  }
  // Reject if it matches Giphy 404 placeholder size
  const b64 = buffer.toString('base64');
  if (b64.length === GIPHY_404_B64_LEN) {
    console.log('    ✗ Looks like Giphy 404 placeholder');
    return false;
  }
  console.log(`    ✓ Valid GIF (${(buffer.length / 1024).toFixed(1)} KB, magic: ${magic})`);
  return true;
}

async function tryDownload(urls) {
  for (const url of urls) {
    console.log(`  Trying: ${url}`);
    try {
      const buf = await downloadBuffer(url);
      if (isRealGif(buf)) return { buffer: buf, url };
    } catch (e) {
      console.log(`    ✗ Error: ${e.message}`);
    }
  }
  return null;
}

async function main() {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
  const delStmt = db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?');

  let welcomeResult = null;
  let ticketResult = null;

  console.log('\n=== Downloading WELCOME GIF ===');
  welcomeResult = await tryDownload(GIF_CANDIDATES.welcome);

  console.log('\n=== Downloading TICKET GIF ===');
  ticketResult = await tryDownload(GIF_CANDIDATES.ticket);

  if (!welcomeResult && !ticketResult) {
    console.error('\n❌ No valid GIFs found. Please upload manually via the dashboard at /manage/:guildId');
    db.close();
    process.exit(1);
  }

  for (const guildId of GUILD_IDS) {
    console.log(`\nWriting to guild: ${guildId}`);
    if (welcomeResult) {
      const b64 = welcomeResult.buffer.toString('base64');
      stmt.run(guildId, 'welcomeFileMime', JSON.stringify('image/gif'));
      stmt.run(guildId, 'welcomeFileData', JSON.stringify(b64));
      delStmt.run(guildId, 'welcomeImage'); // Remove URL fallback
      console.log(`  ✓ welcomeFileData set (${(b64.length / 1024).toFixed(0)} KB b64) from: ${welcomeResult.url}`);
    }
    if (ticketResult) {
      const b64 = ticketResult.buffer.toString('base64');
      stmt.run(guildId, 'ticketFileMime', JSON.stringify('image/gif'));
      stmt.run(guildId, 'ticketFileData', JSON.stringify(b64));
      delStmt.run(guildId, 'ticketImage');
      console.log(`  ✓ ticketFileData set (${(b64.length / 1024).toFixed(0)} KB b64) from: ${ticketResult.url}`);
    }
  }

  db.close();
  console.log('\n✅ Database updated! Now upload to Hugging Face:');
  console.log('   python "C:/Users/Admin/.gemini/antigravity/brain/87f2982f-fee1-422a-aaf1-d7830a17a1aa/scratch/upload_db_via_hflib.py"');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
