class TaskScheduler {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.timers = new Map();
    this.intervals = new Map();
  }

  async onInit() {
    this.logger.info('Initializing Task Scheduler...');
  }

  async onShutdown() {
    this.logger.info('Shutting down Task Scheduler, cancelling all active schedules...');
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.timers.clear();
    this.intervals.clear();
  }

  schedule(name, delayMs, callback) {
    this.cancel(name);
    
    this.logger.debug(`Scheduling one-shot task [${name}] to run in ${delayMs}ms.`);
    const timer = setTimeout(async () => {
      this.timers.delete(name);
      try {
        await callback();
      } catch (err) {
        this.logger.error(`Error in scheduled task [${name}]: ${err.message}`);
      }
    }, delayMs);

    this.timers.set(name, timer);
  }

  cron(name, intervalMs, callback) {
    this.cancel(name);

    this.logger.debug(`Scheduling recurring cron task [${name}] every ${intervalMs}ms.`);
    const interval = setInterval(async () => {
      try {
        await callback();
      } catch (err) {
        this.logger.error(`Error in recurring cron task [${name}]: ${err.message}`);
      }
    }, intervalMs);

    this.intervals.set(name, interval);
  }

  cancel(name) {
    if (this.timers.has(name)) {
      clearTimeout(this.timers.get(name));
      this.timers.delete(name);
      this.logger.debug(`Cancelled scheduled task [${name}].`);
      return true;
    }
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
      this.intervals.delete(name);
      this.logger.debug(`Cancelled recurring cron task [${name}].`);
      return true;
    }
    return false;
  }
}

module.exports = TaskScheduler;
