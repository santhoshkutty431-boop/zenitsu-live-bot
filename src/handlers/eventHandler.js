const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Logger + AI feature modules used by event handlers
const {
  logMemberJoin,
  logMemberLeave,
  logMessageDelete,
  logMessageEdit,
  logVoiceUpdate,
  logRoleUpdate,
  logChannelUpdate,
  logGuildMemberRoleUpdate
} = require('../../modules/logger');
const {
  handleAiTicketSupport,
  handleAiModeration,
  handleAiReactionTranslate
} = require('../../modules/ai-features');
const { handleAuditLogEntry, handleMessageSecurity } = require('../../modules/security');
const semanticSpam = require('../../modules/semantic-spam');

let runtimeInstance = null;
// Module-level shared state set by registerEvents(), used by module-scope helpers below
let ID = {};
let db = {};
const loadDb = () => {};
const saveDb = async () => {
  if (!runtimeInstance) return;
  const store = global.asyncLocalStorage?.getStore();
  const guildId = store?.guildId;
  const dbMgr = runtimeInstance.getService('DatabaseManager');
  if (dbMgr) {
    dbMgr.saveGlobal();
    if (guildId) {
      dbMgr.saveGuildDb(guildId);
    }
  }
};

// ─── IN-MEMORY VOICE TRACKER (upgrade 10) ─────────────────────────────────────
const voiceJoins = new Map(); // userId → { channelName, startTime }

// ─── XP CONFIG (upgrade 13) ───────────────────────────────────────────────────
const XP_COOLDOWN_MS = 60_000;
const XP_MIN = 15;
const XP_MAX = 25;
const XP_LEVEL_ROLES = {
  5:  { name: '⭐ Level 5',  color: 0xF1C40F },
  10: { name: '🌟 Level 10', color: 0xE67E22 },
  20: { name: '💫 Level 20', color: 0xE74C3C },
};
function calcLevel(xp) { return Math.floor(Math.sqrt(xp / 100)); }
function xpForLevel(lvl) { return lvl * lvl * 100; }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
let ownerId = null;
function isOwner(userId) {
  return userId === ownerId;
}

// The canonical, self-healing logToChannel lives in index.js and is injected
// into registerEvents. This module-level wrapper simply delegates to it so
// logToReports/logAiAnalytics get the same recreated-channel self-healing.
let injectedLogToChannel = null;
async function logToChannel(guild, channelId, embed) {
  if (injectedLogToChannel) return injectedLogToChannel(guild, channelId, embed);
  // Fallback (should not happen once registerEvents has run): best-effort send.
  if (!guild || !channelId) return;
  try {
    let ch = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send({ embeds: [embed] }).catch(() => {});
  } catch { /* ignore */ }
}
async function logToReports(guild, embed) {
  await logToChannel(guild, ID.MOD_REPORTS, embed);
}
async function logAiAnalytics(user, prompt, result, guild) {
  const channelId = process.env.AI_ANALYTICS_CHANNEL_ID;
  if (!guild || !channelId) return;
  const { EmbedBuilder: EB } = require('discord.js');
  
  const statusColor = result.error ? 0xE74C3C : ((result.failoverCount && result.failoverCount > 0) ? 0xF39C12 : 0x2ECC71);
  const statusEmoji = result.error ? '❌ Failed' : ((result.failoverCount && result.failoverCount > 0) ? '⚠️ Failover Successful' : '✅ Success');

  const embed = new EB()
    .setTitle('🤖 AI Query Analytics')
    .setColor(statusColor)
    .addFields(
      { name: '👤 User', value: `${user} (ID: \`${user.id}\`)`, inline: true },
      { name: '📊 Status', value: statusEmoji, inline: true },
      { name: '💬 Prompt Length', value: `${prompt.length} characters`, inline: true },
      { name: '🎯 Requested Model', value: result.originalRequested?.label || 'Unknown', inline: true },
      { name: '⚙️ Responded Model', value: result.model?.label || 'None', inline: true },
      { name: '🔄 Failover Hops', value: `${result.failoverCount || 0}`, inline: true }
    )
    .setTimestamp();

  if (result.attempts && result.attempts.length > 0) {
    embed.addFields({ name: '📝 Model Execution Log', value: '```• ' + result.attempts.join('\n• ') + '```' });
  }

  await logToChannel(guild, channelId, embed);
}

