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

    // Register commands
    this.router.registerCommand('warn', (i) => this.handleWarn(i));
    this.router.registerCommand('kick', (i) => this.handleKick(i));
    this.router.registerCommand('ban', (i) => this.handleBan(i));
    this.router.registerCommand('purge', (i) => this.handlePurge(i));

    // Register Tools in Cognition Engine
    const cognition = this.runtime.getService('CognitionEngine');
    if (cognition && cognition.toolSelector) {
      cognition.toolSelector.registerTool('warnUser', {
        name: 'warnUser',
        description: 'Warns a user for rule violations',
        handler: async (d) => this.directWarn(d.guild, d.userId, d.executorId, d.executorTag, d.reason)
      });
      cognition.toolSelector.registerTool('kickUser', {
        name: 'kickUser',
        description: 'Kicks a user from the server',
        handler: async (d) => this.directKick(d.guild, d.userId, d.executorId, d.executorTag, d.reason)
      });
      cognition.toolSelector.registerTool('banUser', {
        name: 'banUser',
        description: 'Bans a user from the server',
        handler: async (d) => this.directBan(d.guild, d.userId, d.executorId, d.executorTag, d.reason)
      });
      cognition.toolSelector.registerTool('purgeMessages', {
        name: 'purgeMessages',
        description: 'Deletes a count of messages from a channel',
        handler: async (d) => this.directPurge(d.channel, d.count)
      });
    }
  }

  async onUnload() {
    this.logger.info('Unloading Moderation Plugin...');
  }

  async directWarn(guild, userId, executorId, executorTag, reason) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('User not found in this server.');

    const caseData = await createCase(guild, {
      userId,
      userTag: member.user.tag,
      executorId,
      executorTag,
      type: 'WARN',
      reason
    });
    return caseData;
  }

  async directKick(guild, userId, executorId, executorTag, reason) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('User not found in this server.');
    if (!member.kickable) throw new Error('I cannot kick this member. Role hierarchy restriction.');

    await member.kick(reason);
    const caseData = await createCase(guild, {
      userId,
      userTag: member.user.tag,
      executorId,
      executorTag,
      type: 'KICK',
      reason
    });
    return caseData;
  }

  async directBan(guild, userId, executorId, executorTag, reason) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const tag = member ? member.user.tag : `User ID: ${userId}`;

    await guild.members.ban(userId, { reason });
    const caseData = await createCase(guild, {
      userId,
      userTag: tag,
      executorId,
      executorTag,
      type: 'BAN',
      reason
    });
    return caseData;
  }

  async directPurge(channel, count) {
    if (count < 1 || count > 100) throw new Error('Purge count must be between 1 and 100.');
    const deleted = await channel.bulkDelete(count, true);
    return deleted.size;
  }

  // Command handlers
  async handleWarn(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const caseData = await this.directWarn(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handleKick(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const caseData = await this.directKick(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handleBan(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const caseData = await this.directBan(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
    const embed = formatCaseEmbed(caseData);
    await interaction.reply({ embeds: [embed] });
  }

  async handlePurge(interaction) {
    const count = interaction.options.getInteger('count');
    const deletedCount = await this.directPurge(interaction.channel, count);
    await interaction.reply({ content: `🧹 Successfully purged ${deletedCount} messages.`, ephemeral: true });
  }
}

module.exports = ModerationPlugin;
