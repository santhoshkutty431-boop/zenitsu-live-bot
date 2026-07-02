/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           SECURITY & ANTI-RAID MODULE                        ║
 * ║           modules/security.js                                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Detects and responds to:
 *  - Raid attempts (rapid joins, young accounts)
 *  - Spam (mentions, repeated messages, message floods)
 *  - Link / invite / scam filtering
 *  - Anti-nuke (mass channel/role deletions, webhook spam)
 *
 * Design principles:
 *  - All thresholds are configurable via db.securityConfig
 *  - Anti-nuke ALERTS only (no automated permission removal) to avoid false positives
 *  - In-memory Maps for rate tracking (reset on restart — acceptable trade-off)
 */

'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createCase, CaseType, parseDuration } = require('./case-manager');

// ─── DEFAULT SECURITY CONFIG ────────────────────────────────────────────────
const DEFAULT_SECURITY_CONFIG = {
  // Anti-Raid
  antiRaidEnabled:      true,
  joinRateLimit:        10,     // Max joins allowed within joinRateSeconds
  joinRateSeconds:      30,     // Window in seconds
  minAccountAgeDays:    7,      // Flag accounts younger than this
  quarantineEnabled:    true,   // Auto-assign Quarantine role to suspicious joins

  // Anti-Spam
  mentionSpamLimit:     6,      // Max mentions in one message before timeout
  messageFloodCount:    6,      // Same user messages within floodWindowMs
  messageFloodWindow:   5000,   // 5 seconds
  repeatedMsgCount:    4,      // Same content repeated X times → timeout
  spamTimeoutMinutes:   5,      // Timeout duration for spam violations

  // Link/Invite Filtering
  blockInvites:         true,
  blockScamLinks:       true,
  blockExternalLinks:   false,  // Only block invites + scam by default
  whitelistedDomains:   [],

  // Anti-Nuke Thresholds
  antiNukeEnabled:      true,
  nukeChannelThreshold: 3,      // Channel delete/create per nukeWindowSec
  nukeRoleThreshold:    3,
  nukeWebhookThreshold: 3,
  nukeBanThreshold:     5,      // Mass bans per nukeWindowSec
  nukeWindowSeconds:    60,
};

// ─── IN-MEMORY RATE TRACKERS ────────────────────────────────────────────────
// guildId → [timestamp, timestamp, ...]
const joinTracker    = new Map();

// userId → [{ content, timestamp }]
const msgTracker     = new Map();

// userId → [timestamp] (message flood)
const floodTracker   = new Map();

// Anti-nuke: guildId → { userId → { action → [timestamp] } }
const nukeTracker    = new Map();

// Quarantine cooldown: userId → timestamp (prevent double-quarantine)
const quarantinedSet = new Set();

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getConfig(db) {
  return { ...DEFAULT_SECURITY_CONFIG, ...(db.securityConfig || {}) };
}

const SCAM_PATTERNS = [
  /free[-\s]?nitro/i,
  /steam[-\s]?gift/i,
  /gift[-\s]?card/i,
  /earn[-\s]?robux/i,
  /bypass[-\s]?link/i,
  /click[-\s]?here.*win/i,
  /airdrop.*crypto/i,
  /claim.*prize/i,
  /verify.*wallet/i,
  /discord\.gift\/[a-zA-Z0-9]+/,
  /nitro.*free.*http/i,
  /steamcommunity\.com\/gift/i,
];

const INVITE_PATTERN = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9-]+/i;

function isScam(content)   { return SCAM_PATTERNS.some(p => p.test(content)); }
function hasInvite(content) { return INVITE_PATTERN.test(content); }

function hasExternalLink(content, whitelistedDomains = []) {
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const urls = content.match(urlPattern) || [];
  return urls.some(url => {
    try {
      const host = new URL(url).hostname;
      return !whitelistedDomains.some(d => host.endsWith(d));
    } catch { return false; }
  });
}

