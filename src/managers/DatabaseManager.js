const fs = require('fs');
const path = require('path');
const https = require('https');

class DatabaseManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.config = runtime.config.getSystemConfig();
    this.dbPath = path.join(__dirname, '../../database.json');
    
    this.db = {
      songQueue: [],
      activeTickets: {},
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
      serverWhitelist: [],
      ticketLanguages: {},
      userLanguages: {},
      guildWhitelists: {},
      permissionSchemaVersion: 4
    };

    this.writeQueue = Promise.resolve();
    this.dbFileLastModified = 0;
  }

  async onInit() {
    this.logger.info('Initializing Database Manager...');
    await this.load();
  }

  async onShutdown() {
    this.logger.info('Shutting down Database Manager, performing final save...');
    await this.save();
  }

  async load() {
    // 1. Download from Hugging Face Cloud Storage if token is available
    if (this.config.hfToken) {
      this.logger.info('HF_TOKEN detected. Attempting to download cloud database...');
      try {
        const cloudDb = await this.downloadFromHf();
        if (cloudDb) {
          this.db = { ...this.db, ...cloudDb };
          this.logger.info('Cloud database synchronized successfully.');
          return;
        }
      } catch (err) {
        this.logger.error(`Cloud database download failed: ${err.message}`);
      }
    }

    // 2. Local fallback
    if (fs.existsSync(this.dbPath)) {
      try {
        const stats = fs.statSync(this.dbPath);
        this.dbFileLastModified = stats.mtimeMs;
        const fileContent = fs.readFileSync(this.dbPath, 'utf8');
        const diskDb = JSON.parse(fileContent);
        this.db = { ...this.db, ...diskDb };
        this.logger.info('Local database loaded successfully.');
      } catch (err) {
        this.logger.error(`Failed to load local database: ${err.message}`);
      }
    } else {
      this.logger.warn('No database.json file found. Starting with default state.');
      await this.save();
    }
  }

  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const content = JSON.stringify(this.db, null, 2);
        fs.writeFileSync(this.dbPath, content, 'utf8');
        
        // Upload to Hugging Face Cloud Storage if token is available
        if (this.config.hfToken) {
          await this.uploadToHf(content);
        }
      } catch (err) {
        this.logger.error(`Failed to save database: ${err.message}`);
      }
    });
    return this.writeQueue;
  }

  get(key, defaultValue = null) {
    return this.db[key] !== undefined ? this.db[key] : defaultValue;
  }

  async set(key, value) {
    this.db[key] = value;
    await this.save();
    await this.runtime.eventBus.publish('DB_KEY_UPDATED', { key, value });
  }

  async update(key, updateFn) {
    if (typeof updateFn !== 'function') throw new Error('Update argument must be a function');
    this.db[key] = updateFn(this.db[key]);
    await this.save();
    await this.runtime.eventBus.publish('DB_KEY_UPDATED', { key, value: this.db[key] });
    return this.db[key];
  }

  // Hugging Face cloud integration
  downloadFromHf() {
    return new Promise((resolve, reject) => {
      const url = `https://huggingface.co/api/spaces/${this.config.hfRepo}/raw/main/database.json`;
      const options = {
        headers: { 'Authorization': `Bearer ${this.config.hfToken}` }
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) {
          return resolve(null); // File might not exist yet
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON received from Hugging Face'));
          }
        });
      }).on('error', reject);
    });
  }

  uploadToHf(content) {
    return new Promise((resolve, reject) => {
      const commitPayload = {
        actions: [
          {
            action: 'add',
            path: 'database.json',
            content: Buffer.from(content).toString('base64')
          }
        ],
        summary: 'Update database.json state',
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
            this.logger.debug('HF Database upload completed successfully.');
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
}

module.exports = DatabaseManager;
