class TicketPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
  }

  async onLoad() {
    this.logger.info('Loading Tickets Plugin...');
    this.router.registerCommand('setup-panel', (i) => this.handleSetupPanel(i));
  }

  async onUnload() {
    this.logger.info('Unloading Tickets Plugin...');
  }

  async handleSetupPanel(interaction) {
    // Simple response mapping for now (real panel builder logic is in index.js)
    await interaction.reply({
      content: '🎫 **Ticket Setup Panel Builder** initialized. Run `/setup-panel` to configure.',
      ephemeral: true
    });
  }
}

module.exports = TicketPlugin;