async function applySpamTimeout(member, reason, minutes, db, saveDb) {
  if (!member || !member.moderatable) return;
  const ms = minutes * 60_000;
  await member.timeout(ms, reason).catch(() => {});
}

// ─── ANTI-RAID: JOIN HANDLER ─────────────────────────────────────────────────

/**
 * Called from client.on('guildMemberAdd').
 * Checks join rate and account age; quarantines or alerts if suspicious.
 */
async function handleMemberJoin(member, db, saveDb, logToChannel, ID) {
  const cfg   = getConfig(db);
  if (!cfg.antiRaidEnabled) return;

  const guild = member.guild;
  const guildId = guild.id;
  const now   = Date.now();

  // ── ANTI-BOT JOIN PROTECTION ──────────────────────────────────────────
  if (member.user.bot) {
    try {
      // Fetch who added the bot
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fetchedLogs = await guild.fetchAuditLogs({
        limit: 5,
        type: 28, // AuditLogEvent.BotAdd
      }).catch(() => null);

      if (fetchedLogs) {
        const logEntry = fetchedLogs.entries.find(entry => entry.target?.id === member.id);
        if (logEntry) {
          const inviterId = logEntry.executor?.id;
          const ownerId   = guild.client.application?.owner?.id || guild.ownerId;
          const isOwner   = inviterId === ownerId || inviterId === guild.ownerId;
          const isWhitelisted = db.roleWhitelist && db.roleWhitelist.includes(inviterId);

          if (!isOwner && !isWhitelisted) {
            // Unauthorized bot added! Instantly ban the rogue bot.
            await member.ban({ reason: `Anti-Abuse: Unauthorized Bot added by <@${inviterId}>` }).catch(() => {});

            const alertEmbed = new EmbedBuilder()
              .setTitle('🚨 Critical Security Alert: Rogue Bot Blocked')
              .setDescription(`**Rogue Bot:** ${member.user.tag} (\`${member.id}\`)\n**Action Taken:** Instantly Banned from Server.\n**Invited By:** <@${inviterId}> (${logEntry.executor?.tag || inviterId})`)
              .setColor(0xFF0000)
              .setFooter({ text: 'Security Module • Anti-Nuke Enabled' })
              .setTimestamp();

            await logToChannel(guild, ID.MOD_LOG, alertEmbed);
            await logToChannel(guild, db.securityConfig?.securityLogId || ID.MOD_REPORTS, alertEmbed);
            return; // Stop processing further join checks
          }
        }
      }
    } catch (err) {
      console.error('Anti-Bot security check error:', err.message);
    }
  }

  // ── JOIN RATE TRACKING ──────────────────────────────────────────────────
  if (!joinTracker.has(guildId)) joinTracker.set(guildId, []);
  const joins = joinTracker.get(guildId);
  joins.push(now);

  // Prune old entries outside the window
  const windowMs = cfg.joinRateSeconds * 1000;
  const recentJoins = joins.filter(t => now - t < windowMs);
  joinTracker.set(guildId, recentJoins);

  const isRaid = recentJoins.length >= cfg.joinRateLimit;

  // ── ACCOUNT AGE CHECK ───────────────────────────────────────────────────
  const accountAgeMs  = now - member.user.createdTimestamp;
  const accountAgeDays = accountAgeMs / 86_400_000;
  const isNewAccount  = accountAgeDays < cfg.minAccountAgeDays;

  // ── QUARANTINE ──────────────────────────────────────────────────────────
  if ((isRaid || isNewAccount) && cfg.quarantineEnabled && !quarantinedSet.has(member.id)) {
    quarantinedSet.add(member.id);

    // Get or create Quarantine role
    let quarantineRole = guild.roles.cache.find(r => r.name === '🔒 Quarantine');
    if (!quarantineRole) {
      quarantineRole = await guild.roles.create({
        name:        '🔒 Quarantine',
        color:       0xE74C3C,
        reason:      'Auto-created by Security Module for suspicious joins',
        permissions: [],
      }).catch(() => null);

      // Deny access to all text channels for the quarantine role
      if (quarantineRole) {
        for (const [, ch] of guild.channels.cache) {
          if (ch.isTextBased()) {
            await ch.permissionOverwrites.create(quarantineRole, {
              SendMessages: false,
              ViewChannel:  false,
            }).catch(() => {});
          }
        }
      }
    }

    if (quarantineRole) {
      await member.roles.add(quarantineRole, 'Security: suspicious join').catch(() => {});
    }
  }

  // ── ALERT ───────────────────────────────────────────────────────────────
  if (isRaid || isNewAccount) {
    const securityLogId = db.securityConfig?.securityLogId || ID.MOD_LOG;
    const embed = new EmbedBuilder()
      .setTitle(isRaid ? '🚨 RAID ALERT — Rapid Join Detected' : '⚠️ Suspicious Account Joined')
      .setColor(isRaid ? 0xFF0000 : 0xF39C12)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: '👤 User',         value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: '🆔 Account ID',   value: member.id,                               inline: true },
        { name: '📅 Account Age',  value: `${accountAgeDays.toFixed(1)} days`,     inline: true },
        { name: '⚡ Join Rate',    value: `${recentJoins.length} joins in ${cfg.joinRateSeconds}s`, inline: true },
        { name: '🔒 Quarantined',  value: cfg.quarantineEnabled ? 'Yes' : 'No',    inline: true },
      )
      .setFooter({ text: `Security Module | Guild: ${guild.name}` })
      .setTimestamp();
    await logToChannel(guild, securityLogId, embed);
  }
}

