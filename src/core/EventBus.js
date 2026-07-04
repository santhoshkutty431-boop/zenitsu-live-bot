class EventBus {
  constructor(logger) {
    this.listeners = new Map();
    this.logger = logger;
  }

  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    this.logger?.debug(`Subscriber added for event: ${event}`);
  }

  unsubscribe(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
      this.logger?.debug(`Subscriber removed for event: ${event}`);
    }
  }

  async publish(event, data = {}) {
    const callbacks = this.listeners.get(event);
    if (!callbacks || callbacks.length === 0) return;

    this.logger?.debug(`Publishing event: ${event}`, { data });

    // Run subscribers asynchronously and safely
    const promises = callbacks.map(async (cb) => {
      try {
        await cb(data);
      } catch (err) {
        this.logger?.error(`Error in event listener for [${event}]:`, {
          error: err.message,
          stack: err.stack
        });
      }
    });

    await Promise.all(promises);
  }
}

module.exports = EventBus;
