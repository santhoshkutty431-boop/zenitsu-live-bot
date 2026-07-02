/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║              CASE MANAGEMENT SYSTEM                          ║
 * ║              modules/case-manager.js                         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Provides persistent, structured moderation case tracking with
 * unique case IDs, history, notes, and appeal status.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');

// ─── CASE TYPES ─────────────────────────────────────────────────────────────
const CaseType = Object.freeze({
  BAN:       'BAN',
  TEMPBAN:   'TEMPBAN',
  UNBAN:     'UNBAN',
  KICK:      'KICK',
  TIMEOUT:   'TIMEOUT',
  UNTIMEOUT: 'UNTIMEOUT',
  WARN:      'WARN',
  UNWARN:    'UNWARN',
  MUTE:      'MUTE',
  UNMUTE:    'UNMUTE',
  NOTE:      'NOTE',
  SLOWMODE:  'SLOWMODE',
  LOCK:      'LOCK',
  NICK:      'NICK',
});

// Appeal status values
const AppealStatus = Object.freeze({
  NONE:     'NONE',
  PENDING:  'PENDING',
  APPROVED: 'APPROVED',
  DENIED:   'DENIED',
});

// Case type colors for embeds
const CASE_COLORS = {
  BAN:       0xE74C3C,
  TEMPBAN:   0xC0392B,
  UNBAN:     0x2ECC71,
  KICK:      0xE67E22,
  TIMEOUT:   0xF39C12,
  UNTIMEOUT: 0x27AE60,
  WARN:      0xF1C40F,
  UNWARN:    0x95A5A6,
  MUTE:      0x8E44AD,
  UNMUTE:    0x9B59B6,
  NOTE:      0x3498DB,
  SLOWMODE:  0x1ABC9C,
  LOCK:      0xE74C3C,
  NICK:      0x2980B9,
};

// Case type emojis
const CASE_EMOJIS = {
  BAN:       '🔨',
  TEMPBAN:   '⏱️🔨',
  UNBAN:     '✅',
  KICK:      '🦵',
  TIMEOUT:   '⏸️',
  UNTIMEOUT: '▶️',
  WARN:      '⚠️',
  UNWARN:    '🗑️',
  MUTE:      '🔇',
  UNMUTE:    '🔊',
  NOTE:      '📝',
  SLOWMODE:  '🐢',
  LOCK:      '🔒',
  NICK:      '✏️',
};

// ─── ID GENERATOR ────────────────────────────────────────────────────────────

/**
 * Generate the next sequential case ID string.
 * @param {object} db
 * @returns {string} e.g. "CASE-0042"
 */
function nextCaseId(db) {
  if (!db.caseCounter || typeof db.caseCounter !== 'number') db.caseCounter = 0;
  db.caseCounter += 1;
  return `CASE-${String(db.caseCounter).padStart(4, '0')}`;
}

// ─── DURATION PARSER ────────────────────────────────────────────────────────

/**
 * Parse a human duration string into milliseconds.
 * Accepts: "30s", "5m", "2h", "1d", "1w"
 * Returns null if invalid.
 */
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return n * multipliers[unit];
}

/**
 * Format a millisecond duration into a human-readable string.
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return 'Permanent';
  const s = Math.floor(ms / 1000);
  if (s < 60)         return `${s} second${s !== 1 ? 's' : ''}`;
  const m = Math.floor(s / 60);
  if (m < 60)         return `${m} minute${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m / 60);
  if (h < 24)         return `${h} hour${h !== 1 ? 's' : ''}`;
  const d = Math.floor(h / 24);
  if (d < 7)          return `${d} day${d !== 1 ? 's' : ''}`;
  const w = Math.floor(d / 7);
  return `${w} week${w !== 1 ? 's' : ''}`;
}

// ─── CASE OPERATIONS ─────────────────────────────────────────────────────────

/**
 * Create a new moderation case and persist it to the database.
 *
 * @param {object} db         - The database object
 * @param {function} saveDb   - Save function
 * @param {object} options    - Case fields
 * @returns {object}          - The newly created case
 */
function createCase(db, saveDb, options) {
  if (!Array.isArray(db.cases)) db.cases = [];
  if (!db.caseCounter)         db.caseCounter = 0;

  const {
    type,
    guildId,
    userId,
    userTag,
    modId,
    modTag,
    reason    = 'No reason provided',
    duration  = null,  // ms or null
    notes     = [],
  } = options;

  const caseId   = nextCaseId(db);
  const now      = Date.now();
  const expiresAt = duration ? now + duration : null;

  const caseData = {
    caseId,
    type,
    guildId,
    userId,
    userTag,
    modId,
    modTag,
    reason,
    duration,
    expiresAt,
    timestamp: now,
    active:    true,
    notes:     [...notes],
    appealStatus: AppealStatus.NONE,
  };

  db.cases.push(caseData);
  saveDb();
  return caseData;
}

/**
 * Get a case by its case ID string.
 */
function getCase(db, caseId) {
  if (!Array.isArray(db.cases)) return null;
  return db.cases.find(c => c.caseId === caseId.toUpperCase()) || null;
}

/**
 * Get all cases for a user in a guild, sorted newest first.
 */
