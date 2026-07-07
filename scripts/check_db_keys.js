const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/zenitsu.db');
const GUILD_ID = '1445422164814729249';

function main() {
  const db = new Database(DB_PATH);
  
  const keys = ['welcomeImage', 'welcomeFileData', 'welcomeFileMime', 'ticketImage', 'ticketFileData', 'ticketFileMime'];
  
  keys.forEach(k => {
    const row = db.prepare('SELECT value_json FROM guild_config WHERE guild_id = ? AND key = ?').get(GUILD_ID, k);
    if (row) {
      const val = JSON.parse(row.value_json);
      console.log(`${k}: type=${typeof val}, length=${val ? val.length : 0}`);
      if (k === 'ticketImage' || k === 'welcomeImage') {
        console.log(`  -> URL: ${val}`);
      }
    } else {
      console.log(`${k}: NOT FOUND`);
    }
  });
  
  db.close();
}

main();
