class AskPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  get knowledgeEngine() {
    return this.runtime.getService('KnowledgeEngine');
  }

  async onLoad() {
    this.logger.info('Loading Ask Plugin...');
    this.router.registerCommand('ask', (i) => this.execute(i));
  }

  async onUnload() {
    this.logger.info('Unloading Ask Plugin...');
  }

  async execute(interaction) {
    const gdb = this.dbService.getGuildDb(interaction.guildId);

    if (!gdb.setupCompleted) {
      return interaction.reply({
        content: "⚙️ Sentinel hasn't been set up yet. An admin can run `/setup` to configure it.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const question = interaction.options.getString('question');

    try {
      const answer = await this.knowledgeEngine.query(
        interaction.guildId,
        interaction.user.id,
        interaction.member,
        question,
      );

      await interaction.editReply({ content: answer });
    } catch (err) {
      this.logger.error(`[Ask] Query error: ${err.message}`, err);
      await interaction.editReply({
        content: '❌ Something went wrong processing your question. Please try again later.',
      });
    }
  }
}

module.exports = AskPlugin;
