class CacheManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    
    // Periodically clean expired keys
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async onInit() {
    this.logger.info('Initializing Cache Manager...');
  }

  async onShutdown() {
    this.logger.info('Shutting down Cache Manager...');
    clearInterval(this.cleanupInterval);
    this.clear();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expires && entry.expires < Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  set(key, value, ttlMs = 0) {
    const expires = ttlMs > 0 ? Date.now() + ttlMs : null;
    this.cache.set(key, { value, expires });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && entry.expires < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cache cleanup removed ${cleaned} expired key(s).`);
    }
  }

  getMetrics() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0
    };
  }
}

module.exports = CacheManager;