// ─── ANTI-SPAM: MESSAGE HANDLER ──────────────────────────────────────────────

/**
 * Called from client.on('messageCreate') — enhanced automod.
 * Returns { violated: boolean, reason: string } for the caller to handle.
 */
async function handleMessageSecurity(message, db, saveDb, logToChannel, ID) {
  if (!message.guild || message.author.bot) return { violated: false };

  const cfg     = getConfig(db);
  const content = message.content;
  const userId  = message.author.id;
  const member  = message.member;
  const now     = Date.now();

  // Skip if member has ManageMessages permission (staff)
  if (member?.permissions.has(PermissionFlagsBits.ManageMessages)) return { violated: false };

  let violation = null;

  // ── SCAM DETECTION ──────────────────────────────────────────────────────
  if (cfg.blockScamLinks && isScam(content)) {
    violation = 'Scam / Phishing Content';
  }

  // ── INVITE DETECTION ────────────────────────────────────────────────────
  else if (cfg.blockInvites && hasInvite(content)) {
    violation = 'Advertising Discord Invite';
  }

  // ── MENTION SPAM ────────────────────────────────────────────────────────
  else if (message.mentions.users.size + message.mentions.roles.size >= cfg.mentionSpamLimit) {
    violation = `Mention Spam (${message.mentions.users.size + message.mentions.roles.size} mentions)`;
  }

  // ── CAPS SPAM ───────────────────────────────────────────────────────────
  else if (content.length >= 15) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 0 && (letters.replace(/[^A-Z]/g, '').length / letters.length) > 0.8) {
      violation = 'Excessive CAPS Spam';
    }
  }

  // ── MESSAGE FLOOD ───────────────────────────────────────────────────────
  if (!violation) {
    if (!floodTracker.has(userId)) floodTracker.set(userId, []);
    const floods = floodTracker.get(userId).filter(t => now - t < cfg.messageFloodWindow);
    floods.push(now);
    floodTracker.set(userId, floods);

    if (floods.length >= cfg.messageFloodCount) {
      violation = `Message Flood (${floods.length} messages in ${cfg.messageFloodWindow / 1000}s)`;
      floodTracker.set(userId, []); // reset after violation
    }
  }

  // ── REPEATED MESSAGE SPAM ───────────────────────────────────────────────
  if (!violation && content.length > 3) {
    if (!msgTracker.has(userId)) msgTracker.set(userId, []);
    const msgs = msgTracker.get(userId);
    msgs.push({ content: content.slice(0, 200), timestamp: now });

    // Keep only last 10 messages within 30 seconds
    const recentMsgs = msgs.filter(m => now - m.timestamp < 30_000).slice(-10);
    msgTracker.set(userId, recentMsgs);

    const sameCount = recentMsgs.filter(m => m.content === content.slice(0, 200)).length;
    if (sameCount >= cfg.repeatedMsgCount) {
      violation = `Repeated Message Spam (sent same message ${sameCount}×)`;
      msgTracker.set(userId, []);
    }
  }

  if (!violation) return { violated: false };

  // ── RESPOND TO VIOLATION ────────────────────────────────────────────────
  await message.delete().catch(() => {});

  const timeoutMs = (cfg.spamTimeoutMinutes || 5) * 60_000;
  if (member?.moderatable) {
    await member.timeout(timeoutMs, `AutoMod: ${violation}`).catch(() => {});
  }

  // Create a case
  const caseData = createCase(db, saveDb, {
    type:     CaseType.TIMEOUT,
    guildId:  message.guild.id,
    userId:   message.author.id,
    userTag:  message.author.tag,
    modId:    message.client.user.id,
    modTag:   message.client.user.tag,
    reason:   `AutoMod: ${violation}`,
    duration: timeoutMs,
  });

  // Warn in channel (auto-delete after 5s)
  const warnMsg = await message.channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('⚠️ Auto-Mod Action')
      .setDescription(`${message.author}, your message was removed.\n**Reason:** ${violation}\n**Timeout:** ${cfg.spamTimeoutMinutes} min`)
      .setColor(0xFF4500)
      .setFooter({ text: `Case: ${caseData.caseId}` })]
  }).catch(() => null);
  if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

  // Log to mod-log
  const logEmbed = new EmbedBuilder()
    .setTitle('🤖 AutoMod Violation')
    .setColor(0xFF4500)
    .addFields(
      { name: '👤 User',      value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
      { name: '📋 Case',      value: caseData.caseId,                                    inline: true },
      { name: '📌 Channel',   value: `${message.channel}`,                               inline: true },
      { name: '⚡ Violation', value: violation },
      { name: '📝 Content',   value: (content.slice(0, 500) || '*empty*') },
    )
    .setTimestamp();
  await logToChannel(message.guild, ID.MOD_LOG, logEmbed);

  return { violated: true, violation, caseId: caseData.caseId };
}

