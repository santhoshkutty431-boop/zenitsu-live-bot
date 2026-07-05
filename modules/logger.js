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

const { EmbedBuilder } = require('discord.js');

// ─── LOG CHANNEL RESOLVER ────────────────────────────────────────────────────

/**
 * Send an embed to a specific log channel by ID.
 * Silent fail if channel doesn't exist or bot lacks permissions.
 */
async function sendLog(guild, channelId, embed, db) {
  if (!guild) return;

  let resolvedChannelId = channelId;
  const isMainServer = guild.id === (process.env.GUILD_ID || '1444533392518680719');

  if (db && db.logging) {
    const title = embed.data?.title || '';
    if (title.includes('Message Deleted') || title.includes('Message Edited')) {
      resolvedChannelId = db.logging.messageLogId || db.logging.serverLogsId || channelId;
    } else if (title.includes('Voice')) {
      resolvedChannelId = db.logging.voiceLogId || channelId;
    } else if (title.includes('Incident') || title.includes('Audit') || title.includes('Banned') || title.includes('Kicked') || title.includes('Warning') || title.includes('Mute') || title.includes('Timeout') || title.includes('Whitelist Removed') || title.includes('User Successfully Whitelisted') || title.includes('Moderation') || title.includes('Roles Updated')) {
      resolvedChannelId = db.logging.modLogId || db.logging.serverLogsId || channelId;
    } else if (title.includes('Member') || title.includes('Role') || title.includes('Channel')) {
      resolvedChannelId = db.logging.serverLogsId || channelId;
    }
  } else if (!isMainServer) {
    // If no db.logging configuration exists and this is another server, search by channel name
    const title = embed.data?.title || '';
    let targetName = 'server-logs';
    if (title.includes('Message Deleted') || title.includes('Message Edited')) {
      targetName = 'message-log';
    } else if (title.includes('Voice')) {
      targetName = 'voice-log';
    } else if (title.includes('Incident') || title.includes('Audit') || title.includes('Banned') || title.includes('Kicked') || title.includes('Warning') || title.includes('Mute') || title.includes('Timeout') || title.includes('Whitelist Removed') || title.includes('User Successfully Whitelisted') || title.includes('Moderation') || title.includes('Roles Updated')) {
      targetName = 'mod-log';
    }

    const cleanName = targetName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const foundCh = guild.channels.cache.find(c => {
      const cClean = c.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
      return cClean === cleanName || cClean.includes(cleanName);
    });

    if (foundCh) {
      resolvedChannelId = foundCh.id;
    } else {
      return; // Do not log if channel is not found on other servers
    }
  }

  if (!resolvedChannelId) return;
  try {
    let ch = guild.channels.cache.get(resolvedChannelId);
    if (!ch) {
      ch = await guild.channels.fetch(resolvedChannelId).catch(() => null);
    }
    if (!ch) {
      const title = embed.data?.title || '';
      let targetName = 'server-logs';
      if (title.includes('Message Deleted') || title.includes('Message Edited')) {
        targetName = 'message-log';
      } else if (title.includes('Voice')) {
        targetName = 'voice-log';
      } else if (title.includes('Incident') || title.includes('Audit') || title.includes('Banned') || title.includes('Kicked') || title.includes('Warning') || title.includes('Mute') || title.includes('Timeout') || title.includes('Whitelist Removed') || title.includes('User Successfully Whitelisted') || title.includes('Moderation') || title.includes('Roles Updated')) {
        targetName = 'mod-log';
      }
      const cleanName = targetName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      const foundCh = guild.channels.cache.find(c => {
        const cClean = c.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        return cClean === cleanName || cClean.includes(cleanName);
      });
      if (foundCh) ch = foundCh;
    }
    if (ch?.isTextBased()) {
      await ch.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    // Fail silently to prevent crashing event handler loop
  }
}

// ─── JOIN / LEAVE ─────────────────────────────────────────────────────────────

async function logMemberJoin(member, ID, db) {
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

  await sendLog(guild, ID.SERVER_LOGS, embed, db);
}

async function logMemberLeave(member, ID, db) {
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

  await sendLog(guild, ID.SERVER_LOGS, embed, db);
}

// ─── MESSAGE EDIT / DELETE ───────────────────────────────────────────────────

async function logMessageDelete(msg, ID, db) {
  if (!msg.guild) return;

  if (!msg.author && !msg.content) {
    return;
  }

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

  await sendLog(msg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, embed, db);
}

async function logMessageEdit(oldMsg, newMsg, ID, db) {
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

  await sendLog(newMsg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, embed, db);
}

// ─── VOICE STATE ─────────────────────────────────────────────────────────────

async function logVoiceUpdate(oldState, newState, voiceJoins, ID, db) {
  const guild  = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const userId   = member.id;
  const userTag  = member.user.tag;

  // Joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    voiceJoins.set(userId, { channelName: newState.channel?.name, startTime: Date.now() });
    const embed = new EmbedBuilder()
      .setTitle('🔊 Voice Join')
      .setColor(0x2ECC71)
      .addFields(
        { name: '👤 User',    value: `${member} (${userTag})`,         inline: true },
        { name: '🔊 Channel', value: newState.channel?.name || 'Unknown', inline: true },
      )
      .setFooter({ text: `User ID: ${userId}` })
      .setTimestamp();
    await sendLog(guild, ID.VOICE_LOG, embed, db);
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
    await sendLog(guild, ID.VOICE_LOG, embed, db);
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
    await sendLog(guild, ID.VOICE_LOG, embed, db);
  }
}

// ─── MODERATION ACTION ───────────────────────────────────────────────────────

async function logModAction(guild, caseData, ID, db) {
  const { formatCaseEmbed } = require('./case-manager');
  const embed = formatCaseEmbed(caseData);
  const securityLogId = ID.MOD_LOG;
  await sendLog(guild, securityLogId, embed, db);
}

// ─── ROLE / CHANNEL UPDATES ──────────────────────────────────────────────────

async function logRoleUpdate(oldRole, newRole, ID, db) {
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
  await sendLog(guild, ID.SERVER_LOGS, embed, db);
}

async function logChannelUpdate(oldCh, newCh, ID, db) {
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
  await sendLog(guild, ID.SERVER_LOGS, embed, db);
}

async function logGuildMemberRoleUpdate(oldMember, newMember, ID, db) {
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

  await sendLog(newMember.guild, ID.SERVER_LOGS, embed, db);
}

// ─── SECURITY INCIDENT ───────────────────────────────────────────────────────

async function logSecurityIncident(guild, title, description, fields, db, ID) {
  const securityLogId = db.securityConfig?.securityLogId || db.logging?.modLogId || ID.MOD_LOG;
  const embed = new EmbedBuilder()
    .setTitle(`🚨 Security Incident — ${title}`)
    .setDescription(description)
    .setColor(0xFF0000)
    .setTimestamp();
  if (fields) embed.addFields(fields);
  await sendLog(guild, securityLogId, embed, db);
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
