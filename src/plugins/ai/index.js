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

  generateAuditId() {
    return 'WL-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100000 + Math.random() * 900000);
  }

  async handleAiQuery(interaction) {
    const allowed = this.dbService.checkAndRecordQuery(interaction.guildId, interaction.user.id);
    if (!allowed) {
      return interaction.reply({
        content: "⏳ You've reached your hourly AI query limit. Try again later.",
        ephemeral: true
      });
    }

    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    // Everything below has to be wrapped — if any step throws (Gemini rate
    // limit, cognition sub-engine, verification, network glitch) and we don't
    // editReply, the interaction stays on "Sentinel Security is thinking..."
    // forever.
    let result;
    try {
      const cognition = this.runtime.getService('CognitionEngine');
      result = await cognition.processRequest(
        interaction.user.id,
        interaction.guildId,
        interaction.guild,
        prompt
      );
    } catch (err) {
      this.logger.error(`[/ai] processRequest threw: ${err.message}`, { stack: err.stack });
      return interaction.editReply({
        content: `❌ AI request failed: \`${err.message}\`\nPlease try again. If it keeps happening, check the bot logs.`
      }).catch(() => {});
    }

    if (!result) {
      return interaction.editReply({ content: '❌ AI returned no response. Try again.' }).catch(() => {});
    }

    if (result.error) {
      return interaction.editReply({ content: result.message || '❌ AI Query failed.' }).catch(() => {});
    }

    if (result.status === 'PENDING_APPROVAL') {
      const auditId = this.generateAuditId();
      this.dbService.db.pendingApprovals = this.dbService.db.pendingApprovals || {};
      this.dbService.db.pendingApprovals[auditId] = {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        plan: result.plan,
        tools: result.tools
      };
      this.dbService.save();

      const approvalEmbed = new EmbedBuilder()
        .setTitle('🔒 Security Action Approval Required')
        .setDescription(`The AI planner proposed a potentially destructive action during a request by ${interaction.user}:`)
        .addFields(
          { name: 'Proposed Action', value: `\`${result.plan.actionsProposed.join(', ')}\`` },
          { name: 'Audit ID', value: `\`${auditId}\`` }
        )
        .setColor(0xF39C12)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_action_${auditId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_action_${auditId}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({ embeds: [approvalEmbed], components: [row] });
    }

    // Guard against missing response payload (some pipeline branches return
    // only { response: '...' } vs. richer shapes)
    const answerText = result.response || result.message || 'No response.';

    try {
      // Save to isolated session memory
      this.sessionService.addToHistory(interaction.user.id, 'user', prompt, {
        guildId: interaction.guildId,
        channelId: interaction.channelId
      });
      this.sessionService.addToHistory(interaction.user.id, 'assistant', answerText, {
        guildId: interaction.guildId,
        channelId: interaction.channelId
      });
    } catch (err) {
      this.logger.warn(`[/ai] Session save failed: ${err.message}`);
    }

    const aiEmbed = new EmbedBuilder()
      .setAuthor({
        name: 'ZENITSU AI',
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .addFields(
        { name: '💬 Your Question', value: prompt.slice(0, 1024) },
        { name: '🤖 Answer', value: `<@${interaction.user.id}>\n\n${answerText.slice(0, 1024)}` }
      )
      .setColor(0x00D4FF)
      .setFooter({ text: 'ZENITSU AI • Click buttons below to interact' })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_channel_reset_${interaction.user.id}`).setLabel('💬 Reset Memory').setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({ embeds: [aiEmbed], components: [actionRow] }).catch(err => {
      this.logger.error(`[/ai] editReply failed: ${err.message}`);
    });
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
