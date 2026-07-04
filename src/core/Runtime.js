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
    process.on('uncaughtException', (error) => {
      this.logger.critical('Uncaught Exception thrown:', {
        error: error.message,
        stack: error.stack
      });
      this.shutdown('UNCAUGHT_EXCEPTION');
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
