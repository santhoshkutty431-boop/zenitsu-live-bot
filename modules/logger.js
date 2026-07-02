/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║             CENTRALIZED LOGGER MODULE                        ║
 * ║             modules/logger.js                                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * All Discord event logs funnel through this module.
 * Provides structured, color-coded embeds for each log type.
 */

'use strict';

const { EmbedBuilder, AuditLogEvent } = require('discord.js');

// ─── LOG CHANNEL RESOLVER ────────────────────────────────────────────────────

/**
 * Send an embed to a specific log channel by ID.
 * Silent fail if channel doesn't exist or bot lacks permissions.
 */
async function sendLog(guild, channelId, embed) {
  if (!channelId || !guild) return;
  const ch = guild.channels.cache.get(channelId);
  if (ch?.isTextBased()) {
    await ch.send({ embeds: [embed] }).catch(() => {});
  }
}

// ─── JOIN / LEAVE ─────────────────────────────────────────────────────────────

async function logMemberJoin(member, ID) {
  const guild = member.guild;
  const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
  const createdTs  = Math.floor(member.user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setColor(0x2ECC71)
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: '👤 User',        value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '🆔 ID',          value: member.id,                               inline: true },
      { name: '📅 Account Age', value: `${accountAge} days (<t:${createdTs}:R>)`, inline: false },
      { name: '👥 Member Count',value: `${guild.memberCount}`,                  inline: true },
    )
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await sendLog(guild, ID.SERVER_LOGS, embed);
}

async function logMemberLeave(member, ID) {
  const guild    = member.guild;
  const joinedTs = member.joinedAt ? Math.floor(member.joinedAt.getTime() / 1000) : null;
  const roles    = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';

  const embed = new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setColor(0xE74C3C)
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: '👤 User',   value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '🆔 ID',     value: member.id,                               inline: true },
      { name: '📅 Joined', value: joinedTs ? `<t:${joinedTs}:R>` : 'Unknown', inline: true },
      { name: '🏷️ Roles',  value: roles.slice(0, 500) },
    )
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await sendLog(guild, ID.SERVER_LOGS, embed);
}

// ─── MESSAGE EDIT / DELETE ───────────────────────────────────────────────────

async function logMessageDelete(msg, ID) {
  if (!msg.guild) return;

  const authorTag  = msg.author?.tag    || '⚠️ Unknown (uncached)';
  const authorId   = msg.author?.id     || 'Unknown';
  const isBot      = msg.author?.bot    || false;
  if (isBot) return;

  const content    = msg.content || '*No text content / attachment / embed*';

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .setColor(0xE74C3C)
    .addFields(
      { name: '👤 Author',  value: msg.author ? `${msg.author} (${authorTag})` : authorTag, inline: true },
      { name: '📌 Channel', value: `${msg.channel}`,                                         inline: true },
      { name: '📝 Content', value: content.slice(0, 1024) },
    )
    .setFooter({ text: `User ID: ${authorId} | Msg ID: ${msg.id}` })
    .setTimestamp();

  await sendLog(msg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, embed);
}

async function logMessageEdit(oldMsg, newMsg, ID) {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;

  const embed = new EmbedBuilder()
    .setTitle('✏️ Message Edited')
    .setColor(0xF39C12)
    .addFields(
      { name: '👤 Author',    value: `${newMsg.author} (${newMsg.author.tag})`, inline: true },
      { name: '📌 Channel',   value: `${newMsg.channel}`,                        inline: true },
      { name: '📌 Jump',      value: `[View Message](${newMsg.url})`,            inline: true },
      { name: '📝 Before',    value: (oldMsg.content || '*empty*').slice(0, 512) },
      { name: '📝 After',     value: (newMsg.content || '*empty*').slice(0, 512) },
    )
    .setFooter({ text: `User ID: ${newMsg.author.id} | Msg ID: ${newMsg.id}` })
    .setTimestamp();

  await sendLog(newMsg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, embed);
}

// ─── VOICE STATE ─────────────────────────────────────────────────────────────

