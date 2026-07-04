class WorkflowEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = runtime.getService('DatabaseManager');
  }

  async onInit() {
    this.logger.info('Initializing Workflow Engine...');
    
    // Wire triggers to event listeners
    const eventBus = this.runtime.eventBus;
    eventBus.subscribe('MEMBER_JOIN', (d) => this.runTrigger('onMemberJoin', d));
    eventBus.subscribe('TICKET_OPEN', (d) => this.runTrigger('onTicketOpen', d));
  }

  async onShutdown() {
    this.logger.info('Shutting down Workflow Engine...');
  }

  async runTrigger(triggerName, details = {}) {
    const db = this.dbService.db;
    db.workflows = db.workflows || {};

    const wf = db.workflows[triggerName];
    if (!wf || !wf.activeVersion || !wf.versions) return;

    const versionData = wf.versions[wf.activeVersion];
    if (!versionData || !versionData.actions) return;

    this.logger.info(`[WORKFLOW] Running workflow trigger "${triggerName}" (v${wf.activeVersion})`);

    for (const action of versionData.actions) {
      try {
        await this.executeAction(action, details);
      } catch (err) {
        this.logger.error(`[WORKFLOW] Action ${action.type} failed: ${err.message}`);
      }
    }
  }

  async executeAction(action, details) {
    const guild = details.guild;
    const member = details.member;

    if (action.type === 'giveRole' && member) {
      const role = guild.roles.cache.get(action.roleId);
      if (role) {
        await member.roles.add(role);
        this.logger.debug(`[WORKFLOW ACTION] Gave role ${role.name} to ${member.user.tag}`);
      }
    }

    else if (action.type === 'sendWelcome' && guild) {
      const channel = guild.channels.cache.get(action.channelId);
      if (channel) {
        await channel.send(`🎉 Welcome to the server, ${member}! We are glad to have you here!`);
      }
    }

    else if (action.type === 'dmUser' && member) {
      await member.send(action.text).catch(() => {});
    }
  }

  saveWorkflowVersion(triggerName, actions) {
    const db = this.dbService.db;
    db.workflows = db.workflows || {};

    if (!db.workflows[triggerName]) {
      db.workflows[triggerName] = {
        activeVersion: 1,
        versions: {}
      };
    }

    const wf = db.workflows[triggerName];
    const newVersion = Object.keys(wf.versions).length + 1;
    
    wf.versions[newVersion] = {
      actions,
      timestamp: new Date().toISOString()
    };
    wf.activeVersion = newVersion;
    
    this.dbService.save();
    return newVersion;
  }

  rollbackWorkflow(triggerName, version) {
    const db = this.dbService.db;
    db.workflows = db.workflows || {};

    const wf = db.workflows[triggerName];
    if (!wf || !wf.versions[version]) return false;

    wf.activeVersion = version;
    this.dbService.save();
    return true;
  }
}

module.exports = WorkflowEngine;
