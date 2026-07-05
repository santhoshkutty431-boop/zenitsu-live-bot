const fs = require('fs');
const path = require('path');
const https = require('https');
const Database = require('better-sqlite3');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'zenitsu.db');

const asyncLocalStorage = new AsyncLocalStorage();
global.asyncLocalStorage = asyncLocalStorage; // Expose globally for index.js wrapper

const DEFAULT_GLOBAL = {
  permissionSchemaVersion: 5.3,
  developerIds: [],
  serverWhitelist: [],
  featureFlags: {
    knowledgeEngine: true,
    liveSync: true,
    costControls: true,
  },
  songQueue: [],
};

const DEFAULT_GUILD = {
  setupCompleted: false,
  setupChannelFallback: null,
  metadata: {
    name: '',
    ownerId: '',
    memberCount: 0,
    channels: [],
    roles: [],
  },
  approvedChannels: {
    rules: null,
    faq: null,
    announcements: null,
    guides: null,
  },
  optionalAccess: {
    ticketHistory: false,
    moderationLogs: false,
  },
  documents: [],
  indexVersion: 0,
  indexPaused: false,
  costState: {
    embeddingCallsThisHour: 0,
    hourWindowStart: null,
    embeddingBudgetPerHour: 500,
  },
  rateLimits: {
    queriesPerUserPerHour: 60,
    userQueryLog: {},
  },

  // Legacy keys to support backward compatibility
  songQueue: [],
  activeTickets: {},
  aiTickets: {},
  bypasses: {},
  protectmeActive: true,
  spamTimeoutMinutes: 1,
  xp: {},
  roleWhitelist: [],
  deletedMessages: [],
  cases: [],
  caseCounter: 0,
  securityConfig: {},
  aiChannelId: null,
  aiDefaultModel: process.env.DEFAULT_AI_MODEL || 'groq',
  ticketLanguages: {},
  userLanguages: {},
  guildWhitelists: {},
  permissionSchemaVersion: 4,
  commandRoleWhitelist: { admin: [], staff: [], member: [] },
  roleCapabilities: {},
  warnings: {}
};
// Schema version: 2026-07-05-v3 (trigger redeploy after clean hf database push)

class DatabaseManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime ? runtime.logger : console;
    this.config = runtime ? runtime.config.getSystemConfig() : {};
    
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.sqlDb = new Database(DB_PATH);
    this.sqlDb.pragma('journal_mode = WAL'); // Enable WAL mode for high concurrency
    this.sqlDb.pragma('synchronous = NORMAL'); // Safe with WAL, ~2-5x faster writes
    this.sqlDb.pragma('foreign_keys = ON');

    this._initTables();

    // Prepared statements
    this.getGlobalStmt = this.sqlDb.prepare('SELECT value_json FROM global_config WHERE key = ?');
    this.setGlobalStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO global_config (key, value_json) VALUES (?, ?)');
    
    this.getGuildStmt = this.sqlDb.prepare('SELECT key, value_json FROM guild_config WHERE guild_id = ?');
    this.setGuildKeyStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
    this.deleteGuildStmt = this.sqlDb.prepare('DELETE FROM guild_config WHERE guild_id = ?');

    this._globalCache = null;
    this._guildCache = new Map();

    this.syncTimer = null;
    this.writeQueue = Promise.resolve();
    this.lastSuccessfulSync = null;
    this.lastSuccessfulBackup = null;
    this.isSyncing = false;

    // Set up Proxy for backward compatibility
    this.db = new Proxy({}, {
      get: (target, prop) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        const isGlobalOnly = ['serverWhitelist', 'developerIds', 'featureFlags'].includes(prop);
        if (guildId && !isGlobalOnly) {
          return this.getGuildDb(guildId)[prop];
        } else {
          return this.getGlobal()[prop];
        }
      },
      set: (target, prop, value) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        const isGlobalOnly = ['serverWhitelist', 'developerIds', 'featureFlags'].includes(prop);
        if (guildId && !isGlobalOnly) {
          const gdb = this.getGuildDb(guildId);
          gdb[prop] = value;
          this.saveGuildDb(guildId);
        } else {
          const gdb = this.getGlobal();
          gdb[prop] = value;
          this.saveGlobal();
        }
        return true;
      },
      has: (target, prop) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        const isGlobalOnly = ['serverWhitelist', 'developerIds', 'featureFlags'].includes(prop);
        const obj = (guildId && !isGlobalOnly) ? this.getGuildDb(guildId) : this.getGlobal();
        return prop in obj;
      },
      ownKeys: (target) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        const obj = guildId ? this.getGuildDb(guildId) : this.getGlobal();
        return Reflect.ownKeys(obj);
      },
      getOwnPropertyDescriptor: (target, prop) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        const isGlobalOnly = ['serverWhitelist', 'developerIds', 'featureFlags'].includes(prop);
        const obj = (guildId && !isGlobalOnly) ? this.getGuildDb(guildId) : this.getGlobal();
        return Reflect.getOwnPropertyDescriptor(obj, prop);
      }
    });
  }

  _initTables() {
    this.sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS global_config (
        key TEXT PRIMARY KEY,
        value_json TEXT
      );
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT,
        key TEXT,
        value_json TEXT,
        PRIMARY KEY (guild_id, key)
      );
      CREATE TABLE IF NOT EXISTS mod_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        actor_id TEXT,
        target_id TEXT,
        command TEXT,
        params_json TEXT,
        result TEXT,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS ai_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        user_id TEXT,
        provider TEXT,
        model TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        latency_ms INTEGER,
        success INTEGER,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_guild_ts ON ai_usage (guild_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts  ON ai_usage (user_id,  timestamp);

      CREATE TABLE IF NOT EXISTS spam_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,      -- '_global' for shipped defaults, otherwise guild ID
        label TEXT NOT NULL,          -- human-readable ("nitro scam", "steam gift", etc.)
        sample_text TEXT NOT NULL,    -- the original phrase used to generate the vector
        vector_json TEXT NOT NULL,    -- JSON array of embedding floats
        threshold REAL DEFAULT 0.82,  -- cosine-similarity threshold (0.72 default in VectorStore, spam signatures need higher confidence)
        added_by TEXT,
        timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_spam_sig_guild ON spam_signatures (guild_id);

      CREATE TABLE IF NOT EXISTS active_polls (
        message_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        votes_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS music_players (
        guild_id TEXT PRIMARY KEY,
        current_song TEXT,
        is_paused INTEGER DEFAULT 0,
        loop_mode TEXT DEFAULT 'off',
        volume INTEGER DEFAULT 100,
        position_sec INTEGER DEFAULT 0,
        duration_sec INTEGER DEFAULT 0,
        queue_json TEXT NOT NULL,
        setup_channel_id TEXT,
        setup_message_id TEXT,
        current_song_url TEXT
      );
    `);
    try {
      this.sqlDb.exec('ALTER TABLE music_players ADD COLUMN current_song_url TEXT;');
    } catch (e) {
      // Column already exists, safe to ignore
    }
  }

  // ─── Spam signature helpers ──────────────────────────────────────────────

  addSpamSignature({ guildId, label, sampleText, vector, threshold, addedBy }) {
    if (!this._assertWritePermission('addSpamSignature')) return null;
    const stmt = this.sqlDb.prepare(`
      INSERT INTO spam_signatures (guild_id, label, sample_text, vector_json, threshold, added_by, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      guildId || '_global',
      label,
      sampleText,
      JSON.stringify(vector),
      Number(threshold) || 0.65,
      addedBy || 'system',
      Date.now()
    );
    return info.lastInsertRowid;
  }

  removeSpamSignature(guildId, id) {
    if (!this._assertWritePermission('removeSpamSignature')) return 0;
    const stmt = this.sqlDb.prepare('DELETE FROM spam_signatures WHERE id = ? AND guild_id = ?');
    return stmt.run(id, guildId).changes;
  }

  listSpamSignatures(guildId) {
    // Return this guild's signatures plus the global defaults.
    return this.sqlDb.prepare(`
      SELECT id, guild_id, label, sample_text, vector_json, threshold, added_by, timestamp
      FROM spam_signatures
      WHERE guild_id = ? OR guild_id = '_global'
      ORDER BY guild_id = '_global' ASC, id ASC
    `).all(guildId);
  }

  countSpamSignatures(guildId) {
    return this.sqlDb.prepare(`
      SELECT COUNT(*) AS n FROM spam_signatures WHERE guild_id = ? OR guild_id = '_global'
    `).get(guildId).n;
  }

  recordAiUsage({ guildId, userId, provider, model, tokensIn, tokensOut, latencyMs, success }) {
    if (!this._assertWritePermission('recordAiUsage')) return;
    try {
      const stmt = this.sqlDb.prepare(`
        INSERT INTO ai_usage (guild_id, user_id, provider, model, tokens_in, tokens_out, latency_ms, success, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        guildId || 'global',
        userId || 'unknown',
        provider || 'unknown',
        model || 'unknown',
        Number(tokensIn) || 0,
        Number(tokensOut) || 0,
        Number(latencyMs) || 0,
        success ? 1 : 0,
        Date.now()
      );
    } catch (err) {
      this.logger.error(`Failed to record AI usage: ${err.message}`);
    }
  }

  getAiUsageSummary(guildId, sinceTs = 0) {
    try {
      return this.sqlDb.prepare(`
        SELECT provider, model,
               COUNT(*) AS calls,
               SUM(tokens_in) AS tokens_in,
               SUM(tokens_out) AS tokens_out,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
        FROM ai_usage
        WHERE guild_id = ? AND timestamp >= ?
        GROUP BY provider, model
        ORDER BY calls DESC
      `).all(guildId, sinceTs);
    } catch (err) {
      this.logger.error(`Failed to fetch AI usage summary: ${err.message}`);
      return [];
    }
  }

  recordAudit(guildId, actorId, targetId, command, params, result) {
    if (!this._assertWritePermission('recordAudit')) return;
    try {
      const stmt = this.sqlDb.prepare(`
        INSERT INTO mod_audit (guild_id, actor_id, target_id, command, params_json, result, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(guildId || 'global', actorId, targetId || null, command, JSON.stringify(params || {}), result, Date.now());
    } catch (err) {
      this.logger.error(`Failed to record mod audit: ${err.message}`);
    }
  }

  _logWriteResult(caller, status, reason = null) {
    const deployment = process.env.SPACE_ID ? 'HuggingFace' : (process.env.RENDER ? 'Render' : 'Local/Other');
    const dbMode = process.env.DB_MODE || 'READ_ONLY';
    const store = asyncLocalStorage.getStore();
    const guildId = store?.guildId || 'Global/None';

    if (status === 'SUCCESS') {
      this.logger.info(`
=========================================
📝 DATABASE WRITE SUCCESS
Instance:          ${deployment}
Guild ID:          ${guildId}
Caller:            ${caller}
Database Mode:     ${dbMode}
Result:            SUCCESS
=========================================
      `);
    } else {
      this.logger.warn(`
=========================================
⚠️ DATABASE WRITE BLOCKED
Instance:          ${deployment}
Guild ID:          ${guildId}
Caller:            ${caller}
Database Mode:     ${dbMode}
Reason:            ${reason}
=========================================
      `);
    }
  }

  isDatabaseWriter() {
    // Force Hugging Face Space instance to always be READ_ONLY to prevent clobbering primary Render database
    if (process.env.SPACE_ID) {
      return false;
    }
    // Fail-safe: Default DB_MODE to READ_ONLY if not explicitly specified.
    // Both DB_MODE === 'READ_WRITE' and IS_PRIMARY_INSTANCE === 'true' are required.
    const dbMode = process.env.DB_MODE || 'READ_ONLY';
    const isPrimary = process.env.IS_PRIMARY_INSTANCE === 'true';
    return dbMode === 'READ_WRITE' && isPrimary;
  }

  _assertWritePermission(callerName = 'Database Operation') {
    if (!this.isDatabaseWriter()) {
      const err = new Error('Database Write Blocked');
      this._logWriteResult(callerName, 'BLOCKED', 'Read-only deployment mode or not primary instance');
      this.logger.warn(`Stack Trace:\n${err.stack}`);
      return false;
    }
    this._logWriteResult(callerName, 'SUCCESS');
    return true;
  }

  _incrementDbVersion() {
    try {
      const current = this._getDbVersionInfo();
      current.version = (current.version || 0) + 1;
      current.updatedAt = new Date().toISOString();
      this.setGlobalStmt.run('dbVersionInfo', JSON.stringify(current));
      this._globalCache = this._globalCache || {};
      this._globalCache['dbVersionInfo'] = current;
    } catch (err) {
      this.logger.error(`Failed to increment database version: ${err.message}`);
    }
  }

  _getDbVersionInfo() {
    try {
      const row = this.sqlDb.prepare("SELECT value_json FROM global_config WHERE key = 'dbVersionInfo'").get();
      if (row) {
        return JSON.parse(row.value_json);
      }
    } catch {}
    return { version: 0, updatedAt: new Date().toISOString() };
  }

  _createLocalBackup() {
    try {
      const backupDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:T]/g, '-').split('.')[0];
      const backupPath = path.join(backupDir, `${timestamp}.db`);
      
      this.sqlDb.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(DB_PATH, backupPath);
      
      this.lastSuccessfulBackup = new Date().toISOString();
      this.logger.info(`Database backup created: backups/${timestamp}.db`);
      
      // Rotate backups (keep last 10)
      const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.db'))
        .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);
        
      if (files.length > 10) {
        for (let i = 10; i < files.length; i++) {
          fs.unlinkSync(path.join(backupDir, files[i].name));
        }
      }
      return backupPath;
    } catch (err) {
      this.logger.error(`Database backup failed: ${err.message}`);
      return null;
    }
  }

  async onInit() {
    const deployment = process.env.SPACE_ID ? 'HuggingFace' : (process.env.RENDER ? 'Render' : 'Local/Other');
    const dbMode = process.env.DB_MODE || 'READ_ONLY';
    const isPrimary = process.env.IS_PRIMARY_INSTANCE === 'true' ? 'YES' : 'NO';
    const writerStatus = this.isDatabaseWriter() ? 'YES' : 'NO';
    const isCloud = !!(process.env.SPACE_ID || process.env.RENDER);
    const syncEnabled = this.config.hfToken && this.isDatabaseWriter() && (isCloud || process.env.FORCE_HF_SYNC === 'true');
    const cloudSyncStatus = syncEnabled ? 'Enabled' : 'Disabled';
    const gitPushEnabled = syncEnabled ? 'Enabled' : 'Disabled';
    const currentVersionInfo = this._getDbVersionInfo();

    this.logger.info(`
=========================================
🤖 ZENITSU LIVE Database Initialization 🤖
=========================================
Deployment:        ${deployment}
Database Mode:     ${dbMode}
Primary Instance:  ${isPrimary}
Writer Status:     ${writerStatus}
Cloud Sync:        ${cloudSyncStatus}
Git Push:          ${gitPushEnabled}
Database Version:  ${currentVersionInfo.version}
Last Updated:      ${currentVersionInfo.updatedAt}
Writer:            ${writerStatus}
=========================================
    `);

    const pullEnabled = this.config.hfToken && (isCloud || process.env.FORCE_HF_SYNC === 'true');
    if (pullEnabled) {
      this.logger.info('HF_TOKEN detected. Pulling cloud database file...');
      try {
        await this.syncFromHf();
      } catch (err) {
        this.logger.error(`Cloud database sync failed: ${err.message}`);
      }
    }
  }

  async onShutdown() {
    this.logger.info('Shutting down SQLite Database Manager...');
    if (this.isDatabaseWriter()) {
      this.logger.info('Doing final cloud save...');
      try {
        await this.flushToHf();
      } catch (err) {
        this.logger.error(`Final cloud save failed: ${err.message}`);
      }
    } else {
      this.logger.info('Read-only mode: skipping final cloud save.');
    }
    this.sqlDb.close();
  }

  // ─── Global ─────────────────────────────────────────────────────────────────

  getGlobal() {
    if (!this._globalCache) {
      this._globalCache = {};
      const keys = Object.keys(DEFAULT_GLOBAL);
      for (const key of keys) {
        const row = this.getGlobalStmt.get(key);
        if (row) {
          try {
            this._globalCache[key] = JSON.parse(row.value_json);
          } catch {
            this._globalCache[key] = DEFAULT_GLOBAL[key];
          }
        } else {
          this._globalCache[key] = DEFAULT_GLOBAL[key];
        }
      }
    }
    return this._globalCache;
  }

  saveGlobal(immediate = false) {
    if (!this._assertWritePermission('saveGlobal')) return;
    if (!this._globalCache) return;
    const transaction = this.sqlDb.transaction(() => {
      for (const [key, val] of Object.entries(this._globalCache)) {
        this.setGlobalStmt.run(key, JSON.stringify(val));
      }
    });
    transaction();
    if (immediate) {
      if (this.syncTimer) {
        clearTimeout(this.syncTimer);
        this.syncTimer = null;
      }
      this.flushToHf();
    } else {
      this.scheduleSync();
    }
  }

  save(immediate = false) {
    // Note: save() just delegates to saveGuildDb or saveGlobal, which both assert permission.
    // However, we can assert permission here as well to fail fast.
    if (!this._assertWritePermission('save')) return;
    const store = asyncLocalStorage.getStore();
    const guildId = store?.guildId;
    if (guildId) {
      this.saveGuildDb(guildId, immediate);
    } else {
      this.saveGlobal(immediate);
    }
  }

  // ─── Guild ──────────────────────────────────────────────────────────────────

  getGuildDb(guildId) {
    if (!guildId) throw new Error('getGuildDb requires a guildId');

    if (this._guildCache.has(guildId)) {
      return this._guildCache.get(guildId);
    }

    const db = JSON.parse(JSON.stringify(DEFAULT_GUILD));
    const rows = this.getGuildStmt.all(guildId);
    
    if (rows && rows.length > 0) {
      for (const row of rows) {
        try {
          db[row.key] = JSON.parse(row.value_json);
        } catch {
          // Keep default
        }
      }
    }

    this._guildCache.set(guildId, db);
    return db;
  }

  saveGuildDb(guildId, immediate = false) {
    if (!this._assertWritePermission('saveGuildDb')) return;
    if (!this._guildCache.has(guildId)) return;
    const cache = this._guildCache.get(guildId);

    const transaction = this.sqlDb.transaction(() => {
      for (const [key, val] of Object.entries(cache)) {
        this.setGuildKeyStmt.run(guildId, key, JSON.stringify(val));
      }
    });
    transaction();
    if (immediate) {
      if (this.syncTimer) {
        clearTimeout(this.syncTimer);
        this.syncTimer = null;
      }
      this.flushToHf();
    } else {
      this.scheduleSync();
    }
  }

  deleteGuildDb(guildId) {
    if (!this._assertWritePermission('deleteGuildDb')) return;
    this.deleteGuildStmt.run(guildId);
    this._guildCache.delete(guildId);
    this.scheduleSync();
  }

  guildExists(guildId) {
    const row = this.sqlDb.prepare('SELECT 1 FROM guild_config WHERE guild_id = ? LIMIT 1').get(guildId);
    return Boolean(row);
  }

  listGuildIds() {
    const rows = this.sqlDb.prepare('SELECT DISTINCT guild_id FROM guild_config').all();
    return rows.map(r => r.guild_id);
  }

  updateGuild(guildId, mutatorFn) {
    const db = this.getGuildDb(guildId);
    mutatorFn(db);
    this.saveGuildDb(guildId);
  }

  // ─── Rate-limit / embedding helpers ────────────────────────────────────────

  checkAndRecordQuery(guildId, userId) {
    const db = this.getGuildDb(guildId);
    // Defensive: stored rows may predate the full rateLimits shape. A throw
    // here happens BEFORE /ai defers its reply, so it must never throw.
    if (!db.rateLimits || typeof db.rateLimits !== 'object') {
      db.rateLimits = { queriesPerUserPerHour: 60, userQueryLog: {} };
    }
    const rl = db.rateLimits;
    if (!rl.userQueryLog) rl.userQueryLog = {};
    if (!rl.queriesPerUserPerHour) rl.queriesPerUserPerHour = 60;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;

    for (const [uid, entry] of Object.entries(rl.userQueryLog)) {
      if (now - entry.windowStart > windowMs) delete rl.userQueryLog[uid];
    }

    if (!rl.userQueryLog[userId]) {
      rl.userQueryLog[userId] = { windowStart: now, count: 0 };
    }

    const entry = rl.userQueryLog[userId];
    if (entry.count >= rl.queriesPerUserPerHour) return false;

    entry.count++;
    this.saveGuildDb(guildId);
    return true;
  }

  checkAndRecordEmbedding(guildId) {
    const db = this.getGuildDb(guildId);
    // Defensive: same partial-shape concern as checkAndRecordQuery above.
    if (!db.costState || typeof db.costState !== 'object') {
      db.costState = { embeddingCallsThisHour: 0, hourWindowStart: null, embeddingBudgetPerHour: 500 };
    }
    const cs = db.costState;
    if (!cs.embeddingBudgetPerHour) cs.embeddingBudgetPerHour = 500;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;

    if (!cs.hourWindowStart || now - cs.hourWindowStart > windowMs) {
      cs.hourWindowStart = now;
      cs.embeddingCallsThisHour = 0;
    }

    if (cs.embeddingCallsThisHour >= cs.embeddingBudgetPerHour) {
      db.indexPaused = true;
      this.saveGuildDb(guildId);
      return false;
    }

    cs.embeddingCallsThisHour++;
    this.saveGuildDb(guildId);
    return true;
  }

  // ─── Legacy Method Compatibility ───────────────────────────────────────────

  get(key, defaultValue = null) {
    return this.db[key] !== undefined ? this.db[key] : defaultValue;
  }

  async set(key, value) {
    this.db[key] = value;
    if (this.runtime && this.runtime.eventBus) {
      await this.runtime.eventBus.publish('DB_KEY_UPDATED', { key, value });
    }
  }

  async update(key, updateFn) {
    if (typeof updateFn !== 'function') throw new Error('Update argument must be a function');
    this.db[key] = updateFn(this.db[key]);
    if (this.runtime && this.runtime.eventBus) {
      await this.runtime.eventBus.publish('DB_KEY_UPDATED', { key, value: this.db[key] });
    }
    return this.db[key];
  }

  // ─── Cloud Sync (Binary Replication of zenitsu.db) ──────────────────────────

  scheduleSync() {
    if (!this._assertWritePermission('scheduleSync')) return;
    const isCloud = !!(process.env.SPACE_ID || process.env.RENDER);
    const isSyncEnabled = this.config.hfToken && (isCloud || process.env.FORCE_HF_SYNC === 'true');
    if (!isSyncEnabled) return;
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(async () => {
      this.syncTimer = null;
      await this.flushToHf();
    }, 15000); // Debounce uploads every 15 seconds
  }

  async flushToHf() {
    if (!this._assertWritePermission('flushToHf')) return;
    if (this.isSyncing) {
      this.logger.debug('Sync lock active: skipping concurrent cloud push.');
      return;
    }
    const isCloud = !!(process.env.SPACE_ID || process.env.RENDER);
    const isSyncEnabled = this.config.hfToken && (isCloud || process.env.FORCE_HF_SYNC === 'true');
    if (!isSyncEnabled) return;

    this.isSyncing = true;
    try {
      await this.writeQueue;
      
      this.writeQueue = (async () => {
        try {
          if (!fs.existsSync(DB_PATH)) return;

          // Database Version Protection
          this._incrementDbVersion();

          // Automatic Backup
          this._createLocalBackup();

          // Perform safe checkpoints to commit WAL to binary first
          this.sqlDb.pragma('wal_checkpoint(TRUNCATE)');

          const content = fs.readFileSync(DB_PATH);
          const action = {
            action: 'add',
            path: 'data/zenitsu.db',
            content: content.toString('base64')
          };

          await this.commitToHf([action]);
          this.lastSuccessfulSync = new Date().toISOString();
          this.logger.debug('SQLite Database synced to Hugging Face Cloud.');
        } catch (err) {
          this.logger.error(`SQLite HF sync failed: ${err.message}`);
        }
      })();
      await this.writeQueue;
    } finally {
      this.isSyncing = false;
    }
    return this.writeQueue;
  }

  commitToHf(actions) {
    return new Promise((resolve, reject) => {
      const commitPayload = {
        actions,
        summary: 'Sync SQLite binary database',
        parentCommit: undefined
      };

      const payloadString = JSON.stringify(commitPayload);

      const options = {
        hostname: 'huggingface.co',
        port: 443,
        path: `/api/spaces/${this.config.hfRepo}/commit/main`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.hfToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadString)
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve();
          } else {
            reject(new Error(`Hugging Face upload responded with code ${res.statusCode} - ${body}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payloadString);
      req.end();
    });
  }

  async syncFromHf() {
    const url = `https://huggingface.co/spaces/${this.config.hfRepo}/raw/main/data/zenitsu.db`;
    const options = {
      headers: { 'Authorization': `Bearer ${this.config.hfToken}` }
    };

    const download = (targetUrl, currentOptions = options, depth = 0) => {
      if (depth > 5) {
        this.logger.error('Database download failed: Max redirect depth exceeded');
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        https.get(targetUrl, currentOptions, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            const redirectUrl = res.headers.location;
            if (redirectUrl) {
              const nextOptions = {
                ...currentOptions,
                headers: currentOptions.headers ? { ...currentOptions.headers } : undefined
              };
              if (nextOptions.headers && !redirectUrl.includes('huggingface.co')) {
                delete nextOptions.headers['Authorization'];
              }
              resolve(download(redirectUrl, nextOptions, depth + 1));
              return;
            }
          }

          if (res.statusCode !== 200) {
            this.logger.warn(`No SQLite database found on HF Space (Status ${res.statusCode}), starting fresh.`);
            return resolve(null);
          }

          const dataChunks = [];
          res.on('data', chunk => dataChunks.push(chunk));
          res.on('end', () => {
            resolve(Buffer.concat(dataChunks));
          });
        }).on('error', reject);
      });
    };

    try {
      const buffer = await download(url);
      if (buffer && buffer.length > 100) {
        // Version protection check: Reject cloud DB if its version is older than local DB
        if (fs.existsSync(DB_PATH)) {
          const tempPath = DB_PATH + '_temp';
          fs.writeFileSync(tempPath, buffer);
          let tempDb;
          try {
            tempDb = new Database(tempPath);
            const row = tempDb.prepare("SELECT value_json FROM global_config WHERE key = 'dbVersionInfo'").get();
            const tempVersion = row ? JSON.parse(row.value_json) : { version: 0 };
            
            const localVersion = this._getDbVersionInfo();
            if (tempVersion.version < localVersion.version) {
              this.logger.warn(`Rejected cloud database pull. Cloud version (${tempVersion.version}) is older than local version (${localVersion.version}).`);
              tempDb.close();
              fs.unlinkSync(tempPath);
              return;
            }
          } catch (err) {
            this.logger.error(`Failed to verify downloaded database version: ${err.message}`);
          } finally {
            if (tempDb) {
              try { tempDb.close(); } catch {}
            }
            try {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch {}
          }
        }

        // Switch journal mode to DELETE to force checkpoint and clean deletion of WAL/SHM files
        try {
          this.sqlDb.pragma('journal_mode = DELETE');
        } catch (e) {
          this.logger.warn(`Failed to clean up WAL before sync: ${e.message}`);
        }

        // Close active connection before overwriting
        this.sqlDb.close();

        // Delete old WAL and SHM files if any are still left
        try {
          if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
          if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
        } catch (e) {
          this.logger.warn(`Failed to delete WAL/SHM files on sync: ${e.message}`);
        }
        
        fs.writeFileSync(DB_PATH, buffer);
        this.logger.info('SQLite binary database pulled successfully from HF.');
        
        // Re-open SQLite connection and prepare statements
        this.sqlDb = new Database(DB_PATH);
        this.sqlDb.pragma('journal_mode = WAL');
        this.sqlDb.pragma('synchronous = NORMAL');
        this.sqlDb.pragma('foreign_keys = ON');

        // The DB pulled from HF might not have newer tables (mod_audit,
        // ai_usage, spam_signatures). Re-run the idempotent schema init.
        this._initTables();

        this.getGlobalStmt = this.sqlDb.prepare('SELECT value_json FROM global_config WHERE key = ?');
        this.setGlobalStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO global_config (key, value_json) VALUES (?, ?)');
        this.getGuildStmt = this.sqlDb.prepare('SELECT key, value_json FROM guild_config WHERE guild_id = ?');
        this.setGuildKeyStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
        this.deleteGuildStmt = this.sqlDb.prepare('DELETE FROM guild_config WHERE guild_id = ?');
        
        // Reset cache to force reading from new DB
        this._globalCache = null;
        this._guildCache.clear();
      } else {
        this.logger.warn('SQLite database pull returned empty/pointer buffer. Starting fresh.');
      }
    } catch (err) {
      this.logger.error(`Cloud database sync failed: ${err.message}`);
    }
  }

  createPoll({ messageId, guildId, channelId, question, options, expiresAt }) {
    if (!this._assertWritePermission('createPoll')) return;
    const stmt = this.sqlDb.prepare(`
      INSERT INTO active_polls (message_id, guild_id, channel_id, question, options_json, votes_json, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(messageId, guildId, channelId, question, JSON.stringify(options), JSON.stringify({}), expiresAt);
    this.scheduleSync();
  }

  getPoll(messageId) {
    const stmt = this.sqlDb.prepare('SELECT * FROM active_polls WHERE message_id = ?');
    const row = stmt.get(messageId);
    if (!row) return null;
    return {
      messageId: row.message_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      question: row.question,
      options: JSON.parse(row.options_json),
      votes: JSON.parse(row.votes_json),
      expiresAt: row.expires_at
    };
  }

  updatePollVotes(messageId, votes) {
    if (!this._assertWritePermission('updatePollVotes')) return;
    const stmt = this.sqlDb.prepare('UPDATE active_polls SET votes_json = ? WHERE message_id = ?');
    stmt.run(JSON.stringify(votes), messageId);
    this.scheduleSync();
  }

  deletePoll(messageId) {
    if (!this._assertWritePermission('deletePoll')) return;
    const stmt = this.sqlDb.prepare('DELETE FROM active_polls WHERE message_id = ?');
    stmt.run(messageId);
    this.scheduleSync();
  }

  getActivePolls() {
    const stmt = this.sqlDb.prepare('SELECT * FROM active_polls');
    const rows = stmt.all();
    return rows.map(row => ({
      messageId: row.message_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      question: row.question,
      options: JSON.parse(row.options_json),
      votes: JSON.parse(row.votes_json),
      expiresAt: row.expires_at
    }));
  }

  getMusicPlayer(guildId) {
    const stmt = this.sqlDb.prepare('SELECT * FROM music_players WHERE guild_id = ?');
    const row = stmt.get(guildId);
    if (!row) return null;
    return {
      guildId: row.guild_id,
      currentSong: row.current_song,
      isPaused: !!row.is_paused,
      loopMode: row.loop_mode,
      volume: row.volume,
      positionSec: row.position_sec,
      durationSec: row.duration_sec,
      queue: JSON.parse(row.queue_json),
      setupChannelId: row.setup_channel_id,
      setupMessageId: row.setup_message_id,
      currentSongUrl: row.current_song_url
    };
  }

  saveMusicPlayer(p) {
    if (!this._assertWritePermission('saveMusicPlayer')) return;
    const stmt = this.sqlDb.prepare(`
      INSERT OR REPLACE INTO music_players (
        guild_id, current_song, is_paused, loop_mode, volume, 
        position_sec, duration_sec, queue_json, setup_channel_id, setup_message_id, current_song_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      p.guildId,
      p.currentSong || null,
      p.isPaused ? 1 : 0,
      p.loopMode || 'off',
      p.volume !== undefined ? p.volume : 100,
      p.positionSec || 0,
      p.durationSec || 0,
      JSON.stringify(p.queue || []),
      p.setupChannelId || null,
      p.setupMessageId || null,
      p.currentSongUrl || null
    );
    this.scheduleSync();
  }

  getAllMusicPlayers() {
    const stmt = this.sqlDb.prepare('SELECT * FROM music_players');
    const rows = stmt.all();
    return rows.map(row => ({
      guildId: row.guild_id,
      currentSong: row.current_song,
      isPaused: !!row.is_paused,
      loopMode: row.loop_mode,
      volume: row.volume,
      positionSec: row.position_sec,
      durationSec: row.duration_sec,
      queue: JSON.parse(row.queue_json),
      setupChannelId: row.setup_channel_id,
      setupMessageId: row.setup_message_id,
      currentSongUrl: row.current_song_url
    }));
  }

  deleteMusicPlayer(guildId) {
    if (!this._assertWritePermission('deleteMusicPlayer')) return;
    const stmt = this.sqlDb.prepare('DELETE FROM music_players WHERE guild_id = ?');
    stmt.run(guildId);
    this.scheduleSync();
  }
}

module.exports = DatabaseManager;