// ─── ANTI-NUKE DETECTION ─────────────────────────────────────────────────────

/**
 * Track a nuke-type action by an executor.
 * Returns true if the threshold has been exceeded.
 */
function trackNukeAction(guildId, executorId, action, thresholdCount, windowSeconds) {
  if (!nukeTracker.has(guildId)) nukeTracker.set(guildId, new Map());
  const guild = nukeTracker.get(guildId);

  if (!guild.has(executorId)) guild.set(executorId, {});
  const executor = guild.get(executorId);

  if (!executor[action]) executor[action] = [];
  const now = Date.now();
  executor[action] = executor[action].filter(t => now - t < windowSeconds * 1000);
  executor[action].push(now);

  return executor[action].length >= thresholdCount;
}

/**
 * Called from client.on('guildAuditLogEntry') to detect nuke patterns.
 * Sends an alert embed if thresholds are exceeded.
 */
async function handleAuditLogEntry(entry, guild, db, logToChannel, ID) {
  const cfg = getConfig(db);
  if (!cfg.antiNukeEnabled) return;

  const { AuditLogEvent } = require('discord.js');
  const executor  = entry.executor;
  if (!executor || executor.bot) return;

  const securityLogId = db.securityConfig?.securityLogId || ID.MOD_LOG;
  const guildId   = guild.id;
  const windowSec = cfg.nukeWindowSeconds || 60;

  let alertTitle   = null;
  let alertDetails = null;
  let exceeded     = false;

  switch (entry.action) {
    case AuditLogEvent.ChannelDelete:
      exceeded = trackNukeAction(guildId, executor.id, 'channelDelete', cfg.nukeChannelThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Channel Deletion'; alertDetails = `Deleted channel: **${entry.target?.name || 'Unknown'}**`; }
      break;

    case AuditLogEvent.ChannelCreate:
      exceeded = trackNukeAction(guildId, executor.id, 'channelCreate', cfg.nukeChannelThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Channel Creation'; alertDetails = `Created channel: **${entry.target?.name || 'Unknown'}**`; }
      break;

    case AuditLogEvent.RoleDelete:
      exceeded = trackNukeAction(guildId, executor.id, 'roleDelete', cfg.nukeRoleThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Role Deletion'; alertDetails = `Deleted role: **${entry.target?.name || 'Unknown'}**`; }
      break;

    case AuditLogEvent.RoleCreate:
      exceeded = trackNukeAction(guildId, executor.id, 'roleCreate', cfg.nukeRoleThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Role Creation'; alertDetails = `Created role: **${entry.target?.name || 'Unknown'}**`; }
      break;

    case AuditLogEvent.WebhookCreate:
      exceeded = trackNukeAction(guildId, executor.id, 'webhookCreate', cfg.nukeWebhookThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Webhook Spam Detected'; alertDetails = `Webhook created rapidly`; }
      break;

    case AuditLogEvent.MemberBanAdd:
      exceeded = trackNukeAction(guildId, executor.id, 'massban', cfg.nukeBanThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Ban Detected'; alertDetails = `Banned: **${entry.target?.tag || 'Unknown'}**`; }
      break;

    case AuditLogEvent.MemberKick:
      exceeded = trackNukeAction(guildId, executor.id, 'masskick', cfg.nukeBanThreshold, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Mass Kick Detected'; alertDetails = `Kicked: **${entry.target?.tag || 'Unknown'}**`; }
      break;

    case AuditLogEvent.GuildUpdate:
      exceeded = trackNukeAction(guildId, executor.id, 'guildUpdate', 3, windowSec);
      if (exceeded) { alertTitle = '🚨 ANTI-NUKE: Rapid Server Setting Changes'; alertDetails = 'Server settings changed multiple times rapidly'; }
      break;

    default:
      return;
  }

  if (!exceeded || !alertTitle) return;

  // ── SEND ALERT ──────────────────────────────────────────────────────────
  console.warn(`[Security/AntiNuke] ${alertTitle} by ${executor.tag} in ${guild.name}`);

  const embed = new EmbedBuilder()
    .setTitle(alertTitle)
    .setColor(0xFF0000)
    .setThumbnail(executor.displayAvatarURL())
    .addFields(
      { name: '⚡ Executor',   value: `${executor.tag} (<@${executor.id}>)`, inline: true },
      { name: '🆔 User ID',   value: executor.id,                             inline: true },
      { name: '📋 Action',    value: entry.action.toString(),                 inline: true },
      { name: '📝 Details',   value: alertDetails },
      { name: '⚠️ Action Required', value: '**Manually review this account immediately.** The bot has logged this incident but has NOT automatically stripped permissions to avoid disrupting legitimate administration.' },
    )
    .setFooter({ text: `Anti-Nuke System | ${guild.name}` })
    .setTimestamp();

  await logToChannel(guild, securityLogId, embed);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = {
  handleMemberJoin,
  handleMessageSecurity,
  handleAuditLogEntry,
  DEFAULT_SECURITY_CONFIG,
};
