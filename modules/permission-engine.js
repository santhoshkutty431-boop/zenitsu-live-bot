const { PermissionFlagsBits } = require('discord.js');

const BOT_DEVELOPERS = (process.env.BOT_DEVELOPERS || process.env.OWNER_ID || '1460908819335876756').split(',').map(s => s.trim());
let dynamicOwnerId = null;

// Emergency Lockdown State (in-memory fallback, synced with DB)
let localEmergencyLock = false;

// Permission Cache
const PERM_CACHE = new Map();
const CACHE_TTL = 30000; // 30 seconds cache TTL

const COMMAND_REGISTRY = {
  // Public
  'help': { tier: 'PUBLIC', capability: null },
  'request-song': { tier: 'PUBLIC', capability: null },
  'queue': { tier: 'PUBLIC', capability: null },
  'report-user': { tier: 'PUBLIC', capability: null },
  'ai': { tier: 'PUBLIC', capability: null },
  'ai-reset': { tier: 'PUBLIC', capability: null },
  'ai-lang': { tier: 'PUBLIC', capability: null },
  'draw': { tier: 'PUBLIC', capability: null },
  'leaderboard': { tier: 'PUBLIC', capability: null },
  'check-bypass': { tier: 'PUBLIC', capability: null },
  'whoami': { tier: 'PUBLIC', capability: null },
  'owner-help': { tier: 'PUBLIC', capability: null },

  // Member
  'rank': { tier: 'MEMBER', capability: null },

  // Staff
  'warn': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'unwarn': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'kick': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'mute': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'unmute': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'timeout': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'untimeout': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'note': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'cases': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'case': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'purge': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'lock': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'unlock': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'nick': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'slowmode': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'protectme': { tier: 'STAFF', capability: 'MODERATION_EXECUTE' },
  'say': { tier: 'STAFF', capability: 'EMBED_MANAGE' },

  // Admin
  'ban': { tier: 'ADMIN', capability: 'MODERATION_EXECUTE' },
  'tempban': { tier: 'ADMIN', capability: 'MODERATION_EXECUTE' },
  'unban': { tier: 'ADMIN', capability: 'MODERATION_EXECUTE' },
  'role': { tier: 'ADMIN', capability: 'ROLE_ASSIGN' },
  'setup-panel': { tier: 'ADMIN', capability: 'TICKET_CONFIG' },
  'embed': { tier: 'ADMIN', capability: 'EMBED_MANAGE' },
  'ai-embed': { tier: 'ADMIN', capability: 'EMBED_MANAGE' },
  'clear-channel': { tier: 'ADMIN', capability: 'EMBED_MANAGE' },
  'security': { tier: 'ADMIN', capability: 'SECURITY_CONFIG' },
  'ai-channel': { tier: 'ADMIN', capability: 'AI_CONFIG' },
  'ai-model': { tier: 'ADMIN', capability: 'AI_CONFIG' },
  'whitelist-role': { tier: 'WHITELISTED_USER', capability: 'ROLE_ASSIGN' },

  // Server Owner
  'whitelist': { tier: 'SERVER_OWNER', capability: null },

  // Bot Developer
  'whitelist-server': { tier: 'BOT_DEVELOPER', capability: null },
  'lockdown': { tier: 'BOT_DEVELOPER', capability: null }
};

function setDynamicOwnerId(id) {
  dynamicOwnerId = id;
}

function isDeveloper(userId) {
  if (BOT_DEVELOPERS.includes(userId)) return true;
  if (dynamicOwnerId && userId === dynamicOwnerId) return true;
  return false;
}

function getCachedPermission(guildId, userId) {
  const key = `${guildId}-${userId}`;
  const entry = PERM_CACHE.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.value;
  }
  PERM_CACHE.delete(key);
  return null;
}

function setCachedPermission(guildId, userId, value) {
  const key = `${guildId}-${userId}`;
  PERM_CACHE.set(key, {
    value,
    expires: Date.now() + CACHE_TTL
  });
}

function invalidatePermCache(guildId, userId) {
  if (guildId && userId) {
    PERM_CACHE.delete(`${guildId}-${userId}`);
  } else if (guildId) {
    for (const key of PERM_CACHE.keys()) {
      if (key.startsWith(`${guildId}-`)) PERM_CACHE.delete(key);
    }
  } else {
    PERM_CACHE.clear();
  }
}

function generateAuditId() {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const random = Math.floor(100000 + Math.random() * 900000);
  return `WL-${year}${month}${day}-${random}`;
}

function verifyPermissionSchema(db, saveDb) {
  if (!db.permissionSchemaVersion || db.permissionSchemaVersion < 2) {
    db.permissionSchemaVersion = 2;
    db.guildWhitelists = db.guildWhitelists || {};
    if (db.roleWhitelist && Array.isArray(db.roleWhitelist)) {
      // Legacy data is kept intact for backward compatibility checks
    }
    saveDb();
  }
}

