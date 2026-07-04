class AnalyticsManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = runtime.getService('DatabaseManager');
  }

  async onInit() {
    this.logger.info('Initializing Analytics Manager...');
    
    // Subscribe to EventBus notifications
    const eventBus = this.runtime.eventBus;
    eventBus.subscribe('MEMBER_JOIN', () => this.trackMetric('joins'));
    eventBus.subscribe('TICKET_OPEN', () => this.trackMetric('ticketsOpened'));
    eventBus.subscribe('COMMAND_RUN', (d) => this.trackCommand(d.commandName));
    eventBus.subscribe('SPAM_BLOCKED', () => this.trackMetric('spamBlocked'));
  }

  async onShutdown() {
    this.logger.info('Shutting down Analytics Manager...');
  }

  trackMetric(metricName) {
    const db = this.dbService.db;
    db.analyticsData = db.analyticsData || {
      joins: 0,
      ticketsOpened: 0,
      spamBlocked: 0,
      commands: {},
      hourlyRequests: []
    };

    db.analyticsData[metricName] = (db.analyticsData[metricName] || 0) + 1;
    this.dbService.save();
  }

  trackCommand(commandName) {
    const db = this.dbService.db;
    db.analyticsData = db.analyticsData || {
      joins: 0,
      ticketsOpened: 0,
      spamBlocked: 0,
      commands: {},
      hourlyRequests: []
    };

    db.analyticsData.commands[commandName] = (db.analyticsData.commands[commandName] || 0) + 1;
    this.dbService.save();
  }

  getStats() {
    const db = this.dbService.db;
    return db.analyticsData || {
      joins: 0,
      ticketsOpened: 0,
      spamBlocked: 0,
      commands: {},
      hourlyRequests: []
    };
  }
}

module.exports = AnalyticsManager;
