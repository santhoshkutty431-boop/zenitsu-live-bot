/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   DEV-AI — Natural-language server agent (owner + whitelist)   ║
 * ║   modules/dev-ai.js                                            ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Give a plain-English prompt; the LLM turns it into a structured plan of
 * concrete Discord actions, which are then executed. Destructive actions
 * (ban/kick/delete/purge/timeout) require a confirm button first.
 *
 * Access is gated by the caller (commandHandler): server owner or a user the
 * owner whitelisted with the AI_EXECUTE capability. This module assumes the
 * caller already passed that check.
 */

'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits
} = require('discord.js');

// ── TOOL CATALOG ─────────────────────────────────────────────────────────────
// Each tool: params it needs + whether it's destructive (needs confirmation).
const TOOLS = {
  post_message:    { destructive: false, params: 'channel, text',            desc: 'Send a message/announcement to a channel' },
  set_slowmode:    { destructive: false, params: 'channel, seconds',         desc: 'Set slowmode (0-21600s) on a channel' },
  lock_channel:    { destructive: false, params: 'channel',                  desc: 'Prevent @everyone from sending in a channel' },
  unlock_channel:  { destructive: false, params: 'channel',                  desc: 'Restore @everyone send in a channel' },
  restrict_channel:{ destructive: false, params: 'channel, mode',            desc: 'mode = media_only | text_only | read_only | normal' },
  set_permission:  { destructive: false, params: 'target, role, permissions, allow', desc: 'Grant/deny permissions for a role on a channel OR category. target = channel or category name. permissions = comma list of: view, send, attach, react, connect, speak, manage, mention. allow = true|false' },
  create_channel:  { destructive: false, params: 'name, type',              desc: 'Create a text or voice channel (type=text|voice)' },
  rename_channel:  { destructive: false, params: 'channel, name',            desc: 'Rename a channel' },
  create_role:     { destructive: false, params: 'name, color',             desc: 'Create a role (color = hex like #FF0000 or name)' },
  assign_role:     { destructive: false, params: 'user, role',              desc: 'Give a role to a member' },
  remove_role:     { destructive: false, params: 'user, role',              desc: 'Remove a role from a member' },
  warn:            { destructive: false, params: 'user, reason',            desc: 'Warn a member (logs a case)' },
  // Destructive — require confirmation
  delete_channel:  { destructive: true,  params: 'channel',                  desc: 'Delete a channel permanently' },
  purge:           { destructive: true,  params: 'channel, count',           desc: 'Bulk-delete recent messages (1-100)' },
  timeout:         { destructive: true,  params: 'user, minutes, reason',    desc: 'Timeout (mute) a member for N minutes' },
  kick:            { destructive: true,  params: 'user, reason',             desc: 'Kick a member' },
  ban:             { destructive: true,  params: 'user, reason',             desc: 'Ban a member' },
};

function buildSystemPrompt() {
  const lines = Object.entries(TOOLS).map(([name, t]) => `  - ${name}(${t.params}) — ${t.desc}`);
  return (
    'You are DEV-AI, a Discord server automation planner. Convert the user request into a JSON plan of concrete actions.\n\n' +
    'AVAILABLE TOOLS:\n' + lines.join('\n') + '\n\n' +
    'RULES:\n' +
    '1. Respond with ONLY valid JSON, no prose, no markdown fences.\n' +
    '2. Shape: {"actions":[{"tool":"<name>","params":{...}}],"summary":"<one short human sentence>"}\n' +
    '3. Use the EXACT channel/role/user text the user gave (names or mentions or IDs) in params; do not invent IDs.\n' +
    '4. If the request maps to no available tool, return {"actions":[],"summary":"<why you cannot do it>"}.\n' +
    '5. Prefer the smallest set of actions that satisfies the request. Multiple actions are allowed.\n'
  );
}

// ── RESOLUTION HELPERS ───────────────────────────────────────────────────────
function cleanId(str) {
  const m = String(str || '').match(/(\d{15,25})/);
  return m ? m[1] : null;
}

