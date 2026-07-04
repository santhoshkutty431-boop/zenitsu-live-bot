class SecurityPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
    this.dbService = runtime.getService('DatabaseManager');
  }

  async onLoad() {
    this.logger.info('Loading Security Plugin...');
    this.router.registerCommand('security', (i) => this.handleSecurity(i));
  }

  async onUnload() {
    this.logger.info('Unloading Security Plugin...');
  }

  async handleSecurity(interaction) {
    const config = this.dbService.get('securityConfig') || {};
    
    // Simple response mapping for now (real anti-abuse resides in modules/security.js)
    await interaction.reply({
      content: `🔒 **Server Security Configuration** is active.\nAnti-Raid: \`${config.antiRaid ? 'ON' : 'OFF'}\`\nAnti-Spam: \`${config.antiSpam ? 'ON' : 'OFF'}\``,
      ephemeral: true
    });
  }
}

module.exports = SecurityPlugin;
