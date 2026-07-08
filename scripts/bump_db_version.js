const Database = require('better-sqlite3');
const db = new Database('data/zenitsu.db');
const row = db.prepare("SELECT value_json FROM global_config WHERE key = 'dbVersionInfo'").get();
console.log('Local version:', row ? row.value_json : 'NOT FOUND');

// Also bump the version so cloud DB is accepted
const current = row ? JSON.parse(row.value_json) : { version: 0 };
const newVersion = current.version + 1;
db.prepare("INSERT OR REPLACE INTO global_config (key, value_json) VALUES ('dbVersionInfo', ?)").run(JSON.stringify({ version: newVersion, updatedAt: new Date().toISOString() }));
console.log('Bumped version to:', newVersion);
db.close();