function getCasesForUser(db, guildId, userId) {
  if (!Array.isArray(db.cases)) return [];
  return db.cases
    .filter(c => c.guildId === guildId && c.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get the most recent active case of a given type for a user.
 */
function getActiveCaseOfType(db, guildId, userId, type) {
  if (!Array.isArray(db.cases)) return null;
  return db.cases.find(c =>
    c.guildId === guildId &&
    c.userId  === userId  &&
    c.type    === type    &&
    c.active  === true
  ) || null;
}

/**
 * Update fields on an existing case.
 */
function updateCase(db, saveDb, caseId, updates) {
  if (!Array.isArray(db.cases)) return null;
  const idx = db.cases.findIndex(c => c.caseId === caseId.toUpperCase());
  if (idx === -1) return null;
  db.cases[idx] = { ...db.cases[idx], ...updates };
  saveDb();
  return db.cases[idx];
}

/**
 * Add a note to a case.
 */
function addNote(db, saveDb, caseId, note, modTag) {
  const c = getCase(db, caseId);
  if (!c) return null;
  const noteEntry = { text: note, addedBy: modTag, timestamp: Date.now() };
  return updateCase(db, saveDb, caseId, { notes: [...(c.notes || []), noteEntry] });
}

/**
 * Deactivate a case (e.g., when a ban is lifted).
 */
function closeCase(db, saveDb, caseId) {
  return updateCase(db, saveDb, caseId, { active: false });
}

/**
 * Search cases by filter object: { type, modId, userId, guildId, active }
 */
function searchCases(db, filters = {}) {
  if (!Array.isArray(db.cases)) return [];
  return db.cases.filter(c => {
    if (filters.type    && c.type    !== filters.type)    return false;
    if (filters.modId   && c.modId   !== filters.modId)   return false;
    if (filters.userId  && c.userId  !== filters.userId)  return false;
    if (filters.guildId && c.guildId !== filters.guildId) return false;
    if (filters.active  !== undefined && c.active !== filters.active) return false;
    return true;
  }).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get all expired, still-active temp punishments (TEMPBAN, MUTE).
 */
function getExpiredCases(db) {
  if (!Array.isArray(db.cases)) return [];
  const now = Date.now();
  return db.cases.filter(c =>
    c.active &&
    c.expiresAt &&
    c.expiresAt <= now &&
    ['TEMPBAN', 'MUTE'].includes(c.type)
  );
}

// ─── EMBED FORMATTERS ────────────────────────────────────────────────────────

/**
 * Format a case into a Discord embed.
 */
function formatCaseEmbed(caseData) {
  const emoji = CASE_EMOJIS[caseData.type] || '📋';
  const color = CASE_COLORS[caseData.type]  || 0x95A5A6;
  const ts    = Math.floor(caseData.timestamp / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Case ${caseData.caseId} — ${caseData.type}`)
    .setColor(color)
    .addFields(
      { name: '👤 User',       value: `<@${caseData.userId}> (${caseData.userTag})`, inline: true },
      { name: '🛡️ Moderator', value: `<@${caseData.modId}> (${caseData.modTag})`,  inline: true },
      { name: '📅 When',       value: `<t:${ts}:R>`,                                inline: true },
      { name: '📝 Reason',     value: caseData.reason.slice(0, 1024) },
    )
    .setFooter({ text: `Case ID: ${caseData.caseId} | Status: ${caseData.active ? 'Active' : 'Closed'}` })
    .setTimestamp(caseData.timestamp);

  if (caseData.duration) {
    embed.addFields({ name: '⏱️ Duration', value: formatDuration(caseData.duration), inline: true });
  }
  if (caseData.expiresAt) {
    const expTs = Math.floor(caseData.expiresAt / 1000);
    embed.addFields({ name: '⏰ Expires', value: `<t:${expTs}:R>`, inline: true });
  }
  if (caseData.appealStatus && caseData.appealStatus !== AppealStatus.NONE) {
    embed.addFields({ name: '⚖️ Appeal', value: caseData.appealStatus, inline: true });
  }
  if (caseData.notes && caseData.notes.length > 0) {
    const notesStr = caseData.notes
      .slice(-3)
      .map(n => `• **${n.addedBy}:** ${n.text}`)
      .join('\n');
    embed.addFields({ name: `📌 Notes (${caseData.notes.length})`, value: notesStr.slice(0, 1024) });
  }

  return embed;
}

/**
 * Build a summary embed for a user's case list.
 */
function formatUserCasesEmbed(userId, userTag, cases) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 Moderation History — ${userTag}`)
    .setColor(0x2F3136)
    .setFooter({ text: `User ID: ${userId} | Total Cases: ${cases.length}` })
    .setTimestamp();

  if (cases.length === 0) {
    embed.setDescription('✅ No moderation cases found for this user.');
    return embed;
  }

  const lines = cases.slice(0, 15).map(c => {
    const emoji = CASE_EMOJIS[c.type] || '📋';
    const ts    = Math.floor(c.timestamp / 1000);
    const dur   = c.duration ? ` (${formatDuration(c.duration)})` : '';
    const status = c.active ? '' : ' ~~closed~~';
    return `${emoji} \`${c.caseId}\` **${c.type}**${dur} — <t:${ts}:d>${status}\n↳ ${c.reason.slice(0, 80)}`;
  }).join('\n\n');

  embed.setDescription(lines);
  if (cases.length > 15) embed.addFields({ name: '…', value: `+${cases.length - 15} more cases not shown.` });
  return embed;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = {
  CaseType,
  AppealStatus,
  CASE_COLORS,
  CASE_EMOJIS,
  parseDuration,
  formatDuration,
  createCase,
  getCase,
  getCasesForUser,
  getActiveCaseOfType,
  updateCase,
  addNote,
  closeCase,
  searchCases,
  getExpiredCases,
  formatCaseEmbed,
  formatUserCasesEmbed,
};