function resolvePermission(member, cmd, userId, db) {
  // Sync lockdown state from DB
  const isLockdown = db.emergencyLock || localEmergencyLock;

  // 1. Developer bypasses all
  if (isDeveloper(userId)) {
    return { allowed: true, tier: 'BOT_DEVELOPER', reason: 'BYPASS_DEV' };
  }

  // 2. Lockdown check (harmless commands: help, owner-help, whoami bypass)
  if (isLockdown) {
    const harmlessCommands = ['help', 'owner-help', 'whoami'];
    if (!harmlessCommands.includes(cmd)) {
      return {
        allowed: false,
        reason: 'LOCKED',
        message: '⚠️ **Emergency Lockdown Active**: The bot is currently in lockdown. Only Bot Developers can run management commands.'
      };
    }
  }

  // 3. Guild Owner bypasses all server-level checks
  if (member && member.id === member.guild?.ownerId) {
    return { allowed: true, tier: 'SERVER_OWNER', reason: 'BYPASS_OWNER' };
  }

  const reg = COMMAND_REGISTRY[cmd];
  if (!reg) {
    // If not registered, default to STAFF tier
    return evaluateAccess(member, userId, db, 'STAFF', 'MODERATION_EXECUTE');
  }

  const requiredTier = reg.tier;
  const requiredCap = reg.capability;

  // 4. Cache check
  const guildId = member?.guild?.id;
  if (guildId) {
    const cached = getCachedPermission(guildId, userId);
    if (cached && cached.cmd === cmd) {
      return cached.result;
    }
  }

  const result = evaluateAccess(member, userId, db, requiredTier, requiredCap);
  
  if (guildId) {
    setCachedPermission(guildId, userId, { cmd, result });
  }
  
  return result;
}

function evaluateAccess(member, userId, db, requiredTier, requiredCap) {
  const guildId = member?.guild?.id;

  // Retrieve user capability from guildWhitelists
  db.guildWhitelists = db.guildWhitelists || {};
  const guildWhitelist = db.guildWhitelists[guildId] || { users: {}, roles: {} };

  // Determine if user is whitelisted
  let isWhitelistedUser = false;
  let userCaps = [];

  if (guildWhitelist.users && guildWhitelist.users[userId]) {
    isWhitelistedUser = true;
    userCaps = guildWhitelist.users[userId];
  } else if (db.roleWhitelist && db.roleWhitelist.includes(userId)) {
    // Legacy fallback: legacy whitelisted users get ALL capabilities
    isWhitelistedUser = true;
    userCaps = ['AI_CONFIG', 'SECURITY_CONFIG', 'MODERATION_EXECUTE', 'ROLE_ASSIGN', 'EMBED_MANAGE', 'TICKET_CONFIG'];
  }

  // Check if command is BOT_DEVELOPER or SERVER_OWNER
  if (requiredTier === 'SERVER_OWNER') {
    return { allowed: false, requiredTier, reason: 'NEEDS_SERVER_OWNER', message: '❌ Only the **Server Owner** can run this command.' };
  }

  if (requiredTier === 'BOT_DEVELOPER') {
    return { allowed: false, requiredTier, reason: 'NEEDS_BOT_DEVELOPER', message: '❌ Only **Bot Developers** can run this command.' };
  }

  // Whitelisted User Check
  if (isWhitelistedUser) {
    if (!requiredCap || userCaps.includes(requiredCap)) {
      return { allowed: true, tier: 'WHITELISTED_USER', capabilities: userCaps };
    }
  }

  // Whitelisted Roles check
  db.commandRoleWhitelist = db.commandRoleWhitelist || { admin: [], staff: [], member: [] };
  const roleWhitelist = db.commandRoleWhitelist;

  if (member) {
    const hasAdminRole = roleWhitelist.admin && roleWhitelist.admin.some(roleId => member.roles.cache.has(roleId));
    const hasStaffRole = roleWhitelist.staff && roleWhitelist.staff.some(roleId => member.roles.cache.has(roleId));
    const hasMemberRole = roleWhitelist.member && roleWhitelist.member.some(roleId => member.roles.cache.has(roleId));

    const isDiscordAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    // Whitelisted Role checks
    if (requiredTier === 'ADMIN') {
      if (hasAdminRole || isDiscordAdmin) {
        if (!requiredCap) return { allowed: true, tier: 'WHITELISTED_ROLE' };
        if (isWhitelistedUser && userCaps.includes(requiredCap)) {
          return { allowed: true, tier: 'WHITELISTED_USER', capabilities: userCaps };
        }
        return { allowed: false, requiredTier, reason: 'MISSING_CAPABILITY', capability: requiredCap };
      }
    }

    if (requiredTier === 'STAFF') {
      if (hasAdminRole || hasStaffRole || isDiscordAdmin) {
        if (!requiredCap) return { allowed: true, tier: 'WHITELISTED_ROLE' };
        if (isWhitelistedUser && userCaps.includes(requiredCap)) {
          return { allowed: true, tier: 'WHITELISTED_USER', capabilities: userCaps };
        }
        // Staff check fallback
        if (requiredCap === 'MODERATION_EXECUTE') return { allowed: true, tier: 'WHITELISTED_ROLE' };
        return { allowed: false, requiredTier, reason: 'MISSING_CAPABILITY', capability: requiredCap };
      }
    }

    if (requiredTier === 'MEMBER') {
      if (hasAdminRole || hasStaffRole || hasMemberRole || isDiscordAdmin) {
        return { allowed: true, tier: 'WHITELISTED_ROLE' };
      }
    }
  }

  // Public check
  if (requiredTier === 'PUBLIC') {
    return { allowed: true, tier: 'PUBLIC' };
  }

  return { allowed: false, requiredTier, reason: 'DENIED' };
}

module.exports = {
  COMMAND_REGISTRY,
  setDynamicOwnerId,
  isDeveloper,
  resolvePermission,
  invalidatePermCache,
  generateAuditId,
  verifyPermissionSchema
};
