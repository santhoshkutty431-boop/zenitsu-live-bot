const os = require('os');

class HealthMonitor {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.discordClient = null;
    
    // Heartbeat check every 5 minutes
    this.heartbeatInterval = null;
  }

  async onInit() {
    this.logger.info('Initializing Health Monitor...');
    this.heartbeatInterval = setInterval(() => this.heartbeat(), 300000);
  }

  async onShutdown() {
    this.logger.info('Shutting down Health Monitor...');
    clearInterval(this.heartbeatInterval);
  }

  setDiscordClient(client) {
    this.discordClient = client;
  }

  async heartbeat() {
    const memoryUsage = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const cpuLoad = os.loadavg();

    const metrics = {
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
      systemFreeMemGb: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100,
      cpuLoad1m: cpuLoad[0]
    };

    if (this.discordClient) {
      metrics.gatewayPing = this.discordClient.ws.ping;
    }

    this.logger.info(`[HEALTH MONITOR] Heartbeat check:`, metrics);
    await this.runtime.eventBus.publish('HEALTH_HEARTBEAT', metrics);

    // Self-healing triggers
    await this.selfHeal(metrics);
  }

  async selfHeal(metrics) {
    // 1. High Memory Check (Heap > 800MB on free tiers or restricted VMs)
    if (metrics.heapUsedMb > 800) {
      this.logger.warn(`[SELF HEALING] High memory usage detected (${metrics.heapUsedMb}MB). Flushing cache and forcing garbage collection if available.`);
      const cacheService = this.runtime.getService('CacheManager');
      if (cacheService) {
        cacheService.clear();
      }
      if (global.gc) {
        global.gc();
      }
    }

    // 2. Gateway Timeout Check
    if (metrics.gatewayPing !== undefined && metrics.gatewayPing > 1000) {
      this.logger.warn(`[SELF HEALING] Critical Discord gateway latency detected: ${metrics.gatewayPing}ms. Logging warning...`);
    }
  }

  getMetrics() {
    const memoryUsage = process.memoryUsage();
    return {
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      systemFreeGb: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100,
      cpuLoad: os.loadavg(),
      uptimeSeconds: Math.round(process.uptime())
    };
  }
}

module.exports = HealthMonitor;
