const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class AIPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = runtime.getService('DatabaseManager');
    this.router = runtime.getService('CommandRouter');
    this.aiProvider = runtime.getService('AIProviderManager');
    this.sessionService = runtime.getService('SessionManager');
  }

  async onLoad() {
    this.logger.info('Loading AI Plugin...');

    this.router.registerCommand('ai', (i) => this.handleAiQuery(i));
    this.router.registerCommand('ai-reset', (i) => this.handleAiReset(i));
    this.router.registerCommand('ai-lang', (i) => this.handleAiLang(i));
    this.router.registerCommand('ai-model', (i) => this.handleAiModel(i));
  }

  async onUnload() {
    this.logger.info('Unloading AI Plugin...');
  }

  async handleAiQuery(interaction) {
    const prompt = interaction.options.getString('prompt');
    const selectedModel = interaction.options.getString('model') || this.dbService.get('aiDefaultModel', 'gemini');

    await interaction.deferReply();

    const history = this.sessionService.getHistory(interaction.user.id, {
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });

    const systemPrompt = `You are ZENITSU AI. Reply directly to ${interaction.user.username}.`;

    const result = await this.aiProvider.query(
      interaction.user.id,
      prompt,
      selectedModel,
      systemPrompt,
      [...history, { role: 'user', content: prompt }]
    );

    if (result.error) {
      return interaction.editReply({ content: result.message });
    }

    // Save to isolated session memory
    this.sessionService.addToHistory(interaction.user.id, 'user', prompt, {
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });
    this.sessionService.addToHistory(interaction.user.id, 'assistant', result.response, {
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });

    const aiEmbed = new EmbedBuilder()
      .setAuthor({
        name: 'ZENITSU AI',
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .addFields(
        { name: '💬 Your Question', value: prompt.slice(0, 1024) },
        { name: '🤖 Answer', value: `<@${interaction.user.id}>\n\n${result.response.slice(0, 1024)}` }
      )
      .setColor(0x00D4FF)
      .setFooter({ text: 'ZENITSU AI • Click buttons below to interact' })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_channel_reset_${interaction.user.id}`).setLabel('💬 Reset Memory').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`ai_channel_message_${interaction.user.id}`).setLabel('🤖 Message AI').setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [aiEmbed], components: [actionRow] });
  }

  async handleAiReset(interaction) {
    this.sessionService.clearHistory(interaction.user.id, {
      guildId: interaction.guildId,
      channelId: interaction.channelId
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🧹 AI Memory Cleared')
          .setDescription('Your isolated conversation memory on this channel has been completely reset.')
          .setColor(0xEDC231)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  async handleAiLang(interaction) {
    const selectedLang = interaction.options.getString('language');
    const userLanguages = this.dbService.get('userLanguages', {});
    userLanguages[interaction.user.id] = selectedLang;
    await this.dbService.set('userLanguages', userLanguages);

    const names = { english: 'English 🇬🇧', hinglish: 'Hinglish 🇮🇳', tanglish: 'Tanglish 🐯' };
    await interaction.reply({
      content: `✅ Your preferred AI language has been set to **${names[selectedLang]}**!`,
      ephemeral: true
    });
  }

  async handleAiModel(interaction) {
    const selectedModel = interaction.options.getString('model');
    await this.dbService.set('aiDefaultModel', selectedModel);

    const modelNames = {
      gemini: '🔷 Gemini 2.0 Flash (Free)',
      gpt4o: '🟢 GPT-4o (Best)',
      gpt35: '🟡 GPT-3.5 Turbo (Fast & Cheap)',
      groq: '⚡ Groq Llama-3.3-70b (Free+Fast)'
    };

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Default AI Model Updated')
          .setDescription(`The default AI model has been set to **${modelNames[selectedModel]}**.`)
          .setColor(0x2ECC71)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }
}

module.exports = AIPlugin;
