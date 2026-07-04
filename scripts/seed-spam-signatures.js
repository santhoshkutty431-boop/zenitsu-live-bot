// One-shot: embed and insert the default spam signatures into the SQLite DB.
// Run once with `node scripts/seed-spam-signatures.js`. Idempotent — skips if
// already seeded. Requires OPENAI_API_KEY in .env.

require('dotenv').config();
const Database = require('better-sqlite3');
const { DEFAULT_SIGNATURES, _internals } = require('../modules/semantic-spam');

(async () => {
  const db = new Database('data/zenitsu.db');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Ensure the table exists (in case this is run before bot ever started)
  db.exec(`
    CREATE TABLE IF NOT EXISTS spam_signatures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      label TEXT NOT NULL,
      sample_text TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      threshold REAL DEFAULT 0.82,
      added_by TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_spam_sig_guild ON spam_signatures (guild_id);
  `);

  const existing = db.prepare("SELECT COUNT(*) AS n FROM spam_signatures WHERE guild_id = '_global'").get().n;
  if (existing > 0) {
    console.log(`Already seeded (${existing} rows). Nothing to do.`);
    db.close();
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set. Cannot seed.');
    db.close();
    process.exit(1);
  }

  const insert = db.prepare(`
    INSERT INTO spam_signatures (guild_id, label, sample_text, vector_json, threshold, added_by, timestamp)
    VALUES ('_global', ?, ?, ?, ?, 'system', ?)
  `);

  console.log(`Seeding ${DEFAULT_SIGNATURES.length} default spam signatures...`);
  let inserted = 0;
  for (const sig of DEFAULT_SIGNATURES) {
    process.stdout.write(`  ${sig.label} ... `);
    const vec = await _internals.embed(sig.sample);
    if (!vec) { console.log('SKIP (no vector)'); continue; }
    insert.run(sig.label, sig.sample, JSON.stringify(vec), sig.threshold, Date.now());
    inserted++;
    console.log(`OK (dim=${vec.length})`);
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`\n✅ Inserted ${inserted}/${DEFAULT_SIGNATURES.length} signatures locally.`);
  console.log(`\nNext step: run the bot once so it flushes zenitsu.db to HuggingFace,`);
  console.log(`or your Koyeb deploy will overwrite this local file on next boot.`);
  db.close();
})();
