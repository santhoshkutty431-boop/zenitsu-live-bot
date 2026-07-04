const fs = require('fs');
const path = require('path');
const https = require('https');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = path.resolve(__dirname, '../../data');
const GLOBAL_PATH = path.join(DATA_DIR, 'global.json');
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');

const asyncLocalStorage = new AsyncLocalStorage();
global.asyncLocalStorage = asyncLocalStorage; // Expose globally for index.js wrapper

const DEFAULT_GLOBAL = {
  permissionSchemaVersion: 5.2,
  developerIds: [],
  serverWhitelist: [],
  featureFlags: {
    knowledgeEngine: true,
    liveSync: true,
    costControls: true,
  },
  // Legacy keys at global level
  songQueue: [],
  serverWhitelist: [],
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
    queriesPerUserPerHour: 10,
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

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(GUILDS_DIR)) fs.mkdirSync(GUILDS_DIR, { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function guildPath(guildId) {
  return path.join(GUILDS_DIR, `${guildId}.json`);
}

class DatabaseManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime ? runtime.logger : console;
    this.config = runtime ? runtime.config.getSystemConfig() : {};
    
    ensureDirs();
    this._globalCache = null;
    this._guildCache = new Map();

    this.dirtyFiles = new Set();
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

  async onInit() {
    this.logger.info('Initializing Database Manager (v5.2 isolated storage)...');
    await this.loadAll();
  }

  async onShutdown() {
    this.logger.info('Shutting down Database Manager, doing final cloud save...');
    await this.flushToHf();
  }

  // ─── Global ─────────────────────────────────────────────────────────────────

  getGlobal() {
    if (!this._globalCache) {
      const stored = readJson(GLOBAL_PATH);
      this._globalCache = Object.assign({}, DEFAULT_GLOBAL, stored ?? {});
      if (!stored) this.saveGlobal();
    }
    return this._globalCache;
  }

  saveGlobal() {
    writeJson(GLOBAL_PATH, this._globalCache);
    this.dirtyFiles.add('global.json');
    this.scheduleSync();
  }

  // ─── Guild ──────────────────────────────────────────────────────────────────

  getGuildDb(guildId) {
    if (!guildId) throw new Error('getGuildDb requires a guildId');

    if (this._guildCache.has(guildId)) {
      return this._guildCache.get(guildId);
    }

    const filePath = guildPath(guildId);
    const stored = readJson(filePath);

    const db = this._deepMerge(
      JSON.parse(JSON.stringify(DEFAULT_GUILD)),
      stored ?? {}
    );

    if (!stored) {
      writeJson(filePath, db);
    }

    this._guildCache.set(guildId, db);
    return db;
  }

  saveGuildDb(guildId) {
    if (!this._guildCache.has(guildId)) return;
    const filePath = guildPath(guildId);
    writeJson(filePath, this._guildCache.get(guildId));
    this.dirtyFiles.add(`guilds/${guildId}.json`);
    this.scheduleSync();
  }

  deleteGuildDb(guildId) {
    const filePath = guildPath(guildId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this._guildCache.delete(guildId);
    this.dirtyFiles.add(`guilds/${guildId}.json`);
    this.scheduleSync();
  }

  guildExists(guildId) {
    return fs.existsSync(guildPath(guildId));
  }

  listGuildIds() {
    if (!fs.existsSync(GUILDS_DIR)) return [];
    return fs.readdirSync(GUILDS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json'));
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

  // ─── Cloud Sync ─────────────────────────────────────────────────────────────

  async loadAll() {
    this.getGlobal(); // Initialize global cache

    if (this.config.hfToken) {
      this.logger.info('HF_TOKEN detected. Downloading cloud assets...');
      try {
        await this.syncFromHf();
      } catch (err) {
        this.logger.error(`Cloud database sync failed: ${err.message}`);
      }
    }
  }

  scheduleSync() {
    if (!this.config.hfToken) return;
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(async () => {
      this.syncTimer = null;
      await this.flushToHf();
    }, 15000); // Auto sync every 15s
  }

  async flushToHf() {
    if (!this.config.hfToken || !this.dirtyFiles.size) return;

    this.writeQueue = this.writeQueue.then(async () => {
      const filesToSync = Array.from(this.dirtyFiles);
      this.dirtyFiles.clear();

      const actions = [];
      for (const relPath of filesToSync) {
        const absPath = path.join(DATA_DIR, relPath);
        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath);
          actions.push({
            action: 'add',
            path: `data/${relPath}`,
            content: content.toString('base64')
          });
        } else {
          actions.push({
            action: 'delete',
            path: `data/${relPath}`
          });
        }
      }

      try {
        await this.commitToHf(actions);
        this.logger.debug(`HF Cloud sync completed for: ${filesToSync.join(', ')}`);
      } catch (err) {
        this.logger.error(`HF sync failed: ${err.message}`);
        // Re-add to retry
        filesToSync.forEach(f => this.dirtyFiles.add(f));
      }
    });
    return this.writeQueue;
  }

  commitToHf(actions) {
    return new Promise((resolve, reject) => {
      const commitPayload = {
        actions,
        summary: 'Update isolated database files',
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
    // 1. Get file list under data/
    const listUrl = `https://huggingface.co/api/spaces/${this.config.hfRepo}/tree/main/data?recursive=true`;
    const options = {
      headers: { 'Authorization': `Bearer ${this.config.hfToken}` }
    };

    const files = await new Promise((resolve, reject) => {
      https.get(listUrl, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) return resolve([]);
            const list = JSON.parse(data);
            resolve(list.filter(item => item.type === 'file').map(item => item.path));
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]));
    });

    // 2. Download each file
    for (const hfPath of files) {
      if (!hfPath.startsWith('data/')) continue;
      const relPath = hfPath.substring(5); // strip data/
      const localPath = path.join(DATA_DIR, relPath);

      try {
        const fileContent = await this.downloadRawFile(hfPath);
        if (fileContent) {
          ensureDirs();
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(localPath, fileContent, 'utf8');
        }
      } catch (err) {
        this.logger.error(`Failed to download cloud file ${hfPath}: ${err.message}`);
      }
    }
  }

  downloadRawFile(hfPath) {
    return new Promise((resolve, reject) => {
      const url = `https://huggingface.co/api/spaces/${this.config.hfRepo}/raw/main/${hfPath}`;
      const options = {
        headers: { 'Authorization': `Bearer ${this.config.hfToken}` }
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && key in target) {
        Object.assign(source[key], this._deepMerge(target[key], source[key]));
      }
    }
    Object.assign(target || {}, source);
    return target;
  }
}

module.exports = DatabaseManager;
