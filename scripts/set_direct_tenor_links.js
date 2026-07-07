const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/zenitsu.db');
const GUILD_IDS = ['1444533392518680719', '1445422164814729249'];

const db = new Database(DB_PATH);
const stmt = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
const delStmt = db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?');

for (const guildId of GUILD_IDS) {
  // Set direct image URLs
  stmt.run(guildId, 'welcomeImage', JSON.stringify('https://media.tenor.com/m/V_zC24-B97cAAAAC/zenitsu-demon-slayer.gif'));
  stmt.run(guildId, 'ticketImage', JSON.stringify('https://media.tenor.com/m/V8G4820rM01C8AAAAd/zenitsu-demon-slayer.gif'));
  
  // Clear file data
  delStmt.run(guildId, 'welcomeFileData');
  delStmt.run(guildId, 'welcomeFileMime');
  delStmt.run(guildId, 'ticketFileData');
  delStmt.run(guildId, 'ticketFileMime');
  
  console.log(`Updated guild: ${guildId}`);
}
db.close();
console.log('Successfully applied direct Tenor links to the database.');
