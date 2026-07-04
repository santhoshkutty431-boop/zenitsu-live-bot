const Logger = require('./Logger');
const EventBus = require('./EventBus');
const Config = require('./Config');

class Runtime {
  constructor() {
    this.logger = new Logger();
    this.eventBus = new EventBus(this.logger);
    this.config = new Config();
    this.services = new Map();
    this.isShuttingDown = false;
  }

  registerService(name, serviceInstance) {
    this.services.set(name, serviceInstance);
    this.logger.info(`Service registered: ${name}`);
  }

  getService(name) {
    return this.services.get(name);
  }

  async bootstrap() {
    this.logger.info('Initializing ZENITSU LIVE v4.0 Core Runtime...');
    
    // Register process exit listeners for clean shutdowns
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Promise Rejection:', {
        reason: reason?.message || reason,
        stack: reason?.stack
      });
    });
    // Historically this handler called shutdown() on EVERY uncaught exception,
    // which meant ONE misbehaving background task (music tick, HTTP hiccup,
    // event listener throwing) would kill the whole bot — Koyeb would restart
    // it, but every deferred interaction in flight would get orphaned as
    // "Sentinel Security is thinking..." forever, because the code that would
    // have called editReply() no longer exists.
    //
    // Now we just log. If the process is genuinely unrecoverable, Node will
    // let it die on its own via a subsequent hard fault; if it's a
    // recoverable one-off, the bot keeps serving other requests.
    process.on('uncaughtException', (error) => {
      this.logger.critical('Uncaught Exception (bot continues running):', {
        error: error.message,
        stack: error.stack
      });
    });

    // Start all registered services in order
    for (const [name, service] of this.services.entries()) {
      if (typeof service.onInit === 'function') {
        this.logger.info(`Starting service: ${name}...`);
        await service.onInit();
      }
    }

    this.logger.info('ZENITSU LIVE v4.0 Runtime Bootstrap Completed.');
    await this.eventBus.publish('RUNTIME_READY', { timestamp: Date.now() });
  }

  async shutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    this.logger.critical(`Shutdown signal received (${signal}). Stopping runtime services...`);
    await this.eventBus.publish('RUNTIME_SHUTTING_DOWN', { signal });

    // Stop all registered services in reverse order
    const serviceNames = Array.from(this.services.keys()).reverse();
    for (const name of serviceNames) {
      const service = this.services.get(name);
      if (typeof service.onShutdown === 'function') {
        this.logger.info(`Stopping service: ${name}...`);
        try {
          await service.onShutdown();
        } catch (err) {
          this.logger.error(`Error stopping service ${name}: ${err.message}`);
        }
      }
    }

    this.logger.info('ZENITSU LIVE v4.0 Runtime stopped cleanly. Exiting process.');
    process.exit(signal === 'UNCAUGHT_EXCEPTION' ? 1 : 0);
  }
}

module.exports = Runtime;
