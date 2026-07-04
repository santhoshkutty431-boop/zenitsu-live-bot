const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = 'data/zenitsu.db';
const JSON_PATH = 'database.json';
const GUILD_ID = '1444533392518680719';

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error('database.json not found locally!');
    return;
  }

  console.log('1. Loading database.json...');
  const legacyData = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

  console.log('2. Opening SQLite database...');
  const db = new Database(DB_PATH);

  // Prepared statements
  const setGlobalStmt = db.prepare('INSERT OR REPLACE INTO global_config (key, value_json) VALUES (?, ?)');
  const setGuildKeyStmt = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');

  const globalKeys = ['serverWhitelist', 'permissionSchemaVersion', 'commandRoleWhitelist', 'developerIds', 'featureFlags'];

  console.log('3. Migrating keys...');
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(legacyData)) {
      if (globalKeys.includes(key)) {
        console.log(`- Migrating global key: ${key}`);
        setGlobalStmt.run(key, JSON.stringify(value));
      } else {
        console.log(`- Migrating guild key: ${key} to guild ${GUILD_ID}`);
        setGuildKeyStmt.run(GUILD_ID, key, JSON.stringify(value));
      }
    }
  });
  transaction();

  db.close();
  console.log('✅ SQLite database successfully migrated locally.');
}

main().catch(err => console.error(err));