function getLanguageSelectorEmbed(user) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder: EB } = require('discord.js');
  
  const embed = new EB()
    .setTitle('🌐 SELECT YOUR LANGUAGE / भाषा चुनिए')
    .setDescription(
      `Hello ${user}! Please select your preferred language/dialect to chat with **ZENITSU AI**.\n\n` +
      `🔹 **English:** Standard English replies.\n\n` +
      `🔹 **Hinglish:** Natural mix of Hindi & English (e.g., *kya kar rhe ho?*)\n\n` +
      `🔹 **Tanglish/Tunglish:** Natural mix of Tamil & English (e.g., *enna pantra?*)\n\n` +
      `*You can change this anytime later using the \`/ai-lang\` command!*`
    )
    .setColor(0x00D4FF)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setlang_english_${user.id}`)
      .setLabel('🇬🇧 English')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setlang_hinglish_${user.id}`)
      .setLabel('🇮🇳 Hinglish')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`setlang_tanglish_${user.id}`)
      .setLabel('🐯 Tanglish')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}


async function getOrCreateRole(guild, roleName, color = 0x000000) {
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) role = await guild.roles.create({ name: roleName, color, reason: 'Bot auto-role' }).catch(() => null);
  return role;
}
const guildConfig = require('../../modules/guild-config');
function staffCheck(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  // Universal, multi-server staff detection (Discord perms + configured/
  // hardcoded roles). Uses the current guild's db for per-guild role config.
  let gdb = db;
  try {
    if (runtimeInstance) gdb = runtimeInstance.getService('DatabaseManager').getGuildDb(member.guild.id);
  } catch { /* fall back to module-scope db */ }
  return guildConfig.isStaff(member, gdb, ID);
}



// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 1 + 2] — AUTO-ROLE VIA JOIN GATE + WELCOME DM
// ═══════════════════════════════════════════════════════════════════════════════

// Re-expose legacy helper names inside event scope
const staffCheckFn = staffCheck;
const getOrCreateRoleFn = getOrCreateRole;

function registerEvents(client, runtime, _db, _ID, logToChannel, isDeveloper, resolvePermission, staffCheck, isOwner, getOrCreateRole, secHandleJoin, secHandleMsg) {
  runtimeInstance = runtime;
  // Publish db/ID to module scope so helpers like logToReports() see them
  db = _db;
  ID = _ID;
  // Capture the canonical self-healing logToChannel (from index.js) so the
  // module-level wrapper + logToReports/logAiAnalytics delegate to it.
  injectedLogToChannel = logToChannel;
  // Bind all event listeners to the client
client.on('guildMemberAdd', async member => {
  console.log(`[JOIN] ${member.user.tag} joined`);
  loadDb(); // Sync with disk before security checks
  runtime.eventBus.publish('MEMBER_JOIN', { member, guild: member.guild });

  // Security: anti-raid + account age check
  await secHandleJoin(member, db, saveDb, logToChannel, ID);

  // Logger: join log
  await logMemberJoin(member, ID, db);

  // Resolve this guild's channels/roles (per-guild config → main hardcoded →
  // name-based). Works on any server; gracefully null if not present.
  let gdb2 = db;
  try { if (runtimeInstance) gdb2 = runtimeInstance.getService('DatabaseManager').getGuildDb(member.guild.id); } catch { /* */ }
  const rulesId   = guildConfig.resolveChannelId(member.guild, 'rules', gdb2, ID);
  const welcomeId = guildConfig.resolveChannelId(member.guild, 'welcome', gdb2, ID);
  const gname = member.guild.name;

  // [2] Welcome DM
  const rulesLine   = rulesId   ? `📜 Read the rules → <#${rulesId}>\n` : '';
  const welcomeLine = welcomeId ? `✅ Click **Verify** in <#${welcomeId}> to unlock the community\n` : '';
  const dmEmbed = new EmbedBuilder()
    .setTitle(`⚡ Welcome to ${gname}, ${member.user.username}! <a:tt_clapCat_OwO:1444716354023461016>`)
    .setDescription(
      `⚡ **Thunder Breathing, First Form: Welcome!** ⚡\n\n` +
      `Hello ${member.user}! You have successfully flashed into **${gname}**! <a:nekolove:1444716314223710228>\n\n` +
      `**📌 Fast-Path Navigation:**\n` +
      rulesLine + welcomeLine +
      `🎫 Open a support ticket if you need anything!\n\n` +
      `> *See you in the lightning storm!* — **${gname} Staff**`
    )
    .setColor(0xEDC231)
    .setImage('https://media1.tenor.com/m/V_zC24-B97cAAAAC/zenitsu-demon-slayer.gif')
    .setThumbnail(member.guild.iconURL({ dynamic: true }))
    .setFooter({ text: `Zenitsu Live Automation • ${gname}` })
    .setTimestamp();

  const { sendCleanDm } = require('../../modules/dm-manager');
  await sendCleanDm(member, { embeds: [dmEmbed] }).catch(() => {
    console.log(`  ⚠️  Could not DM ${member.user.tag} (DMs closed)`);
  });

  // Welcome message in channel (only if this guild has a welcome channel)
  const welcomeCh = welcomeId ? member.guild.channels.cache.get(welcomeId) : null;
  if (welcomeCh?.isTextBased?.()) {
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`⚡ New Member Arrived! <a:tt_clapCat_OwO:1444716354023461016>`)
      .setDescription(
        `Welcome to the storm, ${member}! <a:nyanbang1:1444716412185739274>\n\n` +
        `We are thrilled to have you here in **${gname}**.\n` +
        (rulesId ? `> 📜 Flashing-step over to <#${rulesId}> to read the rules and verify!` : '')
      )
      .setImage('https://media1.tenor.com/m/V_zC24-B97cAAAAC/zenitsu-demon-slayer.gif')
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor(0xEDC231)
      .setFooter({ text: `Member #${member.guild.memberCount} • Thunder breathing active` })
      .setTimestamp();
    await welcomeCh.send({ embeds: [welcomeEmbed] }).catch(() => {});
  }
});

