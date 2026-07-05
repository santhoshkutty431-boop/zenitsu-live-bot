const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createCase, formatCaseEmbed } = require('../../../modules/case-manager');
const { logToChannel } = require('../../handlers/eventHandler');

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

    const caseData = createCase(this.dbService.db, () => this.dbService.save(), {
      guildId: guild.id,
      userId,
      userTag: member.user.tag,
      modId: executorId,
      modTag: executorTag,
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
    const caseData = createCase(this.dbService.db, () => this.dbService.save(), {
      guildId: guild.id,
      userId,
      userTag: member.user.tag,
      modId: executorId,
      modTag: executorTag,
      type: 'KICK',
      reason
    });
    return caseData;
  }

  async directBan(guild, userId, executorId, executorTag, reason) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const tag = member ? member.user.tag : `User ID: ${userId}`;

    await guild.members.ban(userId, { reason });
    const caseData = createCase(this.dbService.db, () => this.dbService.save(), {
      guildId: guild.id,
      userId,
      userTag: tag,
      modId: executorId,
      modTag: executorTag,
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
    try {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const caseData = await this.directWarn(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
      const embed = formatCaseEmbed(caseData);
      await logToChannel(interaction.guild, process.env.MOD_LOG_ID || '1521577060689248519', embed);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: `❌ Failed to warn user: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }

  async handleKick(interaction) {
    try {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const caseData = await this.directKick(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
      const embed = formatCaseEmbed(caseData);
      await logToChannel(interaction.guild, process.env.MOD_LOG_ID || '1521577060689248519', embed);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: `❌ Failed to kick member: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }

  async handleBan(interaction) {
    try {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const caseData = await this.directBan(interaction.guild, target.id, interaction.user.id, interaction.user.tag, reason);
      const embed = formatCaseEmbed(caseData);
      await logToChannel(interaction.guild, process.env.MOD_LOG_ID || '1521577060689248519', embed);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: `❌ Failed to ban user: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }

  async handlePurge(interaction) {
    try {
      const count = interaction.options.getInteger('amount') || 50;
      const deletedCount = await this.directPurge(interaction.channel, count);
      const logEmbed = new EmbedBuilder()
        .setTitle('🗑️ Messages Purged')
        .setDescription(`**Channel:** ${interaction.channel}\n**Count:** ${deletedCount}\n**By:** ${interaction.user}`)
        .setColor(0xE74C3C)
        .setTimestamp();
      await logToChannel(interaction.guild, process.env.MOD_LOG_ID || '1521577060689248519', logEmbed);
      await interaction.reply({ content: `🧹 Successfully purged ${deletedCount} messages.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Failed to purge messages: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }
}

module.exports = ModerationPlugin;
