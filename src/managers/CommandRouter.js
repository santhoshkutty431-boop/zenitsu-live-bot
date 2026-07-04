class CommandRouter {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.commands = new Map();
  }

  async onInit() {
    this.logger.info('Initializing Command Router...');
  }

  async onShutdown() {
    this.logger.info('Shutting down Command Router...');
    this.commands.clear();
  }

  registerCommand(name, handler) {
    if (typeof handler !== 'function') throw new Error('Command handler must be a function');
    this.commands.set(name, handler);
    this.logger.debug(`Command registered: /${name}`);
  }

  async route(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const cmdName = interaction.commandName;
    const handler = this.commands.get(cmdName);

    if (!handler) {
      this.logger.warn(`Received unregistered command: /${cmdName}`);
      return interaction.reply({ content: '❌ Command not found or currently inactive.', ephemeral: true });
    }

    this.logger.info(`Routing command /${cmdName} for user ${interaction.user.tag}`);
    
    try {
      await handler(interaction);
    } catch (err) {
      this.logger.error(`Error executing command /${cmdName}: ${err.message}`, { stack: err.stack });
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ An internal error occurred while executing this command.', ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: '❌ An internal error occurred while executing this command.', ephemeral: true }).catch(() => {});
      }
    }
  }
}

module.exports = CommandRouter;
