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
  aiDefaultModel: 'gemini',
  ticketLanguages: {},
  userLanguages: {},
  guildWhitelists: {},
  permissionSchemaVersion: 4
};

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

    // Set up Proxy for backward compatibility
    this.db = new Proxy({}, {
      get: (target, prop) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        if (guildId) {
          return this.getGuildDb(guildId)[prop];
        } else {
          return this.getGlobal()[prop];
        }
      },
      set: (target, prop, value) => {
        const store = asyncLocalStorage.getStore();
        const guildId = store?.guildId;
        if (guildId) {
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
        const obj = guildId ? this.getGuildDb(guildId) : this.getGlobal();
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
        const obj = guildId ? this.getGuildDb(guildId) : this.getGlobal();
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
    `);
  }

  recordAudit(guildId, actorId, targetId, command, params, result) {
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

  async onInit() {
    this.logger.info('Initializing SQLite Database Manager...');
    if (this.config.hfToken) {
      this.logger.info('HF_TOKEN detected. Pulling cloud database file...');
      try {
        await this.syncFromHf();
      } catch (err) {
        this.logger.error(`Cloud database sync failed: ${err.message}`);
      }
    }
  }

  async onShutdown() {
    this.logger.info('Shutting down SQLite Database Manager, doing final cloud save...');
    await this.flushToHf();
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

  saveGlobal() {
    if (!this._globalCache) return;
    const transaction = this.sqlDb.transaction(() => {
      for (const [key, val] of Object.entries(this._globalCache)) {
        this.setGlobalStmt.run(key, JSON.stringify(val));
      }
    });
    transaction();
    this.scheduleSync();
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

  saveGuildDb(guildId) {
    if (!this._guildCache.has(guildId)) return;
    const cache = this._guildCache.get(guildId);

    const transaction = this.sqlDb.transaction(() => {
      for (const [key, val] of Object.entries(cache)) {
        this.setGuildKeyStmt.run(guildId, key, JSON.stringify(val));
      }
    });
    transaction();
    this.scheduleSync();
  }

  deleteGuildDb(guildId) {
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
    const rl = db.rateLimits;
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
    const cs = db.costState;
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
    if (!this.config.hfToken) return;
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(async () => {
      this.syncTimer = null;
      await this.flushToHf();
    }, 15000); // Debounce uploads every 15 seconds
  }

  async flushToHf() {
    if (!this.config.hfToken) return;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (!fs.existsSync(DB_PATH)) return;

        // Perform safe checkpoints to commit WAL to binary first
        this.sqlDb.pragma('wal_checkpoint(TRUNCATE)');

        const content = fs.readFileSync(DB_PATH);
        const action = {
          action: 'add',
          path: 'data/zenitsu.db',
          content: content.toString('base64')
        };

        await this.commitToHf([action]);
        this.logger.debug('SQLite Database synced to Hugging Face Cloud.');
      } catch (err) {
        this.logger.error(`SQLite HF sync failed: ${err.message}`);
      }
    });
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
    const url = `https://huggingface.co/api/spaces/${this.config.hfRepo}/raw/main/data/zenitsu.db`;
    const options = {
      headers: { 'Authorization': `Bearer ${this.config.hfToken}` }
    };

    const download = (targetUrl) => {
      return new Promise((resolve, reject) => {
        https.get(targetUrl, options, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            const redirectUrl = res.headers.location;
            if (redirectUrl) {
              const nextOptions = { ...options };
              if (!redirectUrl.includes('huggingface.co')) {
                delete nextOptions.headers['Authorization'];
              }
              return https.get(redirectUrl, nextOptions, (redirRes) => {
                if (redirRes.statusCode !== 200) {
                  return resolve(null);
                }
                const dataChunks = [];
                redirRes.on('data', chunk => dataChunks.push(chunk));
                redirRes.on('end', () => resolve(Buffer.concat(dataChunks)));
              }).on('error', reject);
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
        // Close active connection before overwriting
        this.sqlDb.close();
        
        fs.writeFileSync(DB_PATH, buffer);
        this.logger.info('SQLite binary database pulled successfully from HF.');
        
        // Re-open SQLite connection and prepare statements
        this.sqlDb = new Database(DB_PATH);
        this.sqlDb.pragma('journal_mode = WAL');
        
        this.getGlobalStmt = this.sqlDb.prepare('SELECT value_json FROM global_config WHERE key = ?');
        this.setGlobalStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO global_config (key, value_json) VALUES (?, ?)');
        this.getGuildStmt = this.sqlDb.prepare('SELECT key, value_json FROM guild_config WHERE guild_id = ?');
        this.setGuildKeyStmt = this.sqlDb.prepare('INSERT OR REPLACE INTO guild_config (guild_id, key, value_json) VALUES (?, ?, ?)');
        this.deleteGuildStmt = this.sqlDb.prepare('DELETE FROM guild_config WHERE guild_id = ?');
      } else {
        this.logger.warn('SQLite database pull returned empty/pointer buffer. Starting fresh.');
      }
    } catch (err) {
      this.logger.error(`Cloud database sync failed: ${err.message}`);
    }
  }
}

module.exports = DatabaseManager;
