/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   GUILD CONFIG — per-server channel/role resolution           ║
 * ║   modules/guild-config.js                                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Makes the bot MULTI-SERVER. Instead of hardcoded channel/role IDs (which
 * only exist on the main server), everything resolves per-guild in this order:
 *
 *   1. Per-guild config the server owner set (gdb.setup.<kind>)
 *   2. Auto-detected config stored when the bot joined (gdb.setup.<kind>)
 *   3. The hardcoded ID map — ONLY on the main server (backwards compat)
 *   4. Name-based lookup (find a role/channel with a conventional name)
 *   5. null / graceful skip
 *
 * Staff detection also works on any server via Discord permissions, so
 * moderation features don't depend on a specific role existing.
 */

'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');

const MAIN_GUILD_ID = process.env.GUILD_ID || '1444533392518680719';
const isMainGuild = (guildId) => guildId === MAIN_GUILD_ID;

// Conventional names to auto-detect for each logical role/channel "kind".
const ROLE_NAME_HINTS = {
  member:  ['member', 'members', 'verified'],
  clients: ['client', 'clients', 'customer'],
  admin:   ['admin', 'administrator'],
  mod:     ['mod', 'moderator', 'staff'],
  support: ['support', 'helper', 'staff'],
  muted:   ['muted', 'mute'],
};
const CHANNEL_NAME_HINTS = {
  welcome:     ['welcome', 'greet', 'join'],
  rules:       ['rules', 'rule'],
  general:     ['general', 'chat', 'lobby'],
  feedback:    ['feedback', 'review', 'suggestion'],
  modReports:  ['reports', 'mod-report', 'report'],
  ticketCenter:['ticket', 'tickets', 'support'],
  serverLogs:  ['server-log', 'server-logs', 'logs'],
};
// Which hardcoded ID-map key backs each kind (main server only).
const ROLE_ID_KEYS = { member:'MEMBER_ROLE', clients:'CLIENTS_ROLE', admin:'ADMIN_ROLE', mod:'MOD_ROLE', support:'SUPPORT_ROLE', owner:'OWNER_ROLE' };
const CHANNEL_ID_KEYS = { welcome:'WELCOME', rules:'RULES', general:'GENERAL', feedback:'FEEDBACK', modReports:'MOD_REPORTS', ticketCenter:'TICKET_CENTER', serverLogs:'SERVER_LOGS' };

function getSetup(gdb) {
  return (gdb && gdb.setup) || {};
}

function cleanName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── ROLE RESOLUTION ──────────────────────────────────────────────────────────
function resolveRoleId(guild, kind, gdb, ID) {
  const setup = getSetup(gdb);
  if (setup.roles && setup.roles[kind]) return setup.roles[kind];
  if (guild && isMainGuild(guild.id) && ID && ROLE_ID_KEYS[kind] && ID[ROLE_ID_KEYS[kind]]) return ID[ROLE_ID_KEYS[kind]];
  const hints = ROLE_NAME_HINTS[kind] || [];
  const cache = guild && guild.roles && guild.roles.cache;
  if (!cache) return null;
  const found = cache.find(r => hints.some(h => cleanName(r.name).includes(cleanName(h))));
  return found ? found.id : null;
}
function resolveRole(guild, kind, gdb, ID) {
  const id = resolveRoleId(guild, kind, gdb, ID);
  return id ? guild.roles.cache.get(id) || null : null;
}

// ── CHANNEL RESOLUTION ───────────────────────────────────────────────────────
function resolveChannelId(guild, kind, gdb, ID) {
  const setup = getSetup(gdb);
  if (setup.channels && setup.channels[kind]) return setup.channels[kind];
  if (guild && isMainGuild(guild.id) && ID && CHANNEL_ID_KEYS[kind] && ID[CHANNEL_ID_KEYS[kind]]) return ID[CHANNEL_ID_KEYS[kind]];
  const hints = CHANNEL_NAME_HINTS[kind] || [];
  const cache = guild && guild.channels && guild.channels.cache;
  if (!cache) return null;
  const found = cache.find(c => c.isTextBased?.() && hints.some(h => cleanName(c.name).includes(cleanName(h))));
  return found ? found.id : null;
}

// ── STAFF DETECTION (works on any server) ────────────────────────────────────
function isStaff(member, gdb, ID) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId) return true;

  // Discord-permission based — universal, no specific role required.
  const perms = member.permissions;
  if (perms.has(PermissionFlagsBits.Administrator) ||
      perms.has(PermissionFlagsBits.ManageGuild) ||
      perms.has(PermissionFlagsBits.KickMembers) ||
      perms.has(PermissionFlagsBits.BanMembers) ||
      perms.has(PermissionFlagsBits.ManageMessages)) {
    return true;
  }

  // Per-guild whitelisted role tiers.
  const crw = (gdb && gdb.commandRoleWhitelist) || {};
  for (const tier of ['admin', 'staff']) {
    if (Array.isArray(crw[tier]) && crw[tier].some(id => member.roles.cache.has(id))) return true;
  }

  // Configured / detected staff-ish roles.
  for (const kind of ['admin', 'mod', 'support']) {
    const rid = resolveRoleId(member.guild, kind, gdb, ID);
    if (rid && member.roles.cache.has(rid)) return true;
  }
  return false;
}

// ── AUTO-DETECT (run when the bot joins a new server) ────────────────────────
async function autoDetect(guild) {
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});
  const roles = {};
  for (const kind of Object.keys(ROLE_NAME_HINTS)) {
    const hints = ROLE_NAME_HINTS[kind];
    const r = guild.roles.cache.find(x => x.name !== '@everyone' && hints.some(h => cleanName(x.name).includes(cleanName(h))));
    if (r) roles[kind] = r.id;
  }
  const channels = {};
  for (const kind of Object.keys(CHANNEL_NAME_HINTS)) {
    const hints = CHANNEL_NAME_HINTS[kind];
    const c = guild.channels.cache.find(x => x.isTextBased?.() && hints.some(h => cleanName(x.name).includes(cleanName(h))));
    if (c) channels[kind] = c.id;
  }
  // Ticket category
  const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && /support|ticket/i.test(c.name));
  const categories = cat ? { tickets: cat.id } : {};
  return { roles, channels, categories, detectedAt: new Date().toISOString() };
}

module.exports = {
  MAIN_GUILD_ID, isMainGuild,
  resolveRole, resolveRoleId, resolveChannelId,
  isStaff, autoDetect,
};