// Log member leave
client.on('guildMemberRemove', async member => {
  const leaveEmbed = new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setDescription(`${member.user} (${member.user.tag})`)
    .addFields(
      { name: 'User ID', value: member.user.id, inline: true },
      { name: 'Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
      { name: 'Roles', value: member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'None' }
    )
    .setColor(0xE74C3C)
    .setTimestamp();
  await logToChannel(member.guild, ID.SERVER_LOGS, leaveEmbed);
});

// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 9] — MESSAGE EDIT + DELETE LOGS
// ═══════════════════════════════════════════════════════════════════════════════
client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;

  const editEmbed = new EmbedBuilder()
    .setTitle('✏️ Message Edited')
    .setDescription(`**Author:** ${newMsg.author} (${newMsg.author.tag})\n**Channel:** ${newMsg.channel}`)
    .addFields(
      { name: '📝 Before', value: (oldMsg.content || '*Empty*').slice(0, 1024) },
      { name: '📝 After',  value: (newMsg.content || '*Empty*').slice(0, 1024) },
    )
    .setColor(0xF39C12)
    .setFooter({ text: `User ID: ${newMsg.author.id} | Msg ID: ${newMsg.id}` })
    .setTimestamp();

  await logToChannel(newMsg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, editEmbed);
});

client.on('messageDelete', async msg => {
  if (!msg.guild) return;

  // Handle partial messages (uncached/old messages the bot didn't see when sent)
  const authorTag  = msg.author?.tag    || '⚠️ Unknown (message not cached)';
  const authorId   = msg.author?.id     || 'Unknown';
  const isBot      = msg.author?.bot    || false;
  const content    = msg.content        || '*No text content — attachment, embed, or uncached message*';
  const channelName = msg.channel?.name || 'Unknown Channel';

  if (isBot) return; // Skip bot-deleted messages

  const delEmbed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .setDescription(`**Author:** ${msg.author ? `${msg.author} (${authorTag})` : authorTag}\n**Channel:** ${msg.channel}`)
    .addFields({ name: '📝 Content', value: content.slice(0, 1024) })
    .setColor(0xE74C3C)
    .setFooter({ text: `User ID: ${authorId} | Msg ID: ${msg.id}` })
    .setTimestamp();

  // Save to database
  if (!db.deletedMessages) db.deletedMessages = [];
  db.deletedMessages.push({
    authorTag,
    authorId,
    content,
    channelName,
    deletedAt: new Date().toISOString()
  });
  if (db.deletedMessages.length > 50) db.deletedMessages.shift();
  saveDb();

  await logToChannel(msg.guild, ID.MESSAGE_LOG || ID.SERVER_LOGS, delEmbed);
});

// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 10] — VOICE CHANNEL ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild   = newState.guild || oldState.guild;
  const member  = newState.member;
  if (!member || member.user.bot) return;

  const userId  = member.user.id;
  const oldCh   = oldState.channel;
  const newCh   = newState.channel;

  // Joined a VC
  if (!oldCh && newCh) {
    voiceJoins.set(userId, { channelName: newCh.name, startTime: Date.now() });

    const embed = new EmbedBuilder()
      .setTitle('🎙️ Joined Voice')
      .setDescription(`${member.user} joined **${newCh.name}**`)
      .setColor(0x2ECC71)
      .setFooter({ text: `User: ${member.user.tag}` })
      .setTimestamp();
    await logToChannel(guild, ID.VOICE_LOG, embed);
  }

  // Left a VC
  else if (oldCh && !newCh) {
    const session = voiceJoins.get(userId);
    let duration = '';
    if (session) {
      const secs = Math.floor((Date.now() - session.startTime) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      duration = `${m}m ${s}s`;
      voiceJoins.delete(userId);
    }

    const embed = new EmbedBuilder()
      .setTitle('🚪 Left Voice')
      .setDescription(`${member.user} left **${oldCh.name}**`)
      .addFields({ name: '⏱️ Time Spent', value: duration || 'Unknown', inline: true })
      .setColor(0xE74C3C)
      .setFooter({ text: `User: ${member.user.tag}` })
      .setTimestamp();
    await logToChannel(guild, ID.VOICE_LOG, embed);
  }

  // Moved between VCs
  else if (oldCh && newCh && oldCh.id !== newCh.id) {
    const embed = new EmbedBuilder()
      .setTitle('🔀 Moved Voice Channel')
      .setDescription(`${member.user} moved from **${oldCh.name}** → **${newCh.name}**`)
      .setColor(0x3498DB)
      .setFooter({ text: `User: ${member.user.tag}` })
      .setTimestamp();
    await logToChannel(guild, ID.VOICE_LOG, embed);
    // Update session channel name
    const session = voiceJoins.get(userId);
    if (session) voiceJoins.set(userId, { ...session, channelName: newCh.name });
  }

  // Muted / deafened by staff
  if (oldState.serverMute !== newState.serverMute) {
    const action = newState.serverMute ? '🔇 Server Muted' : '🔊 Server Unmuted';
    const embed = new EmbedBuilder()
      .setTitle(action)
      .setDescription(`${member.user} was ${newState.serverMute ? 'muted' : 'unmuted'} in **${newCh?.name || oldCh?.name}**`)
      .setColor(newState.serverMute ? 0xE74C3C : 0x2ECC71)
      .setTimestamp();
    await logToChannel(guild, ID.MOD_LOG, embed);
  }
});

// ─── AI REACTION TRANSLATOR ─────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  await handleAiReactionTranslate(reaction, user);
});

// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 11] — MOD ACTION LOGS (bans, unbans, role changes, timeouts)
// ═══════════════════════════════════════════════════════════════════════════════
client.on('guildBanAdd', async (ban) => {
  const embed = new EmbedBuilder()
    .setTitle('🔨 Member Banned')
    .setDescription(`${ban.user} (${ban.user.tag}) was banned`)
    .addFields({ name: 'Reason', value: ban.reason || 'No reason provided' })
    .setColor(0xE74C3C)
    .setFooter({ text: `User ID: ${ban.user.id}` })
    .setTimestamp();
  await logToChannel(ban.guild, ID.MOD_LOG, embed);
  await logToChannel(ban.guild, ID.SERVER_LOGS, embed);
});