async function resolveChannel(guild, ref, includeCategories = true) {
  if (!ref) return null;
  const id = cleanId(ref);
  if (id) {
    const byId = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (byId) return byId;
  }
  // Strip common noise words so "announcement channel in client category" still
  // resolves the intended target name.
  let name = String(ref).replace(/[#<>]/g, '').toLowerCase()
    .replace(/\b(channel|category|the|in|to|role)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  await guild.channels.fetch().catch(() => {});
  const pool = includeCategories
    ? guild.channels.cache
    : guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory);
  return pool.find(c => c.name.toLowerCase() === name)
      || pool.find(c => c.name.toLowerCase().includes(name))
      || (name.split(' ')[0] && pool.find(c => c.name.toLowerCase().includes(name.split(' ')[0])))
      || null;
}

async function resolveMember(guild, ref) {
  if (!ref) return null;
  const id = cleanId(ref);
  if (id) {
    const m = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (m) return m;
  }
  const name = String(ref).replace(/[@<>]/g, '').toLowerCase().trim();
  await guild.members.fetch().catch(() => {});
  return guild.members.cache.find(m => m.user.username.toLowerCase() === name || m.displayName.toLowerCase() === name)
      || guild.members.cache.find(m => m.user.username.toLowerCase().includes(name))
      || null;
}

async function resolveRole(guild, ref) {
  if (!ref) return null;
  const id = cleanId(ref);
  if (id) {
    const r = guild.roles.cache.get(id);
    if (r) return r;
  }
  const name = String(ref).replace(/[@<>&]/g, '').toLowerCase().trim();
  await guild.roles.fetch().catch(() => {});
  return guild.roles.cache.find(r => r.name.toLowerCase() === name)
      || guild.roles.cache.find(r => r.name.toLowerCase().includes(name))
      || null;
}

const COLORS = { red:0xE74C3C, blue:0x3498DB, green:0x2ECC71, yellow:0xF1C40F, purple:0x9B59B6, orange:0xE67E22, pink:0xFFB7C5, cyan:0x00D4FF, black:0x000001, white:0xFFFFFF, gold:0xEDC231 };
function parseColor(c) {
  if (!c) return 0x2ECC71;
  const s = String(c).toLowerCase().trim();
  if (COLORS[s] !== undefined) return COLORS[s];
  const hex = s.replace('#', '');
  const n = parseInt(hex, 16);
  return Number.isNaN(n) ? 0x2ECC71 : n;
}

// ── PLANNING ─────────────────────────────────────────────────────────────────
async function planActions(runtime, userId, prompt) {
  const ai = runtime.getService('AIProviderManager');
  // The prompt MUST be passed as a user message — query() ignores its `prompt`
  // arg and only sends `messages` to the model.
  const res = await ai.query(userId, prompt, undefined, buildSystemPrompt(), [
    { role: 'user', content: prompt }
  ]);
  if (res.error) return { error: res.message || 'AI planner failed.' };
  let text = (res.response || '').trim();
  // Strip accidental code fences
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  // Grab the first {...} block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return { error: 'AI did not return a valid plan.' };
  try {
    const plan = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(plan.actions)) plan.actions = [];
    return { plan };
  } catch (e) {
    return { error: `Could not parse the AI plan: ${e.message}` };
  }
}

// ── EXECUTION ────────────────────────────────────────────────────────────────
async function executeAction(guild, action, ctx) {
  const p = action.params || {};
  switch (action.tool) {
    case 'post_message': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch?.isTextBased?.()) throw new Error(`channel "${p.channel}" not found`);
      await ch.send({ content: String(p.text || '').slice(0, 2000) });
      return `Posted to #${ch.name}`;
    }
    case 'set_slowmode': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      const s = Math.max(0, Math.min(21600, parseInt(p.seconds, 10) || 0));
      await ch.setRateLimitPerUser(s);
      return `Slowmode on #${ch.name} → ${s}s`;
    }
    case 'lock_channel': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      return `Locked #${ch.name}`;
    }
    case 'unlock_channel': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      return `Unlocked #${ch.name}`;
    }
    case 'restrict_channel': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      const mode = String(p.mode || 'normal').toLowerCase();
      const map = {
        media_only: { SendMessages: true,  AttachFiles: true,  EmbedLinks: false, AddReactions: true },
        text_only:  { SendMessages: true,  AttachFiles: false, EmbedLinks: false },
        read_only:  { SendMessages: false, AttachFiles: false, AddReactions: false },
        normal:     { SendMessages: null,  AttachFiles: null,  EmbedLinks: null,  AddReactions: null },
      };
      await ch.permissionOverwrites.edit(guild.roles.everyone, map[mode] || map.normal);
      return `#${ch.name} → ${mode}`;
    }
    case 'set_permission': {
      const ch = await resolveChannel(guild, p.target);
      if (!ch) throw new Error(`channel/category "${p.target}" not found`);
      const role = await resolveRole(guild, p.role);
      if (!role) throw new Error(`role "${p.role}" not found`);
      // Map friendly permission words to Discord flags.
      const FLAG = {
        view: 'ViewChannel', see: 'ViewChannel', read: 'ViewChannel',
        send: 'SendMessages', write: 'SendMessages', message: 'SendMessages', msg: 'SendMessages',
        attach: 'AttachFiles', upload: 'AttachFiles', photo: 'AttachFiles', file: 'AttachFiles',
        react: 'AddReactions', reaction: 'AddReactions',
        connect: 'Connect', join: 'Connect',
        speak: 'Speak', talk: 'Speak',
        manage: 'ManageChannels',
        mention: 'MentionEveryone',
        embed: 'EmbedLinks', link: 'EmbedLinks',
      };
      const allow = !(String(p.allow).toLowerCase() === 'false' || p.allow === false);
      const perms = String(p.permissions || 'view').split(/[,\s]+/).filter(Boolean);
      const edit = {};
      const applied = [];
      for (const word of perms) {
        const flag = FLAG[word.toLowerCase()];
        if (flag) { edit[flag] = allow; applied.push(flag); }
      }
      if (!applied.length) throw new Error(`no recognizable permissions in "${p.permissions}"`);
      await ch.permissionOverwrites.edit(role, edit);
      const label = ch.type === ChannelType.GuildCategory ? `category "${ch.name}"` : `#${ch.name}`;
      return `${allow ? 'Granted' : 'Denied'} ${applied.join(', ')} for @${role.name} on ${label}`;
    }
    case 'create_channel': {
      const type = /voice/i.test(p.type) ? ChannelType.GuildVoice : ChannelType.GuildText;
      const ch = await guild.channels.create({ name: String(p.name || 'new-channel').slice(0, 90), type });
      return `Created ${type === ChannelType.GuildVoice ? '🔊' : '#'}${ch.name}`;
    }
    case 'rename_channel': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      const old = ch.name;
      await ch.setName(String(p.name || old).slice(0, 90));
      return `Renamed #${old} → #${ch.name}`;
    }
    case 'create_role': {
      const role = await guild.roles.create({ name: String(p.name || 'new-role').slice(0, 90), color: parseColor(p.color) });
      return `Created role @${role.name}`;
    }
    case 'assign_role': {
      const m = await resolveMember(guild, p.user); const r = await resolveRole(guild, p.role);
      if (!m) throw new Error(`user "${p.user}" not found`); if (!r) throw new Error(`role "${p.role}" not found`);
      await m.roles.add(r);
      return `Gave @${r.name} to ${m.user.username}`;
    }
    case 'remove_role': {
      const m = await resolveMember(guild, p.user); const r = await resolveRole(guild, p.role);
      if (!m) throw new Error(`user "${p.user}" not found`); if (!r) throw new Error(`role "${p.role}" not found`);
      await m.roles.remove(r);
      return `Removed @${r.name} from ${m.user.username}`;
    }
    case 'warn': {
      const m = await resolveMember(guild, p.user);
      if (!m) throw new Error(`user "${p.user}" not found`);
      const { createCase, CaseType } = require('./case-manager');
      createCase(ctx.db, ctx.saveDb, { type: CaseType.WARN, guildId: guild.id, userId: m.id, userTag: m.user.tag, modId: ctx.actorId, modTag: ctx.actorTag, reason: p.reason || 'No reason' });
      await m.send(`⚠️ You were warned in **${guild.name}**: ${p.reason || 'No reason'}`).catch(() => {});
      return `Warned ${m.user.username}`;
    }
    case 'delete_channel': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch) throw new Error(`channel "${p.channel}" not found`);
      const n = ch.name; await ch.delete('DEV-AI');
      return `Deleted #${n}`;
    }
    case 'purge': {
      const ch = await resolveChannel(guild, p.channel);
      if (!ch?.isTextBased?.()) throw new Error(`channel "${p.channel}" not found`);
      const n = Math.max(1, Math.min(100, parseInt(p.count, 10) || 50));
      const del = await ch.bulkDelete(n, true);
      return `Purged ${del.size} messages in #${ch.name}`;
    }
    case 'timeout': {
      const m = await resolveMember(guild, p.user);
      if (!m) throw new Error(`user "${p.user}" not found`);
      const mins = Math.max(1, Math.min(40320, parseInt(p.minutes, 10) || 10));
      await m.timeout(mins * 60000, p.reason || 'DEV-AI');
      return `Timed out ${m.user.username} for ${mins}m`;
    }
    case 'kick': {
      const m = await resolveMember(guild, p.user);
      if (!m) throw new Error(`user "${p.user}" not found`);
      if (!m.kickable) throw new Error(`cannot kick ${m.user.username} (role hierarchy)`);
      const u = m.user.username; await m.kick(p.reason || 'DEV-AI');
      return `Kicked ${u}`;
    }
    case 'ban': {
      const m = await resolveMember(guild, p.user);
      const target = m ? m.id : cleanId(p.user);
      if (!target) throw new Error(`user "${p.user}" not found`);
      await guild.members.ban(target, { reason: p.reason || 'DEV-AI' });
      return `Banned ${m ? m.user.username : target}`;
    }
    default:
      throw new Error(`unknown tool "${action.tool}"`);
  }
}

function planIsDestructive(plan) {
  return plan.actions.some(a => TOOLS[a.tool]?.destructive);
}

function summarizePlan(plan) {
  return plan.actions.map((a, i) => {
    const d = TOOLS[a.tool]?.destructive ? '⚠️ ' : '• ';
    const params = Object.entries(a.params || {}).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(', ');
    return `${d}\`${a.tool}\` — ${params || '(no params)'}`;
  }).join('\n');
}

module.exports = { TOOLS, planActions, executeAction, planIsDestructive, summarizePlan, buildSystemPrompt };
