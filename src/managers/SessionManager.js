class SessionManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.conversations = new Map();
    this.sessionLocks = new Map();
    this.maxHistory = 10;
  }

  async onInit() {
    this.logger.info('Initializing Session Manager...');
  }

  async onShutdown() {
    this.logger.info('Shutting down Session Manager...');
    this.conversations.clear();
    this.sessionLocks.clear();
  }

  resolveSessionKey(userId, context = {}) {
    const appId = context.applicationId || 'global';
    const guildId = context.guildId || 'dm';
    const channelId = context.channelId || 'none';
    const threadId = context.threadId || 'none';
    const shardId = context.shardId || '0';
    const sessionUuid = context.sessionUuid || 'default';
    
    return `app:${appId}:guild:${guildId}:channel:${channelId}:thread:${threadId}:shard:${shardId}:session:${sessionUuid}:user:${userId}`;
  }

  getHistory(userId, context = {}) {
    const key = this.resolveSessionKey(userId, context);
    if (!this.conversations.has(key)) {
      this.conversations.set(key, []);
    }
    return this.conversations.get(key);
  }

  addToHistory(userId, role, content, context = {}) {
    const key = this.resolveSessionKey(userId, context);
    const history = this.getHistory(userId, context);
    history.push({ role, content });
    if (history.length > this.maxHistory) {
      history.splice(0, history.length - this.maxHistory);
    }
    this.logger.debug(`Saved message role "${role}" to session memory. Total history size: ${history.length}`);
  }

  clearHistory(userId, context = {}) {
    const key = this.resolveSessionKey(userId, context);
    this.conversations.delete(key);
    this.logger.debug(`Cleared isolated conversation memory for session key: ${key}`);
  }

  async acquireLock(sessionKey) {
    while (this.sessionLocks.get(sessionKey)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.sessionLocks.set(sessionKey, true);
  }

  releaseLock(sessionKey) {
    this.sessionLocks.delete(sessionKey);
  }
}

module.exports = SessionManager;