async function logVoiceUpdate(oldState, newState, voiceJoins, ID) {
  const guild  = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const userId   = member.id;
  const userTag  = member.user.tag;

  // Joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    voiceJoins.set(userId, { channelName: newState.channel?.name, startTime: Date.now() });
    const embed = new EmbedBuilder()
      .setTitle('🎤 Voice Join')
      .setColor(0x2ECC71)
      .addFields(
        { name: '👤 User',    value: `${member} (${userTag})`,         inline: true },
        { name: '🔊 Channel', value: newState.channel?.name || 'Unknown', inline: true },
      )
      .setFooter({ text: `User ID: ${userId}` })
      .setTimestamp();
    await sendLog(guild, ID.VOICE_LOG, embed);
  }

  // Left a voice channel
  else if (oldState.channelId && !newState.channelId) {
    const joinData = voiceJoins.get(userId);
    const duration = joinData ? Math.floor((Date.now() - joinData.startTime) / 1000) : null;
    voiceJoins.delete(userId);

    const durStr = duration
      ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m ${duration % 60}s`
      : 'Unknown';

    const embed = new EmbedBuilder()
      .setTitle('🔇 Voice Leave')
      .setColor(0xE74C3C)
      .addFields(
        { name: '👤 User',      value: `${member} (${userTag})`,           inline: true },
        { name: '🔊 Channel',   value: oldState.channel?.name || 'Unknown', inline: true },
        { name: '⏱️ Duration', value: durStr,                               inline: true },
      )
      .setFooter({ text: `User ID: ${userId}` })
      .setTimestamp();
    await sendLog(guild, ID.VOICE_LOG, embed);
  }

  // Moved between channels
  else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    if (voiceJoins.has(userId)) {
      voiceJoins.set(userId, { channelName: newState.channel?.name, startTime: voiceJoins.get(userId).startTime });
    }
    const embed = new EmbedBuilder()
      .setTitle('↔️ Voice Move')
      .setColor(0x3498DB)
      .addFields(
        { name: '👤 User',  value: `${member} (${userTag})`,              inline: true },
        { name: '📤 From',  value: oldState.channel?.name || 'Unknown',   inline: true },
        { name: '📥 To',    value: newState.channel?.name || 'Unknown',   inline: true },
      )
      .setFooter({ text: `User ID: ${userId}` })
      .setTimestamp();
    await sendLog(guild, ID.VOICE_LOG, embed);
  }
}

// ─── MODERATION ACTION ───────────────────────────────────────────────────────

async function logModAction(guild, caseData, ID) {
  const { formatCaseEmbed } = require('./case-manager');
  const embed = formatCaseEmbed(caseData);
  const securityLogId = ID.MOD_LOG;
  await sendLog(guild, securityLogId, embed);
}

// ─── ROLE / CHANNEL UPDATES ──────────────────────────────────────────────────

async function logRoleUpdate(oldRole, newRole, ID) {
  const guild = newRole.guild;
  const changes = [];
  if (oldRole.name  !== newRole.name)  changes.push(`**Name:** \`${oldRole.name}\` → \`${newRole.name}\``);
  if (oldRole.color !== newRole.color) changes.push(`**Color:** \`#${oldRole.color.toString(16)}\` → \`#${newRole.color.toString(16)}\``);
  if (oldRole.hoist !== newRole.hoist) changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
  if (oldRole.mentionable !== newRole.mentionable) changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);
  if (changes.length === 0) return;

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Role Updated')
    .setColor(0x9B59B6)
    .addFields(
      { name: '🔖 Role',    value: `${newRole} (${newRole.name})`, inline: true },
      { name: '📝 Changes', value: changes.join('\n') },
    )
    .setFooter({ text: `Role ID: ${newRole.id}` })
    .setTimestamp();
  await sendLog(guild, ID.SERVER_LOGS, embed);
}

async function logChannelUpdate(oldCh, newCh, ID) {
  const guild = newCh.guild;
  const changes = [];
  if (oldCh.name  !== newCh.name)  changes.push(`**Name:** \`${oldCh.name}\` → \`${newCh.name}\``);
  if (oldCh.topic !== newCh.topic) changes.push(`**Topic:** \`${oldCh.topic || 'none'}\` → \`${newCh.topic || 'none'}\``);
  if ((oldCh.rateLimitPerUser || 0) !== (newCh.rateLimitPerUser || 0)) {
    changes.push(`**Slowmode:** ${oldCh.rateLimitPerUser}s → ${newCh.rateLimitPerUser}s`);
  }
  if (changes.length === 0) return;

  const embed = new EmbedBuilder()
    .setTitle('📝 Channel Updated')
    .setColor(0x3498DB)
    .addFields(
      { name: '📌 Channel', value: `${newCh} (#${newCh.name})`, inline: true },
      { name: '📝 Changes', value: changes.join('\n') },
    )
    .setFooter({ text: `Channel ID: ${newCh.id}` })
    .setTimestamp();
  await sendLog(guild, ID.SERVER_LOGS, embed);
}

async function logGuildMemberRoleUpdate(oldMember, newMember, ID) {
  const addedRoles   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  if (addedRoles.size === 0 && removedRoles.size === 0) return;

  const embed = new EmbedBuilder()
    .setTitle('🔄 Member Roles Updated')
    .setColor(0x1ABC9C)
    .addFields(
      { name: '👤 User', value: `${newMember} (${newMember.user.tag})`, inline: true },
    )
    .setFooter({ text: `User ID: ${newMember.id}` })
    .setTimestamp();

  if (addedRoles.size   > 0) embed.addFields({ name: '➕ Added',   value: addedRoles.map(r => r.name).join(', ') });
  if (removedRoles.size > 0) embed.addFields({ name: '➖ Removed', value: removedRoles.map(r => r.name).join(', ') });

  await sendLog(newMember.guild, ID.SERVER_LOGS, embed);
}

// ─── SECURITY INCIDENT ───────────────────────────────────────────────────────

async function logSecurityIncident(guild, title, description, fields, db, ID) {
  const securityLogId = db.securityConfig?.securityLogId || ID.MOD_LOG;
  const embed = new EmbedBuilder()
    .setTitle(`🚨 Security Incident — ${title}`)
    .setDescription(description)
    .setColor(0xFF0000)
    .setTimestamp();
  if (fields) embed.addFields(fields);
  await sendLog(guild, securityLogId, embed);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = {
  sendLog,
  logMemberJoin,
  logMemberLeave,
  logMessageDelete,
  logMessageEdit,
  logVoiceUpdate,
  logModAction,
  logRoleUpdate,
  logChannelUpdate,
  logGuildMemberRoleUpdate,
  logSecurityIncident,
};