client.on('guildBanRemove', async (ban) => {
  const embed = new EmbedBuilder()
    .setTitle('✅ Member Unbanned')
    .setDescription(`${ban.user} (${ban.user.tag}) was unbanned`)
    .setColor(0x2ECC71)
    .setFooter({ text: `User ID: ${ban.user.id}` })
    .setTimestamp();
  await logToChannel(ban.guild, ID.MOD_LOG, embed);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  // Role changes
  const addedRoles   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

  // Anti-Abuse Role Guard: If roles were added, verify executor is whitelisted
  if (addedRoles.size > 0) {
    try {
      let logEntry = null;
      
      // Retry polling up to 4 times (every 500ms) to ensure audit log is populated by Discord
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const fetchedLogs = await newMember.guild.fetchAuditLogs({
          limit: 5,
          type: AuditLogEvent.MemberRoleUpdate,
        }).catch(() => null);

        if (fetchedLogs) {
          // Find log entry matching target user id and updated within the last 10 seconds
          logEntry = fetchedLogs.entries.find(entry => 
            entry.target?.id === newMember.id && 
            (Date.now() - entry.createdTimestamp) < 10000
          );
          if (logEntry) break;
        }
      }

      if (logEntry) {
        const executorId = logEntry.executor?.id;
        
        if (executorId) {
          loadDb(); // Sync with disk before security checks
          const executorMember = await newMember.guild.members.fetch(executorId).catch(() => null);
          const isExecBot = executorId === client.user.id;

          let isExecAuthorized = false;
          if (isExecBot) {
            isExecAuthorized = true;
          } else if (executorMember) {
            const permRes = resolvePermission(executorMember, 'role', executorId, db);
            isExecAuthorized = permRes.allowed;
          }

          if (!isExecAuthorized) {
            // Revert role addition
            for (const [roleId, role] of addedRoles) {
              await newMember.roles.remove(role, 'Anti-Abuse Guard: Unauthorized role assignment').catch(() => {});
            }

            // Send alert to reports channel
            const alertEmbed = new EmbedBuilder()
              .setTitle('🚨 Security Alert: Unauthorized Role Assignment')
              .setDescription(`**Target User:** ${newMember} (${newMember.user.tag})\n**Action Taken:** Automatically removed the role(s) added.\n**Attempted By:** <@${executorId}> (${logEntry.executor?.tag || executorId})`)
              .addFields({ name: 'Roles Attempted', value: addedRoles.map(r => r.toString()).join(', ') })
              .setColor(0xFF0000)
              .setTimestamp();
            await logToReports(newMember.guild, alertEmbed);
            await logToChannel(newMember.guild, ID.MOD_LOG, alertEmbed);
            
            // Warn executor via DM
            if (executorMember) {
              const dmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Zenitsu Guard: Unauthorized Role Assignment')
                .setDescription(
                  `You tried to assign role(s) on **${newMember.guild.name}** but you do not have permission to do so.\n\n` +
                  `• **Target User:** ${newMember.user.tag}\n` +
                  `• **Role(s):** ${addedRoles.map(r => r.name).join(', ')}\n\n` +
                  `**Action Taken:** The role assignment has been automatically reverted.\n` +
                  `*Contact the Server Owner to request whitelisting for the \`ROLE_ASSIGN\` capability.*`
                )
                .setColor(0xE74C3C)
                .setTimestamp();
              const { sendCleanDm } = require('../../modules/dm-manager');
              await sendCleanDm(executorMember, { embeds: [dmEmbed] }).catch(() => {});
            }

            return;
          }
        }
      }
    } catch (err) {
      console.error('Anti-Abuse role guard error:', err.message);
    }
  }

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    const embed = new EmbedBuilder()
      .setTitle('🎭 Roles Updated')
      .setDescription(`${newMember.user} (${newMember.user.tag})`)
      .setColor(0x9B59B6)
      .setTimestamp();

    if (addedRoles.size > 0)
      embed.addFields({ name: '➕ Roles Added', value: addedRoles.map(r => r.toString()).join(', ') });
    if (removedRoles.size > 0)
      embed.addFields({ name: '➖ Roles Removed', value: removedRoles.map(r => r.toString()).join(', ') });

    await logToChannel(newMember.guild, ID.MOD_LOG, embed);
  }

  // Timeout
  const wasTimedOut = !oldMember.communicationDisabledUntil && newMember.communicationDisabledUntil;
  const wasUntimed  = oldMember.communicationDisabledUntil  && !newMember.communicationDisabledUntil;

  if (wasTimedOut) {
    const until = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);
    const embed = new EmbedBuilder()
      .setTitle('⏱️ Member Timed Out')
      .setDescription(`${newMember.user} (${newMember.user.tag})`)
      .addFields({ name: 'Until', value: `<t:${until}:R>` })
      .setColor(0xE67E22)
      .setTimestamp();
    await logToChannel(newMember.guild, ID.MOD_LOG, embed);
  }
  if (wasUntimed) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Timeout Removed')
      .setDescription(`${newMember.user} (${newMember.user.tag})'s timeout was lifted`)
      .setColor(0x2ECC71)
      .setTimestamp();
    await logToChannel(newMember.guild, ID.MOD_LOG, embed);
  }

  // Nickname change
  if (oldMember.nickname !== newMember.nickname) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Nickname Changed')
      .setDescription(`${newMember.user} (${newMember.user.tag})`)
      .addFields(
        { name: 'Before', value: oldMember.nickname || '*None*', inline: true },
        { name: 'After',  value: newMember.nickname || '*None*', inline: true },
      )
      .setColor(0x3498DB)
      .setTimestamp();
    await logToChannel(newMember.guild, ID.SERVER_LOGS, embed);
  }
});

