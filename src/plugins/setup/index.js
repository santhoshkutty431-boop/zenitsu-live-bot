const { PermissionFlagsBits } = require('discord.js');

class SetupPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
  }

  get setupWizard() {
    return this.runtime.getService('SetupWizard');
  }

  async onLoad() {
    this.logger.info('Loading Setup Plugin...');
    this.router.registerCommand('setup', (i) => this.execute(i));
  }

  async onUnload() {
    this.logger.info('Unloading Setup Plugin...');
  }

  async execute(interaction) {
    await interaction.reply({
      content: '🧙 Launching Setup Wizard...',
      ephemeral: true,
    });

    await this.setupWizard.deliver(interaction.guild);
  }
}

module.exports = SetupPlugin;
