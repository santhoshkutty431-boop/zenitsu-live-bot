const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createCase, formatCaseEmbed } = require('../../../modules/case-manager');

class ModerationPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = runtime.getService('DatabaseManager');
    this.router = runtime.getService('CommandRouter');
  }

  async onLoad() {
    this.logger.info('Loading Moderation Plugin...');

    // Register Moderation commands
    this.router.registerCommand('warn', (i) => this.handleWarn(i));
    this.router.registerCommand('kick', (i) => this.handleKick(i));
    this.router.registerCommand('ban', (i) => this.handleBan(i));
    this.router.registerCommand('purge', (i) => this.handlePurge(i));
  }

  async onUnload() {
    this.logger.info('Unloading Moderation Plugin...');
  }

  async handleWarn(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const caseData = await createCase(interaction.guild, {
      userId: target.id,
      userTag: target.tag,
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
      type: 'WARN',
      reason
    });

    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handleKick(interaction) {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target.kickable) {
      return interaction.reply({ content: '❌ I cannot kick this user. They may have a higher role than me.', ephemeral: true });
    }

    await target.kick(reason);

    const caseData = await createCase(interaction.guild, {
      userId: target.id,
      userTag: target.user.tag,
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
      type: 'KICK',
      reason
    });

    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handleBan(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    await interaction.guild.members.ban(target, { reason });

    const caseData = await createCase(interaction.guild, {
      userId: target.id,
      userTag: target.tag,
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
      type: 'BAN',
      reason
    });

    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handlePurge(interaction) {
    const count = interaction.options.getInteger('count');
    if (count < 1 || count > 100) {
      return interaction.reply({ content: '❌ Purge count must be between 1 and 100.', ephemeral: true });
    }

    await interaction.channel.bulkDelete(count, true);
    await interaction.reply({ content: `🧹 Successfully purged ${count} messages.`, ephemeral: true });
  }
}

module.exports = ModerationPlugin;
