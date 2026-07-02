const { 
  Client, 
  GatewayIntentBits, 
  Partials,
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ChannelType, 
  PermissionFlagsBits, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  InteractionType,
  AuditLogEvent
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const http = require('http');

// ─── DASHBOARD SERVER SETUP ──────────────────────────────────────────────────
const { startDashboardServer } = require('./dashboard');

// ─── COMMAND HANDLERS & MODULES ──────────────────────────────────────────────
const { handleEmbed }                                         = require('./commands/embed-handler');
const { createCase, getCase, getCasesForUser, updateCase,
        addNote, closeCase, searchCases,
        formatCaseEmbed, formatUserCasesEmbed,
        CaseType, parseDuration, formatDuration }             = require('./modules/case-manager');
const { startAutoPunishScheduler }                           = require('./modules/auto-punish');
const { handleMemberJoin: secHandleJoin,
        handleMessageSecurity,
        handleAuditLogEntry,
        DEFAULT_SECURITY_CONFIG }                             = require('./modules/security');
const { logMemberJoin, logMemberLeave,
        logMessageDelete, logMessageEdit,
        logVoiceUpdate, logRoleUpdate,
        logChannelUpdate, logGuildMemberRoleUpdate }          = require('./modules/logger');
const { queryAI, MODELS, clearHistory }                      = require('./modules/ai-handler');
const { handleAiEmbed }                                      = require('./modules/ai-embed');
const { handleAiTicketSupport, handleAiModeration,
        handleAiReactionTranslate, handleAiDraw }            = require('./modules/ai-features');

// Keep the self-ping logic to keep Render alive if RENDER_URL is defined
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  console.log(`🔄 Self-ping enabled → ${RENDER_URL}`);
  setInterval(() => {
    http.get(RENDER_URL, (res) => {
      console.log(`[${new Date().toISOString()}] Self-ping OK (${res.statusCode})`);
    }).on('error', (err) => {
      console.log(`[${new Date().toISOString()}] Self-ping failed: ${err.message}`);
    });
  }, 14 * 60 * 1000); // every 14 minutes
} else {
  console.log('ℹ️  Self-ping skipped (not running on Render)');
}
const config = require('./config');

// ─── CLIENT SETUP ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,      // [10] Voice logging
    GatewayIntentBits.GuildModeration,       // [11] Ban/unban events
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, // AI Flag Translator
  ],
  partials: [
    Partials.Message,   // Needed to receive delete events for uncached/old messages
    Partials.Channel,   // Needed for DM and partial channel events
    Partials.User,      // Needed for partial user data
    Partials.Reaction,  // Needed to receive reactions on old/uncached messages
  ]
});

// ─── KNOWN CHANNEL / ROLE IDS ─────────────────────────────────────────────────
const ID = {
  // Roles
  MEMBER_ROLE:   '1444551212904218705',
  CLIENTS_ROLE:  '1449096942469644480',
  ADMIN_ROLE:    '1521573583766294728',
  MOD_ROLE:      '1521573587859800204',
  SUPPORT_ROLE:  '1521573594251923456',
  OWNER_ROLE:    '1444534470869913752',

  // Channels
  WELCOME:       '1444533393688760411',
  RULES:         '1444538272884981882',
  GENERAL:       '1521944260616781889',  // #💬┆general-chat
  FEEDBACK:      '1445744625607507980',
  SONG_REQUEST:  '1459521604282486970',
  TICKET_CENTER: '1444538212583473162',
  MOD_REPORTS:   '1444639792846344273',
  BASIC_PANEL:   '1460152526463832097',
  STAFF_CHAT:    '1521940599031333045',

  // Log channels (written by setup-upgrades.js)
  SERVER_LOGS:   process.env.SERVER_LOGS_ID || '',
  VOICE_LOG:     process.env.VOICE_LOG_ID   || '',
  MOD_LOG:       process.env.MOD_LOG_ID     || '',
  MESSAGE_LOG:   process.env.MESSAGE_LOG_ID || '',
};

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, 'database.json');
let db = {
  songQueue:       [],
  activeTickets:   {},
  bypasses:        {},
  protectmeActive: true,
  spamTimeoutMinutes: 1,
  xp:              {},
  roleWhitelist:   [],
  deletedMessages: [],
  warnings:        {},     // legacy — still used for backward compat
  // ── Enterprise Moderation ──
  cases:           [],     // All moderation cases
  caseCounter:     0,      // Auto-incrementing case ID counter
  securityConfig:  { ...DEFAULT_SECURITY_CONFIG }, // Per-server security settings
  aiChannelId:     null,   // Channel ID for AI auto-reply (set via /ai-channel)
  aiDefaultModel:  'gemini', // Default AI model
  serverWhitelist: [],     // Extra guild IDs allowed to use this bot
  ticketLanguages: {},     // { [channelId]: 'english' | 'tunglish' | 'hinglish' },
  userLanguages: {}        // { [userId]: 'english' | 'tunglish' | 'hinglish' }
};