// ─── LOGGER & SECURITY: ROLE UPDATES ─────────────────────────────────────────
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    // 1. Log the basic changes
    await logRoleUpdate(oldRole, newRole, ID, db);

    // 2. Sensitive permissions check
    const sensitivePerms = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ManageWebhooks,
      PermissionFlagsBits.ManageChannels
    ];

    // Check if any sensitive permission was newly added
    const gainedSensitive = sensitivePerms.some(perm => 
      !oldRole.permissions.has(perm) && newRole.permissions.has(perm)
    );

    if (gainedSensitive) {
      // Poll audit logs to find who updated the role
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fetchedLogs = await newRole.guild.fetchAuditLogs({
        limit: 5,
        type: AuditLogEvent.RoleUpdate
      }).catch(() => null);

      if (fetchedLogs) {
        const logEntry = fetchedLogs.entries.find(entry => entry.target?.id === newRole.id);
        if (logEntry) {
          const executorId = logEntry.executor?.id;
          loadDb(); // Sync with disk before security checks
          const isExecOwner = executorId === ownerId;
          const isExecGuildOwner = executorId === newRole.guild.ownerId;
          const executorMember = await newRole.guild.members.fetch(executorId).catch(() => null);
          const isExecOwnerRole = executorMember && executorMember.roles.cache.has(ID.OWNER_ROLE);
          const isExecBot = executorId === client.user.id;
          const isExecWhitelisted = db.roleWhitelist && db.roleWhitelist.includes(executorId);

          if (!isExecOwner && !isExecGuildOwner && !isExecOwnerRole && !isExecBot && !isExecWhitelisted) {
            // Unauthorized permission upgrade! Instantly revert the role's permissions.
            await newRole.setPermissions(oldRole.permissions, 'Anti-Abuse: Unauthorized permission modification').catch(() => {});

            // Post security alert
            const alertEmbed = new EmbedBuilder()
              .setTitle('🚨 Critical Security Alert: Unauthorized Permission Change')
              .setDescription(`**Role:** ${newRole} (${newRole.name})\n**Action Taken:** Instantly reverted permissions back to original state.\n**Attempted By:** <@${executorId}> (${logEntry.executor?.tag || executorId})`)
              .setColor(0xFF0000)
              .setFooter({ text: 'Security Module • Permission Protection' })
              .setTimestamp();

            await logToReports(newRole.guild, alertEmbed);
            await logToChannel(newRole.guild, ID.MOD_LOG, alertEmbed);
          }
        }
      }
    }
  } catch (err) {
    console.error('Role Update security guard error:', err.message);
  }
});

// ─── LOGGER: CHANNEL UPDATES ────────────────────────────────────────────────
client.on('channelUpdate', async (oldCh, newCh) => {
  if (newCh.guild) await logChannelUpdate(oldCh, newCh, ID, db);
});

// ─── ANTI-NUKE: AUDIT LOG MONITORING ────────────────────────────────────────
client.on('guildAuditLogEntryCreate', async (entry, guild) => {
  await handleAuditLogEntry(entry, guild, db, logToChannel, ID);
});

// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 13] — XP / LEVELING SYSTEM  +  AUTO-MOD  +  FEEDBACK FORMAT
// ═══════════════════════════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // Sync DB on incoming message to ensure up-to-date whitelists/settings
  loadDb();

  // 1. AI Context-based Moderation
  const aiModViolated = await handleAiModeration(message, db, saveDb, logToChannel, ID);
  if (aiModViolated) return;

  // 2. AI Ticket FAQ Responder
  await handleAiTicketSupport(message, db, saveDb);

  // ── Feedback channel formatting ──────────────────────────────────────────
  if (message.channel.id === ID.FEEDBACK) {
    await message.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setDescription(message.content || '*Image feedback*')
      .setColor(0xEDC231)
      .setTimestamp()
      .setFooter({ text: 'ZENITSU LIVE Feedback' });
    if (message.attachments.size > 0) embed.setImage(message.attachments.first().url);
    const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
    if (sent) { await sent.react('👍').catch(() => {}); await sent.react('👎').catch(() => {}); }
    return;
  }

  // ── Auto-Moderation (Enterprise Security Module) ────────────────────────
  if (db.protectmeActive && !staffCheck(message.member)) {
    const { violated } = await handleMessageSecurity(message, db, saveDb, logToChannel, ID);
    if (violated) return;

    // ── Semantic anti-spam (embedding similarity vs. known scam patterns) ──
    // Only runs when protectmeActive; skipped for staff. Best-effort — never blocks.
    try {
      const dbService = runtimeInstance?.getService('DatabaseManager');
      if (dbService && typeof dbService.listSpamSignatures === 'function') {
        const verdict = await semanticSpam.checkMessage(message, {
          dbService, staffCheck, logger: runtimeInstance.logger
        });
        if (verdict?.hit) {
          await message.delete().catch(() => {});
          const timeoutMs = (db.spamTimeoutMinutes || 1) * 60_000;
          await message.member.timeout(timeoutMs, `[Semantic Spam] Matched "${verdict.label}"`).catch(() => {});

          const alert = new EmbedBuilder()
            .setTitle('🛡️ Semantic Spam Blocked')
            .setDescription(`Detected a variant of a known scam pattern in <#${message.channelId}>.`)
            .addFields(
              { name: 'User',      value: `${message.author} (\`${message.author.id}\`)`, inline: true },
              { name: 'Pattern',   value: `\`${verdict.label}\``, inline: true },
              { name: 'Similarity', value: `${verdict.score.toFixed(3)} (threshold ${verdict.threshold})`, inline: true },
              { name: 'Action',    value: `Deleted + ${(db.spamTimeoutMinutes || 1)}min timeout`, inline: false },
              { name: 'Content',   value: '```\n' + message.content.slice(0, 900).replace(/```/g, "'''") + '\n```' }
            )
            .setColor(0xE74C3C)
            .setTimestamp();
          await logToChannel(message.guild, ID.MOD_LOG || ID.SERVER_LOGS, alert);
          return;
        }
      }
    } catch (err) {
      runtimeInstance?.logger?.warn(`Semantic spam check failed: ${err.message}`);
    }
  }



  // ── [13] XP System ────────────────────────────────────────────────────────
  const userId = message.author.id;
  const now    = Date.now();

  if (!db.xp) db.xp = {};
  if (!db.xp[userId]) db.xp[userId] = { xp: 0, level: 0, lastMessage: 0 };

  const userData = db.xp[userId];

  // Cooldown check
  if (now - userData.lastMessage < XP_COOLDOWN_MS) return;

  // Award XP
  const earned = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
  userData.xp         += earned;
  userData.lastMessage = now;

  const newLevel = calcLevel(userData.xp);
  const leveledUp = newLevel > userData.level;
  userData.level = newLevel;
  saveDb();

  // Level-up announcement
  if (leveledUp) {
    const lvlEmbed = new EmbedBuilder()
      .setTitle('🎉 Level Up!')
      .setDescription(`${message.author} reached **Level ${newLevel}**!`)
      .addFields({ name: '📊 XP', value: `${userData.xp} XP`, inline: true })
      .setColor(0xEDC231)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    await message.channel.send({ embeds: [lvlEmbed] }).catch(() => {});

    // Give level milestone role
    if (XP_LEVEL_ROLES[newLevel]) {
      const { name, color } = XP_LEVEL_ROLES[newLevel];
      const role = await getOrCreateRole(message.guild, name, color);
      if (role && !message.member.roles.cache.has(role.id)) {
        await message.member.roles.add(role).catch(() => {});
        // Log to mod-log
        const roleEmbed = new EmbedBuilder()
          .setTitle('⭐ Level Role Awarded')
          .setDescription(`${message.author} reached Level ${newLevel} and received **${name}**`)
          .setColor(color).setTimestamp();
        await logToChannel(message.guild, ID.MOD_LOG, roleEmbed);
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLER (buttons, commands, modals)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── COMMAND PERMISSION TIERS ────────────────────────────────────────────────
// PUBLIC    = any server member (with MEMBER role or verified)
// MEMBER    = must have MEMBER role
// STAFF     = mod / support / admin
// ADMIN     = administrator permission
// OWNER     = bot owner only

const CMD_TIERS = {
  // Public — any verified member
  PUBLIC:  ['help', 'request-song', 'queue', 'report-user', 'ai', 'ai-reset', 'ai-lang', 'draw', 'leaderboard', 'check-bypass'],

  // Member role required
  MEMBER:  ['rank'],

  // Staff role required
  STAFF:   ['warn', 'unwarn', 'kick', 'mute', 'unmute', 'timeout', 'untimeout',
             'note', 'cases', 'case', 'purge', 'lock', 'unlock', 'nick',
             'slowmode', 'protectme', 'say'],

  // Admin permission required
  ADMIN:   ['ban', 'tempban', 'unban', 'role', 'setup-panel',
             'embed', 'ai-embed', 'clear-channel', 'security', 'ai-channel',
             'whitelist-server', 'whitelist-role', 'setup-logs'],

  // Bot owner only
  OWNER:   ['whitelist'],
};

function getCmdTier(cmd) {
  for (const [tier, cmds] of Object.entries(CMD_TIERS)) {
    if (cmds.includes(cmd)) return tier;
  }
  return 'STAFF'; // default: staff-only for unknown commands
}

function hasCommandAccess(member, cmd, userId) {
  loadDb();
  const res = resolvePermission(member, cmd, userId, db);
  return res.allowed;
}


// ─── START ─────────────────────────────────────────────────────────────────────
client.on('guildCreate', async guild => {
  console.log(`📥 Joined a new server: ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`);

  // MULTI-SERVER: auto-detect this server's channels/roles by conventional
  // names and store them so features (welcome, logs, staff, tickets) work
  // here without manual setup. The owner can override later via /setup-server.
  try {
    const detected = await guildConfig.autoDetect(guild);
    const dbMgr = runtimeInstance.getService('DatabaseManager');
    const gdb = dbMgr.getGuildDb(guild.id);
    gdb.setup = { ...(gdb.setup || {}), ...detected };
    dbMgr.saveGuildDb(guild.id, true);
    console.log(`[guildCreate] Auto-detected setup for ${guild.name}:`, JSON.stringify({ roles: Object.keys(detected.roles), channels: Object.keys(detected.channels) }));
  } catch (err) {
    console.error('[guildCreate] Auto-detect failed:', err.message);
  }

  // Post the feature-showcase + quick-setup panel to the server and DM owner.
  try {
    const introPanel = require('../../modules/intro-panel');
    await introPanel.postIntro(guild);
  } catch (err) {
    console.error('[guildCreate] Intro panel failed:', err.message);
  }

  // Run v5.2 Onboarding Scanner
  const onboarding = runtime.getService('OnboardingScanner');
  if (onboarding) {
    onboarding.run(guild).catch(err => console.error('[guildCreate] Onboarding failed:', err));
  }

  try {
    const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
    if (owner) {
      const welcomeEmbed = new EmbedBuilder()
        .setTitle('⚡ ZENITSU LIVE — Onboarding Help Guide')
        .setDescription(
          `Thank you for inviting **ZENITSU LIVE** to **${guild.name}**!\n\n` +
          `I have sent this message to help you configure the bot successfully. As the **Server Owner**, you have full control over the configuration.`
        )
        .addFields(
          { 
            name: '🚀 Getting Started', 
            value: '• Run `/owner-help` in your server to read the complete 8-page configuration guide.\n' +
                   '• Use `/whoami` to inspect your active permissions tier.' 
          },
          { 
            name: '🛠️ Core Setup Commands', 
            value: '• Use `/setup-panel` to deploy your interactive support ticket panel.\n' +
                   '• Use `/setup-music` to create a voice channel and interactive music controls.\n' +
                   '• Use `/setup-logs` to configure where deleted message, voice, moderation, and server logs are sent.\n' +
                   '• Use `/security status` to view active guards, and `/security toggle-antiraid` or `/security toggle-antinuke` to toggle protections.' 
          },
          { 
            name: '🔐 Enterprise Permissions & Whitelisting', 
            value: 'The bot uses a secure 5-tier permission hierarchy. Normal administrators cannot configure the bot unless explicitly whitelisted.\n' +
                   '• Run `/whitelist add user:@User` to grant a trusted administrator specific capabilities (e.g. `AI_CONFIG`, `SECURITY_CONFIG`).\n' +
                   '• Run `/whitelist-role add role:@Role tier:staff` to authorize moderating/staff roles to execute commands.' 
          },
          { 
            name: '🤖 AI Configuration', 
            value: '• Use `/ai-channel channel:#channel` to designate a chat channel. Auto-replies are disabled, users query using `/ai`.\n' +
                   '• Use `/ai-model model:gpt4o` to set the default server model.' 
          },
          { 
            name: '🛡️ Anti-Abuse Role Guard', 
            value: 'To prevent admin abuse, any role additions made via the Discord UI by unauthorized users are automatically reverted, and they are warned in DMs. Whitelisted users must have the `ROLE_ASSIGN` capability to manage roles.' 
          }
        )
        .setColor(0xEDC231)
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp();

      await owner.send({ embeds: [welcomeEmbed] }).catch(() => {});
    }
  } catch (err) {
    console.error('Error sending welcome DM to server owner:', err.message);
  }
});

  // guildMemberUpdate event handler: DM users when given a whitelisted role later
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Find roles that were added
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    if (addedRoles.size === 0) return;

    const guildId = newMember.guild.id;
    const dbMgr = runtimeInstance?.getService('DatabaseManager');
    if (!dbMgr) return;
    const guildDb = dbMgr.getGuildDb(guildId);
    if (!guildDb || !guildDb.commandRoleWhitelist) return;

    const getRoleTier = (roleId) => {
      for (const [tier, roles] of Object.entries(guildDb.commandRoleWhitelist)) {
        if (Array.isArray(roles) && roles.includes(roleId)) return tier;
      }
      return null;
    };

    for (const [roleId, role] of addedRoles) {
      const tier = getRoleTier(roleId);
      if (tier) {
        const capabilities = guildDb.roleCapabilities?.[roleId] || [];
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔐 You Have Been Whitelisted')
          .setDescription(`You have been granted command permissions in **${newMember.guild.name}** because you were assigned the **${role.name}** role!`)
          .addFields(
            { name: '🛡️ Role', value: `${role.name}`, inline: true },
            { name: '🔑 Command Tier', value: `\`${tier.toUpperCase()}\``, inline: true }
          )
          .setColor(0x2ECC71)
          .setTimestamp();

        if (capabilities.length > 0) {
          dmEmbed.addFields({ name: '🔑 Capabilities', value: capabilities.map(c => `• ${c}`).join('\n') });
        }

        const { sendCleanDm } = require('../../modules/dm-manager');
        await sendCleanDm(newMember, { embeds: [dmEmbed] }).catch(() => {
          console.log(`Failed to DM user ${newMember.user.tag} (DMs closed)`);
        });
      }
    }
  });
}

module.exports = { registerEvents, getLanguageSelectorEmbed, logToReports, logAiAnalytics, logToChannel };