function loadDb() {
  if (fs.existsSync(dbPath)) {
    try { db = { ...db, ...JSON.parse(fs.readFileSync(dbPath, 'utf8')) }; }
    catch (e) { console.error('DB load error:', e.message); }
  }
}
function saveDb() {
  try { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8'); }
  catch (e) { console.error('DB save error:', e.message); }
}
loadDb();

// Start the dashboard web server immediately on startup
try {
  startDashboardServer(client, db, saveDb);
} catch (err) {
  console.error('⚠️ Failed to start dashboard server:', err.message);
}

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

async function logToChannel(guild, channelId, embed) {
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
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
function staffCheck(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    [ID.ADMIN_ROLE, ID.MOD_ROLE, ID.SUPPORT_ROLE, ID.OWNER_ROLE].some(id => member.roles.cache.has(id));
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  // Start auto-punishment expiry scheduler
  startAutoPunishScheduler(client, db, saveDb, logToChannel, ID);
  
  // Resolve supreme bot owner dynamically
  try {
    const app = await client.application.fetch();
    ownerId = app.owner.ownerId || app.owner.id;
    console.log(`👑 Supreme Bot Owner resolved: ${ownerId}`);
  } catch (err) {
    console.error('⚠️ Failed to fetch application owner:', err.message);
  }



  console.log(`   Server logs : ${ID.SERVER_LOGS || '(not set — run setup-upgrades.js first)'}`);
  console.log(`   Voice log   : ${ID.VOICE_LOG   || '(not set)'}`);
  console.log(`   Mod log     : ${ID.MOD_LOG      || '(not set)'}`);
  client.user.setActivity('ZENITSU LIVE | /help', { type: 3 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// [UPGRADE 1 + 2] — AUTO-ROLE VIA JOIN GATE + WELCOME DM
// ═══════════════════════════════════════════════════════════════════════════════
client.on('guildMemberAdd', async member => {
  console.log(`[JOIN] ${member.user.tag} joined`);

  // Security: anti-raid + account age check
  await secHandleJoin(member, db, saveDb, logToChannel, ID);

  // Logger: join log
  await logMemberJoin(member, ID);

  // [2] Welcome DM
  const dmEmbed = new EmbedBuilder()
    .setTitle(`👋 Welcome to ZENITSU LIVE, ${member.user.username}!`)
    .setDescription(
      '> You have joined the **ZENITSU LIVE** server!\n\n' +
      '**📌 Getting started:**\n' +
      `📜 Read the rules → <#${ID.RULES}>\n` +
      `✅ Click **Verify** in <#${ID.WELCOME}> to unlock the community\n` +
      `🛒 Browse products in the **SHOP** channels\n` +
      `🎫 Open a ticket if you need help\n\n` +
      '> See you inside! — **ZENITSU LIVE Staff**'
    )
    .setColor(0xEDC231)
    .setThumbnail(member.guild.iconURL({ dynamic: true }))
    .setFooter({ text: 'ZENITSU LIVE' })
    .setTimestamp();

  await member.send({ embeds: [dmEmbed] }).catch(() => {
    console.log(`  ⚠️  Could not DM ${member.user.tag} (DMs closed)`);
  });

  // Welcome message in channel
  const welcomeCh = member.guild.channels.cache.get(ID.WELCOME);
  if (welcomeCh) {
    const welcomeEmbed = new EmbedBuilder()
      .setTitle('👋 New Member!')
      .setDescription(
        `Welcome to **ZENITSU LIVE**, ${member}!\n\n` +
        `> 📜 Read <#${ID.RULES}> then click **✅ Verify** above to get full access!`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setColor(0xEDC231)
      .setFooter({ text: `Member #${member.guild.memberCount}` })
      .setTimestamp();
    await welcomeCh.send({ embeds: [welcomeEmbed] }).catch(() => {});
  }

  // [9] Log join to server-logs
  const joinEmbed = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setDescription(`${member.user} (${member.user.tag})`)
    .addFields(
      { name: 'User ID', value: member.user.id, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setColor(0x2ECC71)
    .setTimestamp();
  await logToChannel(member.guild, ID.SERVER_LOGS, joinEmbed);
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
          const isExecOwner = executorId === ownerId;
          const isExecGuildOwner = executorId === newMember.guild.ownerId;
          const isExecBot = executorId === client.user.id;
          const isExecWhitelisted = db.roleWhitelist && db.roleWhitelist.includes(executorId);

          if (!isExecOwner && !isExecGuildOwner && !isExecBot && !isExecWhitelisted) {
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
            
            // Prevent logging the unauthorized roles update as a normal update
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

// ─── LOGGER: MEMBER LEAVE ───────────────────────────────────────────────────
client.on('guildMemberRemove', async member => {
  await logMemberLeave(member, ID);
});

// ─── LOGGER & SECURITY: ROLE UPDATES ─────────────────────────────────────────
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    // 1. Log the basic changes
    await logRoleUpdate(oldRole, newRole, ID);

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
          const isExecOwner = executorId === ownerId;
          const isExecGuildOwner = executorId === newRole.guild.ownerId;
          const isExecBot = executorId === client.user.id;
          const isExecWhitelisted = db.roleWhitelist && db.roleWhitelist.includes(executorId);

          if (!isExecOwner && !isExecGuildOwner && !isExecBot && !isExecWhitelisted) {
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
  if (newCh.guild) await logChannelUpdate(oldCh, newCh, ID);
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
  }

  // ── ZENITSU AI — Auto-Reply in designated AI channel ─────────────────────
  if (db.aiChannelId && message.channel.id === db.aiChannelId) {
    if (message.content.startsWith('/') || message.content.length < 2) return;

    // Check if user has selected a language
    db.userLanguages = db.userLanguages || {};
    const userLang = db.userLanguages[message.author.id];

    if (!userLang) {
      const payload = getLanguageSelectorEmbed(message.author);
      await message.reply(payload).catch(() => {});
      return;
    }

    // Show typing indicator
    await message.channel.sendTyping().catch(() => {});

    const modelKey = db.aiDefaultModel || 'gemini';
    const result   = await queryAI(message.author.id, message.content, modelKey, userLang);

    // Send private analytics log to staff channel
    await logAiAnalytics(message.author, message.content, result, message.guild);

    const { EmbedBuilder: EB } = require('discord.js');

    if (result.error) {
      // User-friendly error message that hides specific API details
      await message.reply({ 
        content: '❌ The AI Service is temporarily overloaded. Our team has been notified. Please try again in a few moments!', 
        allowedMentions: { repliedUser: false } 
      }).catch(() => {});
    } else {
      const aiEmbed = new EB()
        .setAuthor({ name: 'ZENITSU AI', iconURL: message.client.user.displayAvatarURL() })
        .setDescription(result.response)
        .setColor(0x00D4FF)
        .setFooter({ text: 'ZENITSU AI • /ai-reset to clear memory' })
        .setTimestamp();
      await message.reply({ embeds: [aiEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    return;
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
  PUBLIC:  ['help', 'request-song', 'queue', 'report-user', 'ai', 'ai-reset', 'draw'],

  // Member role required
  MEMBER:  ['rank', 'feedback'],

  // Staff role required
  STAFF:   ['warn', 'unwarn', 'kick', 'mute', 'unmute', 'timeout', 'untimeout',
             'note', 'cases', 'case', 'purge', 'lock', 'unlock', 'nick',
             'slowmode', 'protectme', 'say'],

  // Admin permission required
  ADMIN:   ['ban', 'tempban', 'unban', 'role', 'setup-panel',
             'embed', 'ai-embed', 'clear-channel', 'security', 'ai-channel',
             'whitelist-server'],

  // Bot owner only
  OWNER:   ['giverole', 'whitelist'],
};

function getCmdTier(cmd) {
  for (const [tier, cmds] of Object.entries(CMD_TIERS)) {
    if (cmds.includes(cmd)) return tier;
  }
  return 'STAFF'; // default: staff-only for unknown commands
}

function hasCommandAccess(member, cmd, userId) {
  if (isOwner(userId)) return true; // bot owner bypasses everything

  const tier = getCmdTier(cmd);

  if (tier === 'PUBLIC') return true;

  if (tier === 'MEMBER') {
    return member?.roles?.cache?.has(ID.MEMBER_ROLE) || staffCheck(member);
  }

  if (tier === 'STAFF') return staffCheck(member);

  if (tier === 'ADMIN') {
    return member?.permissions?.has(PermissionFlagsBits.Administrator) ||
           member?.roles?.cache?.has(ID.OWNER_ROLE) ||
           member?.roles?.cache?.has(ID.ADMIN_ROLE);
  }

  if (tier === 'OWNER') return isOwner(userId);

  return false;
}

client.on('interactionCreate', async interaction => {
  // ── SERVER WHITELIST CHECK ───────────────────────────────────────────────────
  if (interaction.guildId) {
    const isMainGuild      = interaction.guildId === config.guildId;
    const isWhitelisted    = (db.serverWhitelist || []).includes(interaction.guildId);
    const isBotOwner       = isOwner(interaction.user.id);

    if (!isMainGuild && !isWhitelisted && !isBotOwner) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🔒 Private Bot')
          .setDescription(
            'This bot is **private** and only operates in authorized servers.\n\n' +
            '> To request access for your server, contact the **bot owner**.'
          )
          .setColor(0xFF0000)
          .setFooter({ text: 'ZENITSU BOT — Private Use Only' })
          .setTimestamp()
        ],
        ephemeral: true,
      }).catch(() => {});
    }
  }

  // ── SLASH COMMANDS ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    // ── ROLE / TIER PERMISSION CHECK ─────────────────────────────────────────
    if (!hasCommandAccess(interaction.member, cmd, interaction.user.id)) {
      const tier = getCmdTier(cmd);
      const tierLabels = {
        MEMBER: '`Member` role',
        STAFF:  '`Moderator` or `Support` role',
        ADMIN:  '`Administrator` permission',
        OWNER:  'Bot Owner',
      };
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🚫 Access Denied')
          .setDescription(`You need **${tierLabels[tier] || 'higher permissions'}** to use \`/${cmd}\`.`)
          .setColor(0xFF4444)
          .setTimestamp()
        ],
        ephemeral: true,
      });
    }

    // /setup-panel
    if (cmd === 'setup-panel') {
      // Row 1 — Ticket Categories (upgrade 21)
      const ticketRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_purchase').setLabel('🛒 Purchase').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_support').setLabel('🔧 Support').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_bug').setLabel('🐛 Bug Report').setStyle(ButtonStyle.Danger),
      );
      // Row 2 — Other panel buttons
      const utilRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('report_submit_btn').setLabel('🚨 Report User').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('view_song_queue').setLabel('🎶 Song Queue').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('get_member_role').setLabel('✅ Get Member Role').setStyle(ButtonStyle.Primary),
      );

      const embed = new EmbedBuilder()
        .setTitle('🖥️ ZENITSU LIVE — CONTROL PANEL')
        .setDescription(
          '**─── 🎫 OPEN A TICKET ───**\n' +
          '🛒 **Purchase** — Buy a product / place an order\n' +
          '🔧 **Support** — Get help with an existing product\n' +
          '🐛 **Bug Report** — Report a bug or issue\n\n' +
          '**─── OTHER ───**\n' +
          '🚨 **Report User** — Report a rule-breaking member\n' +
          '🎶 **Song Queue** — View active waifu song requests\n' +
          '✅ **Get Member Role** — Unlock the full community'
        )
        .setColor(0xEDC231)
        .setThumbnail(interaction.guild.iconURL())
        .setFooter({ text: 'ZENITSU LIVE Automation v2.0' })
        .setTimestamp();

      const panelCh = interaction.guild.channels.cache.get(config.channelPanel) || interaction.channel;
      await panelCh.send({ embeds: [embed], components: [ticketRow, utilRow] });
      await interaction.reply({ content: `✅ Panel posted in <#${panelCh.id}>`, ephemeral: true });
    }

    // /rank
    else if (cmd === 'rank') {
      const target = interaction.options.getUser('user') || interaction.user;
      const data   = db.xp?.[target.id];
      if (!data) return interaction.reply({ content: `${target.username} has not earned any XP yet.`, ephemeral: true });

      const level  = calcLevel(data.xp);
      const needed = xpForLevel(level + 1);
      const progress = Math.min(Math.floor(((data.xp - xpForLevel(level)) / (needed - xpForLevel(level))) * 20), 20);
      const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${target.username}'s Rank`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '⭐ Level',    value: `${level}`,         inline: true },
          { name: '✨ XP',       value: `${data.xp}`,        inline: true },
          { name: '🎯 Next Level', value: `${needed} XP`,   inline: true },
          { name: '📈 Progress', value: `\`[${bar}]\` ${data.xp}/${needed}` },
        )
        .setColor(0xEDC231)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /leaderboard
    else if (cmd === 'leaderboard') {
      const sorted = Object.entries(db.xp || {})
        .sort(([, a], [, b]) => b.xp - a.xp)
        .slice(0, 10);

      if (sorted.length === 0)
        return interaction.reply({ content: 'No XP data yet!', ephemeral: true });

      const medals = ['🥇', '🥈', '🥉'];
      const desc = sorted.map(([uid, d], i) =>
        `${medals[i] || `**${i + 1}.**`} <@${uid}> — **Level ${calcLevel(d.xp)}** · ${d.xp} XP`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🏆 ZENITSU LIVE Leaderboard')
        .setDescription(desc)
        .setColor(0xEDC231)
        .setFooter({ text: 'Top 10 most active members' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /request-song
    else if (cmd === 'request-song') {
      const song = interaction.options.getString('song');
      db.songQueue.push({ name: song, requester: interaction.user.tag, requesterId: interaction.user.id, requestedAt: new Date().toISOString() });
      saveDb();
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Requested!')
        .setDescription(`**Song:** ${song}\n**By:** ${interaction.user}`)
        .setColor(0xEDC231).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /queue
    else if (cmd === 'queue') {
      if (!db.songQueue.length) return interaction.reply({ content: 'Queue is empty!', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Queue')
        .setColor(0xEDC231)
        .setDescription(db.songQueue.slice(0, 20).map((s, i) => `**${i + 1}.** ${s.name} *(${s.requester})*`).join('\n'))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /protectme
    else if (cmd === 'protectme') {
      const active = interaction.options.getBoolean('active');
      db.protectmeActive = active; saveDb();
      await interaction.reply({ content: `Auto-mod is now **${active ? 'ENABLED ✅' : 'DISABLED ❌'}**`, ephemeral: true });
    }

    // /report-user
    else if (cmd === 'report-user') {
      const user   = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const embed  = new EmbedBuilder()
        .setTitle('🚨 User Report')
        .setDescription(`**Reporter:** ${interaction.user}\n**Reported:** ${user}\n**Reason:** ${reason}`)
        .setColor(0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ content: 'Report submitted to staff.', ephemeral: true });
    }

    // /mute
    else if (cmd === 'mute') {
      const target   = interaction.options.getMember('user');
      const duration = interaction.options.getInteger('duration') || 10;
      const reason   = interaction.options.getString('reason') || 'No reason';
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      await target.timeout(duration * 60_000, reason).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔇 Member Muted')
        .setDescription(`**User:** ${target}\n**Duration:** ${duration}m\n**Reason:** ${reason}\n**By:** ${interaction.user}`)
        .setColor(0xFF0000).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, embed);
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /unmute
    else if (cmd === 'unmute') {
      const target = interaction.options.getMember('user');
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      await target.timeout(null).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔊 Member Unmuted')
        .setDescription(`**User:** ${target}\n**By:** ${interaction.user}`)
        .setColor(0x2ECC71).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /lock & /unlock
    else if (cmd === 'lock' || cmd === 'unlock') {
      const ch = interaction.options.getChannel('channel') || interaction.channel;
      await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: cmd === 'lock' ? false : null }).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle(cmd === 'lock' ? '🔒 Channel Locked' : '🔓 Channel Unlocked')
        .setDescription(`${ch} was ${cmd === 'lock' ? 'locked' : 'unlocked'} by ${interaction.user}`)
        .setColor(cmd === 'lock' ? 0xFF0000 : 0x2ECC71).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /role add|remove
    else if (cmd === 'role') {
      const sub    = interaction.options.getSubcommand();
      const target = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      if (sub === 'add')    await target.roles.add(role).catch(() => {});
      if (sub === 'remove') await target.roles.remove(role).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle(sub === 'add' ? '➕ Role Added' : '➖ Role Removed')
        .setDescription(`**User:** ${target}\n**Role:** ${role}\n**By:** ${interaction.user}`)
        .setColor(sub === 'add' ? 0x2ECC71 : 0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /check-bypass
    else if (cmd === 'check-bypass') {
      await interaction.reply({ content: 'Check the <#1460152325267128520> channel for bypass info.', ephemeral: true });
    }

    // /say  ── upgraded: permission check + mod log
    else if (cmd === 'say') {
      const ch      = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      // Permission: Administrator or Manage Server
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setTitle('❌ Permission Denied')
          .setDescription('You need **Administrator** or **Manage Server** to use `/say`.')
          .setColor(0xE74C3C)], ephemeral: true });
      }

      if (!ch.isTextBased()) return interaction.reply({ content: '❌ Selected channel is not a text channel.', ephemeral: true });

      await ch.send({ content: message }).catch(() => {});

      // Log to mod log
      const sayLog = new EmbedBuilder()
        .setTitle('📣 /say Used')
        .setDescription(`**Sent by:** ${interaction.user} (${interaction.user.tag})\n**Channel:** ${ch}\n**Message:** ${message.slice(0, 500)}`)
        .setColor(0x3498DB).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, sayLog);

      await interaction.reply({ content: `✅ Message sent to ${ch}!`, ephemeral: true });
    }

    // /embed  ── professional announcement system
    else if (cmd === 'embed') {
      await handleEmbed(interaction, db, saveDb, logToChannel, ID);
    }

    // /whitelist
    else if (cmd === 'whitelist') {
      const sub = interaction.options.getSubcommand();
      if (!db.roleWhitelist) db.roleWhitelist = [];

      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        if (db.roleWhitelist.includes(user.id)) {
          return interaction.reply({ content: `⚠️ ${user} is already whitelisted.`, ephemeral: true });
        }
        db.roleWhitelist.push(user.id);
        saveDb();
        await interaction.reply({ content: `✅ Successfully whitelisted ${user} for role-giving permissions.`, ephemeral: true });
      }

      else if (sub === 'remove') {
        const user = interaction.options.getUser('user');
        if (!db.roleWhitelist.includes(user.id)) {
          return interaction.reply({ content: `⚠️ ${user} is not whitelisted.`, ephemeral: true });
        }
        db.roleWhitelist = db.roleWhitelist.filter(id => id !== user.id);
        saveDb();
        await interaction.reply({ content: `✅ Removed ${user} from the role-giving whitelist.`, ephemeral: true });
      }

      else if (sub === 'list') {
        if (!db.roleWhitelist.length) {
          return interaction.reply({ content: '📝 The role-giving whitelist is currently empty. (Bot Owner & Guild Owner always bypass).', ephemeral: true });
        }
        const listStr = db.roleWhitelist.map(id => `• <@${id}> (ID: \`${id}\`)`).join('\n');
        const embed = new EmbedBuilder()
          .setTitle('🛡️ Role-Giving Whitelist')
          .setDescription(`Only whitelisted users can assign roles to members on the server:\n\n${listStr}`)
          .setColor(0x00D4FF)
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    // /warn
    else if (cmd === 'warn') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (!db.warnings)           db.warnings = {};
      if (!db.warnings[target.id]) db.warnings[target.id] = [];

      // Legacy entry (backward compat)
      db.warnings[target.id].push({
        warnerTag: interaction.user.tag,
        warnerId:  interaction.user.id,
        reason,
        timestamp: new Date().toISOString(),
      });

      // Enterprise case entry
      const caseData = createCase(db, saveDb, {
        type:    CaseType.WARN,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      saveDb();

      await target.send(`⚠️ **Warning:** You have been warned in **${interaction.guild.name}**\n**Reason:** ${reason}\n**Case:** ${caseData.caseId}\n**Total warnings:** ${db.warnings[target.id].length}`).catch(() => {});
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('⚠️ Member Warned')
          .setDescription(`**User:** ${target} (${target.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .addFields({ name: 'Total Warnings', value: `${db.warnings[target.id].length}` })
          .setColor(0xF1C40F).setTimestamp()
      ]});
    }

    // /kick
    else if (cmd === 'kick') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: '❌ Member not found in this server.', ephemeral: true });
      if (!target.kickable) return interaction.reply({ content: '❌ I cannot kick this member. Check role hierarchy.', ephemeral: true });

      await target.send(`🚪 **Kicked:** You have been kicked from **${interaction.guild.name}**\n**Reason:** ${reason}`).catch(() => {});
      await target.kick(reason).catch(() => {});

      const caseData = createCase(db, saveDb, {
        type:    CaseType.KICK,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.user.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🚪 Member Kicked')
          .setDescription(`**User:** ${target.user} (${target.user.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .setColor(0xE67E22).setTimestamp()
      ]});
    }

    // /ban
    else if (cmd === 'ban') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = interaction.options.getMember('user');

      if (member && !member.bannable)
        return interaction.reply({ content: '❌ I cannot ban this member. Check role hierarchy.', ephemeral: true });

      await target.send(`🔨 **Banned:** You have been permanently banned from **${interaction.guild.name}**\n**Reason:** ${reason}`).catch(() => {});
      await interaction.guild.members.ban(target.id, { reason }).catch(() => {});

      const caseData = createCase(db, saveDb, {
        type:    CaseType.BAN,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🔨 Member Banned')
          .setDescription(`**User:** ${target} (${target.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .setColor(0xE74C3C).setTimestamp()
      ]});
    }

    // /purge
    else if (cmd === 'purge') {
      const amount = interaction.options.getInteger('amount') || 50;
      await interaction.deferReply({ ephemeral: true });
      try {
        const deleted = await interaction.channel.bulkDelete(amount, true); // true = skip messages >14 days
        await interaction.editReply({ content: `✅ Deleted **${deleted.size}** messages. (Messages older than 14 days are skipped automatically.)` });
      } catch (err) {
        await interaction.editReply({ content: `❌ Failed to purge: ${err.message}` });
      }
    }

    // /clear-channel
    else if (cmd === 'clear-channel') {
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
      await interaction.deferReply({ ephemeral: true });
      try {
        const ch = interaction.guild.channels.cache.get(targetChannel.id);
        if (!ch) return interaction.editReply({ content: '❌ Channel not found.' });

        // Clone the channel with the same settings
        const cloned = await ch.clone({
          name: ch.name,
          reason: `Channel cleared by ${interaction.user.tag} via /clear-channel`
        });

        // Move it to same position
        await cloned.setPosition(ch.rawPosition).catch(() => {});

        // Delete the old channel
        await ch.delete(`Cleared by ${interaction.user.tag}`);

        const logEmbed = new EmbedBuilder()
          .setTitle('🧹 Channel Cleared')
          .setDescription(`**Channel:** #${ch.name}\n**By:** ${interaction.user}\n\nAll messages have been wiped by cloning and deleting the original channel.`)
          .setColor(0x00D4FF)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, logEmbed);

        // Reply in the new channel
        await cloned.send({ embeds: [new EmbedBuilder()
          .setTitle('🧹 Channel Cleared')
          .setDescription(`This channel was cleared by ${interaction.user}. All previous messages have been removed.`)
          .setColor(0x00D4FF)
          .setTimestamp()
        ]});

        await interaction.editReply({ content: `✅ **#${ch.name}** has been fully cleared! All messages deleted.` });
      } catch (err) {
        await interaction.editReply({ content: `❌ Failed to clear channel: ${err.message}` });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ENTERPRISE MODERATION COMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    // /timeout
    else if (cmd === 'timeout') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target   = interaction.options.getMember('user');
      const durStr   = interaction.options.getString('duration');
      const reason   = interaction.options.getString('reason') || 'No reason provided';
      const durMs    = parseDuration(durStr);

      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      if (!durMs)  return interaction.reply({ content: '❌ Invalid duration. Use: `60s`, `5m`, `2h`, `1d`, `1w`', ephemeral: true });
      if (durMs > 28 * 24 * 60 * 60 * 1000) return interaction.reply({ content: '❌ Discord maximum timeout is 28 days.', ephemeral: true });
      if (!target.moderatable) return interaction.reply({ content: '❌ I cannot timeout this member (check role hierarchy).', ephemeral: true });

      await target.timeout(durMs, reason);
      const caseData = createCase(db, saveDb, {
        type: CaseType.TIMEOUT, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration: durMs,
      });
      await target.send(`⏸️ You have been timed out in **${interaction.guild.name}** for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** ${caseData.caseId}`).catch(() => {});
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏸️ Member Timed Out').setDescription(`${target.user.tag} timed out for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``).setColor(0xF39C12).setTimestamp()], ephemeral: true });
    }

    // /untimeout
    else if (cmd === 'untimeout') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      await target.timeout(null, reason);
      const caseData = createCase(db, saveDb, {
        type: CaseType.UNTIMEOUT, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ content: `✅ Timeout removed from **${target.user.tag}**. Case: \`${caseData.caseId}\``, ephemeral: true });
    }

    // /tempban
    else if (cmd === 'tempban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers))
        return interaction.reply({ content: '❌ You need **Ban Members** permission.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const durStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason');
      const durMs  = parseDuration(durStr);
      if (!durMs) return interaction.reply({ content: '❌ Invalid duration. Use: `1h`, `1d`, `7d`, `30d`', ephemeral: true });

      const member = interaction.options.getMember('user');
      if (member && !member.bannable) return interaction.reply({ content: '❌ I cannot ban this member.', ephemeral: true });

      await target.send(`🔨 You have been **temporarily banned** from **${interaction.guild.name}** for **${formatDuration(durMs)}**.\n**Reason:** ${reason}`).catch(() => {});
      await interaction.guild.members.ban(target.id, { reason: `Temp ban (${formatDuration(durMs)}): ${reason}` });
      const caseData = createCase(db, saveDb, {
        type: CaseType.TEMPBAN, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration: durMs,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏱️🔨 Temp Ban Applied').setDescription(`**${target.tag}** temp-banned for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\`\n**Auto-unban:** <t:${Math.floor((Date.now() + durMs) / 1000)}:R>`).setColor(0xC0392B).setTimestamp()], ephemeral: true });
    }

    // /slowmode
    else if (cmd === 'slowmode') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return interaction.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });

      const seconds = interaction.options.getInteger('seconds');
      const ch      = interaction.options.getChannel('channel') || interaction.channel;
      await ch.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
      const caseData = createCase(db, saveDb, {
        type: CaseType.SLOWMODE, guildId: interaction.guild.id,
        userId: interaction.user.id, userTag: interaction.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Slowmode set to ${seconds}s in #${ch.name}`,
      });
      await interaction.reply({ content: `✅ Slowmode in ${ch} set to **${seconds}s** (Case: \`${caseData.caseId}\`).`, ephemeral: true });
    }

    // /nick
    else if (cmd === 'nick') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames))
        return interaction.reply({ content: '❌ You need **Manage Nicknames** permission.', ephemeral: true });

      const target   = interaction.options.getMember('user');
      const nickname = interaction.options.getString('nickname') || null;
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      const oldNick = target.nickname || target.user.username;
      await target.setNickname(nickname, `Changed by ${interaction.user.tag}`);
      const caseData = createCase(db, saveDb, {
        type: CaseType.NICK, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Nickname: "${oldNick}" → "${nickname || 'reset'}"`,
      });
      await interaction.reply({ content: `✅ Nickname changed for ${target}: \`${oldNick}\` → \`${nickname || 'reset'}\` (Case: \`${caseData.caseId}\`)`, ephemeral: true });
    }

    // /unwarn
    else if (cmd === 'unwarn') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const caseId = interaction.options.getString('case_id').toUpperCase();
      const found  = getCase(db, caseId);

      if (!found) return interaction.reply({ content: `❌ Case \`${caseId}\` not found.`, ephemeral: true });
      if (found.userId !== target.id) return interaction.reply({ content: `❌ Case \`${caseId}\` does not belong to ${target.tag}.`, ephemeral: true });
      if (found.type !== CaseType.WARN) return interaction.reply({ content: `❌ Case \`${caseId}\` is not a WARN case.`, ephemeral: true });

      closeCase(db, saveDb, caseId);
      const removeCaseData = createCase(db, saveDb, {
        type: CaseType.UNWARN, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Removed warning ${caseId}`,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(removeCaseData));
      await interaction.reply({ content: `✅ Warning \`${caseId}\` removed from **${target.tag}**. New case: \`${removeCaseData.caseId}\``, ephemeral: true });
    }

    // /note
    else if (cmd === 'note') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to add notes.', ephemeral: true });

      const target  = interaction.options.getUser('user');
      const noteText = interaction.options.getString('note');
      const caseData = createCase(db, saveDb, {
        type: CaseType.NOTE, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: noteText,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ content: `✅ Note added for **${target.tag}**. Case: \`${caseData.caseId}\``, ephemeral: true });
    }

    // /cases
    else if (cmd === 'cases') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to view cases.', ephemeral: true });

      const target  = interaction.options.getUser('user');
      const typeFilter = interaction.options.getString('type')?.toUpperCase();
      let   cases   = getCasesForUser(db, interaction.guild.id, target.id);
      if (typeFilter) cases = cases.filter(c => c.type === typeFilter);

      const embed = formatUserCasesEmbed(target.id, target.tag, cases);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /case
    else if (cmd === 'case') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to view cases.', ephemeral: true });

      const caseId = interaction.options.getString('id').toUpperCase();
      const found  = getCase(db, caseId);
      if (!found) return interaction.reply({ content: `❌ Case \`${caseId}\` not found.`, ephemeral: true });

      await interaction.reply({ embeds: [formatCaseEmbed(found)], ephemeral: true });
    }

    // /security
    else if (cmd === 'security') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });

      const sub = interaction.options.getSubcommand();
      if (!db.securityConfig) db.securityConfig = { ...DEFAULT_SECURITY_CONFIG };

      if (sub === 'status') {
        const cfg = db.securityConfig;
        const embed = new EmbedBuilder()
          .setTitle('🛡️ Security Module Status')
          .setColor(0x00D4FF)
          .addFields(
            { name: '🔒 Anti-Raid',         value: cfg.antiRaidEnabled     ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '💣 Anti-Nuke',          value: cfg.antiNukeEnabled     ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '🔒 Auto-Quarantine',    value: cfg.quarantineEnabled   ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '⚡ Join Rate Limit',    value: `${cfg.joinRateLimit} joins / ${cfg.joinRateSeconds}s`, inline: true },
            { name: '📅 Min Account Age',    value: `${cfg.minAccountAgeDays} days`,                        inline: true },
            { name: '💬 Mention Limit',      value: `${cfg.mentionSpamLimit} mentions`,                     inline: true },
            { name: '🌊 Flood Limit',        value: `${cfg.messageFloodCount} msgs / ${cfg.messageFloodWindow / 1000}s`, inline: true },
            { name: '🔁 Repeat Limit',       value: `${cfg.repeatedMsgCount}× same message`,                inline: true },
            { name: '⏱️ Spam Timeout',      value: `${cfg.spamTimeoutMinutes} minutes`,                    inline: true },
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });

      } else if (sub === 'toggle-antinuke') {
        db.securityConfig.antiNukeEnabled = !db.securityConfig.antiNukeEnabled;
        saveDb();
        await interaction.reply({ content: `💣 Anti-Nuke is now **${db.securityConfig.antiNukeEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });

      } else if (sub === 'toggle-antiraid') {
        db.securityConfig.antiRaidEnabled = !db.securityConfig.antiRaidEnabled;
        saveDb();
        await interaction.reply({ content: `🔒 Anti-Raid is now **${db.securityConfig.antiRaidEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });

      } else if (sub === 'toggle-quarantine') {
        db.securityConfig.quarantineEnabled = !db.securityConfig.quarantineEnabled;
        saveDb();
        await interaction.reply({ content: `🔒 Auto-Quarantine is now **${db.securityConfig.quarantineEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ZENITSU AI COMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    // /ai
    else if (cmd === 'ai') {
      db.userLanguages = db.userLanguages || {};
      const userLang = db.userLanguages[interaction.user.id];

      if (!userLang) {
        const payload = getLanguageSelectorEmbed(interaction.user);
        return interaction.reply({ ...payload, ephemeral: true });
      }

      await interaction.deferReply();

      const prompt   = interaction.options.getString('prompt');
      const modelKey = interaction.options.getString('model') || db.aiDefaultModel || 'gemini';
      const result   = await queryAI(interaction.user.id, prompt, modelKey, userLang);

      // Send private analytics log to staff channel
      await logAiAnalytics(interaction.user, prompt, result, interaction.guild);

      if (result.error) {
        return interaction.editReply({ 
          content: '❌ The AI Service is temporarily overloaded. Our team has been notified. Please try again in a few moments!' 
        });
      }

      const aiEmbed = new EmbedBuilder()
        .setAuthor({
          name:    'ZENITSU AI',
          iconURL: interaction.client.user.displayAvatarURL(),
        })
        .addFields(
          { name: '💬 Your Question', value: prompt.slice(0, 1024) },
          { name: '🤖 Answer',        value: result.response.slice(0, 1024) },
        )
        .setColor(0x00D4FF)
        .setFooter({ text: 'ZENITSU AI • Reply is remembered • /ai-reset to clear' })
        .setTimestamp();

      await interaction.editReply({ embeds: [aiEmbed] });
    }

    // /ai-lang
    else if (cmd === 'ai-lang') {
      const selectedLang = interaction.options.getString('language');
      db.userLanguages = db.userLanguages || {};
      db.userLanguages[interaction.user.id] = selectedLang;
      saveDb();

      const names = { english: 'English 🇬🇧', hinglish: 'Hinglish 🇮🇳', tanglish: 'Tanglish 🐯' };
      await interaction.reply({
        content: `✅ Your preferred AI language has been set to **${names[selectedLang]}**! ZENITSU AI will now reply in this dialect.`,
        ephemeral: true
      });
    }

    // /ai-reset
    else if (cmd === 'ai-reset') {
      clearHistory(interaction.user.id);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔄 Memory Cleared')
            .setDescription('Your AI conversation history has been reset. The next message starts a fresh conversation.')
            .setColor(0xF39C12)
            .setTimestamp()
        ],
        ephemeral: true,
      });
    }

    // /ai-channel
    else if (cmd === 'ai-channel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });

      const ch = interaction.options.getChannel('channel');

      if (!ch) {
        db.aiChannelId = null;
        saveDb();
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('🤖 AI Channel Disabled')
            .setDescription('AI auto-reply channel has been removed. Use `/ai` command to chat with AI.')
            .setColor(0xE74C3C).setTimestamp()],
          ephemeral: true,
        });
      }

      db.aiChannelId = ch.id;
      saveDb();

      // Post an intro message in the newly set AI channel
      const introEmbed = new EmbedBuilder()
        .setTitle('🤖 ZENITSU AI ACTIVE')
        .setDescription(
          '**Type any question directly in this channel to get an instant response!**\n\n' +
          '🔹 **Memory Recall:** I remember the last 10 messages of our conversation.\n\n' +
          '🔹 **Global Chat:** Use the `/ai` command in any other channel to chat.\n\n' +
          '🔹 **Reset Memory:** Use the `/ai-reset` command to clear your conversation history.\n\n' +
          '*Feel free to ask me anything about gaming, coding, the server, or general knowledge!*'
        )
        .setColor(0x00D4FF)
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'ZENITSU LIVE • Premium AI Assistant' })
        .setTimestamp();

      await ch.send({ embeds: [introEmbed] }).catch(() => {});

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ AI Channel Set')
          .setDescription(`${ch} is now the dedicated AI chat channel.\nMembers can type directly to chat with **ZENITSU AI**.`)
          .setColor(0x2ECC71).setTimestamp()],
        ephemeral: true,
      });
    }

    // /whitelist-server
    else if (cmd === 'whitelist-server') {
      if (!isOwner(interaction.user.id))
        return interaction.reply({ content: '❌ Only the **bot owner** can manage the server whitelist.', ephemeral: true });

      const sub = interaction.options.getSubcommand();
      if (!db.serverWhitelist) db.serverWhitelist = [];

      if (sub === 'add') {
        const serverId = interaction.options.getString('server_id').trim();
        if (db.serverWhitelist.includes(serverId))
          return interaction.reply({ content: `⚠️ Server \`${serverId}\` is already whitelisted.`, ephemeral: true });
        db.serverWhitelist.push(serverId);
        saveDb();
        const guild = client.guilds.cache.get(serverId);
        const name  = guild ? `**${guild.name}**` : `\`${serverId}\``;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅ Server Whitelisted').setDescription(`${name} can now use **ZENITSU BOT**.`).setColor(0x2ECC71).setTimestamp()], ephemeral: true });

      } else if (sub === 'remove') {
        const serverId = interaction.options.getString('server_id').trim();
        const idx = db.serverWhitelist.indexOf(serverId);
        if (idx === -1) return interaction.reply({ content: `⚠️ Server \`${serverId}\` is not in the whitelist.`, ephemeral: true });
        db.serverWhitelist.splice(idx, 1);
        saveDb();
        await interaction.reply({ content: `🗑️ Removed \`${serverId}\` from whitelist.`, ephemeral: true });

      } else if (sub === 'list') {
        const list = db.serverWhitelist;
        if (list.length === 0) return interaction.reply({ content: '📋 No extra servers whitelisted. Only your main server can use this bot.', ephemeral: true });
        const lines = list.map((id, i) => { const g = client.guilds.cache.get(id); return `\`${i+1}.\` ${g ? `**${g.name}**` : 'Unknown'} — \`${id}\``; }).join('\n');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔒 Whitelisted Servers').setDescription(lines).setColor(0x00D4FF).setFooter({ text: `${list.length} server(s)` }).setTimestamp()], ephemeral: true });
      }
    }

    // /ai-embed
    else if (cmd === 'ai-embed') {
      await handleAiEmbed(interaction, db, saveDb, logToChannel, ID);
    }

    // /draw
    else if (cmd === 'draw') {
      await handleAiDraw(interaction);
    }
  }



  // ── BUTTONS ────────────────────────────────────────────────────────────────
  else if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId.startsWith('setlang_')) {
      const parts = customId.split('_');
      const lang = parts[1];
      const targetUserId = parts[2];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({ content: '❌ Only the user who sent the prompt can choose the language!', ephemeral: true });
      }

      db.userLanguages = db.userLanguages || {};
      db.userLanguages[targetUserId] = lang;
      saveDb();

      const names = { english: 'English 🇬🇧', hinglish: 'Hinglish 🇮🇳', tanglish: 'Tanglish 🐯' };
      
      await interaction.update({
        content: `✅ Preferred language has been set to **${names[lang]}**!\nZENITSU AI will now reply in this dialect. Please type your message/question again!`,
        embeds: [],
        components: []
      });
      return;
    }

    // [7] JOIN GATE — Verify button
    if (customId === 'verify_member') {
      await interaction.deferReply({ ephemeral: true });
      const role = interaction.guild.roles.cache.get(ID.MEMBER_ROLE);
      if (!role) return interaction.editReply({ content: 'MEMBER role not found. Contact an admin.' });

      if (interaction.member.roles.cache.has(ID.MEMBER_ROLE)) {
        return interaction.editReply({ content: '✅ You are already verified and have the **MEMBER** role!' });
      }

      await interaction.member.roles.add(role).catch(() => {});

      // Log to server-logs
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Member Verified')
        .setDescription(`${interaction.user} (${interaction.user.tag}) clicked Verify and received **MEMBER** role.`)
        .setColor(0x2ECC71).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, logEmbed);

      await interaction.editReply({
        content: '🎉 **Verified!** You now have access to:\n💬 `general-chat`\n📸 `feedback`\n🎶 `song-requests`\n🎧 All voice channels!'
      });
    }

    // [1] GET MEMBER ROLE — panel button (same as verify)
    else if (customId === 'get_member_role') {
      await interaction.deferReply({ ephemeral: true });
      const role = interaction.guild.roles.cache.get(ID.MEMBER_ROLE);
      if (!role) return interaction.editReply({ content: 'MEMBER role not found.' });
      if (interaction.member.roles.cache.has(ID.MEMBER_ROLE))
        return interaction.editReply({ content: '✅ You already have the **MEMBER** role!' });
      await interaction.member.roles.add(role).catch(() => {});
      await interaction.editReply({ content: '✅ You have been given the **MEMBER** role! Welcome to **ZENITSU LIVE**!' });
    }

    // ── [21] TICKET CATEGORIES ─────────────────────────────────────────────────
    else if (['ticket_purchase', 'ticket_support', 'ticket_bug'].includes(customId)) {
      await interaction.deferReply({ ephemeral: true });

      const existing = db.activeTickets[interaction.user.id];
      if (existing && interaction.guild.channels.cache.get(existing))
        return interaction.editReply({ content: `You already have an open ticket: <#${existing}>` });

      const typeMap = {
        ticket_purchase: {
          prefix: 'purchase', emoji: '🛒', color: 0x2ECC71,
          title: '🛒 Purchase Ticket',
          desc:  `Hello ${interaction.user}! Please provide:\n\n**1.** Which product do you want?\n**2.** Preferred payment method\n\n> Staff will respond with price and payment details.`,
          ping:  `${interaction.user} | <@&${ID.SUPPORT_ROLE}> | <@&${ID.ADMIN_ROLE}>`,
        },
        ticket_support: {
          prefix: 'support', emoji: '🔧', color: 0x3498DB,
          title: '🔧 Support Ticket',
          desc:  `Hello ${interaction.user}! Please describe:\n\n**1.** Which product has the issue?\n**2.** What is the problem? (detail)\n**3.** When did it start?\n**4.** Provide screenshots if any\n\n> Support team will help you shortly.`,
          ping:  `${interaction.user} | <@&${ID.SUPPORT_ROLE}>`,
        },
        ticket_bug: {
          prefix: 'bug', emoji: '🐛', color: 0xE74C3C,
          title: '🐛 Bug Report',
          desc:  `Hello ${interaction.user}! Please describe the bug:\n\n**1.** Which product/feature?\n**2.** What is happening? (step by step)\n**3.** Does it happen every time?\n**4.** Screenshot or video if possible\n\n> Our team will investigate and fix this.`,
          ping:  `${interaction.user} | <@&${ID.ADMIN_ROLE}>`,
        },
      };

      const t = typeMap[customId];

      // Find the SUPPORT category dynamically or fallback to the correct ID
      let parentCategory = interaction.guild.channels.cache.get(config.categoryTickets);
      if (!parentCategory || parentCategory.type !== ChannelType.GuildCategory) {
        parentCategory = interaction.guild.channels.cache.find(c => c.name.includes('SUPPORT') && c.type === ChannelType.GuildCategory)
          || interaction.guild.channels.cache.get('1444538003824447621');
      }

      const ticketCh = await interaction.guild.channels.create({
        name: `${t.prefix}-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: parentCategory ? parentCategory.id : null,
        topic: `${t.emoji} ${t.prefix.toUpperCase()} ticket for ${interaction.user.tag}`,
        permissionOverwrites: [
          { id: interaction.guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
          { id: ID.ADMIN_ROLE,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
          { id: ID.MOD_ROLE,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
          { id: ID.SUPPORT_ROLE,       allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
        reason: `${t.emoji} Ticket by ${interaction.user.tag}`
      }).catch((e) => {
        console.error('Failed to create ticket channel:', e.message);
        return null;
      });

      if (!ticketCh) return interaction.editReply({ content: 'Could not create ticket. Check bot permissions.' });

      db.activeTickets[interaction.user.id] = ticketCh.id; saveDb();

      const ticketEmbed = new EmbedBuilder()
        .setTitle(t.title)
        .setDescription(t.desc)
        .setColor(t.color)
        .setFooter({ text: `Ticket: ${ticketCh.name}` })
        .setTimestamp();
      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
      );
      await ticketCh.send({ content: t.ping, embeds: [ticketEmbed], components: [closeRow] });

      // Language selection buttons
      const langEmbed = new EmbedBuilder()
        .setTitle('🌐 Select Your Language / भाषा चुनें')
        .setDescription(
          'Please select your preferred language for the AI Support Assistant:\n' +
          'AI सहायता के लिए अपनी भाषा चुनें:\n\n' +
          '• **English** — standard English response\n' +
          '• **Tamil (Tunglish)** — Tamil written in English letters (e.g. *Vanakkam*)\n' +
          '• **Hindi (Hinglish)** — Hindi written in English letters (e.g. *Namaste*)'
        )
        .setColor(0x00D4FF);

      const langRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_lang_english').setLabel('🇬🇧 English').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_lang_tunglish').setLabel('🌴 Tamil (Tunglish)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_lang_hinglish').setLabel('🇮🇳 Hindi (Hinglish)').setStyle(ButtonStyle.Secondary)
      );

      await ticketCh.send({ embeds: [langEmbed], components: [langRow] });


      const logEmbed = new EmbedBuilder()
        .setTitle(`${t.emoji} Ticket Opened — ${t.prefix.toUpperCase()}`)
        .setDescription(`**User:** ${interaction.user} (${interaction.user.tag})\n**Channel:** ${ticketCh}\n**Type:** ${t.title}`)
        .setColor(t.color).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, logEmbed);

      await interaction.editReply({ content: `${t.emoji} Ticket created: <#${ticketCh.id}>` });
    }

    // Close Ticket
    else if (customId === 'ticket_close') {
      await interaction.reply({ content: '🔒 Closing ticket in 5 seconds...', ephemeral: false });
      for (const [uid, chanId] of Object.entries(db.activeTickets)) {
        if (chanId === interaction.channel.id) { delete db.activeTickets[uid]; saveDb(); break; }
      }
      const closeLog = new EmbedBuilder()
        .setTitle('🔒 Ticket Closed')
        .setDescription(`**Channel:** ${interaction.channel.name}\n**Closed by:** ${interaction.user}`)
        .setColor(0x95A5A6).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, closeLog);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // Ticket Language Selection
    else if (customId.startsWith('ticket_lang_')) {
      await interaction.deferUpdate();

      const langMap = {
        ticket_lang_english:  { key: 'english',  label: '🇬🇧 English', response: 'Preference saved! Tell me how I can help you today.' },
        ticket_lang_tunglish: { key: 'tunglish', label: '🌴 Tamil (Tunglish)', response: 'Unga language Tamil (Tunglish) save aayiduchu! Ungaluku enna help venum nu sollunga.' },
        ticket_lang_hinglish: { key: 'hinglish', label: '🇮🇳 Hindi (Hinglish)', response: 'Aapka language Hindi (Hinglish) save ho gaya hai! Bataiye main aapki kya madad kar sakta hoon?' }
      };

      const choice = langMap[customId];
      if (!choice) return;

      if (!db.ticketLanguages) db.ticketLanguages = {};
      db.ticketLanguages[interaction.channel.id] = choice.key;
      saveDb();

      // Edit the buttons message to confirm selection
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🌐 Preferred Language Selected / भाषा चुनी गई')
        .setDescription(
          `**Selected:** ${choice.label}\n\n` +
          `💬 *${choice.response}*`
        )
        .setColor(0x2ECC71);

      await interaction.editReply({ embeds: [updatedEmbed], components: [] });
    }

    // Report button
    else if (customId === 'report_submit_btn') {
      const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Submit a Report');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('report_target').setLabel('Who / What are you reporting?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('report_details').setLabel('Describe the issue').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
      await interaction.showModal(modal);
    }

    // Song queue button
    else if (customId === 'view_song_queue') {
      if (!db.songQueue.length) return interaction.reply({ content: 'Queue is empty!', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Queue')
        .setColor(0xEDC231)
        .setDescription(db.songQueue.slice(0, 15).map((s, i) => `**${i + 1}.** ${s.name} *(${s.requester})*`).join('\n'))
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ── MODALS ─────────────────────────────────────────────────────────────────
  else if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'report_modal') {
      const target  = interaction.fields.getTextInputValue('report_target');
      const details = interaction.fields.getTextInputValue('report_details');
      const embed   = new EmbedBuilder()
        .setTitle('🚨 Report Submitted')
        .setDescription(`**Reporter:** ${interaction.user}\n**Target:** ${target}\n**Details:** ${details}`)
        .setColor(0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ content: '✅ Report submitted to staff.', ephemeral: true });
    }
    if (interaction.customId === 'uid_modal') {
      const uid = interaction.fields.getTextInputValue('uid_value');
      if (!db.bypasses[uid]) {
        db.bypasses[uid] = { status: 'Bypassed', registeredAt: new Date().toISOString(), userId: interaction.user.id };
        saveDb();
      }
      await interaction.reply({ content: `✅ UID **${uid}** registered as Bypassed.`, ephemeral: true });
    }
  }
});

// ─── START ─────────────────────────────────────────────────────────────────────
client.on('guildCreate', guild => {
  console.log(`📥 Joined a new server: ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`);
});

function startBot() {
  client.login(config.token).catch(err => {
    console.error('Login failed:', err.message);
    console.log('🔄 Retrying login in 15 seconds...');
    setTimeout(startBot, 15000);
  });
}
startBot();
