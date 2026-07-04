const { PermissionFlagsBits } = require('discord.js');

class PermissionEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.config = runtime.config.getSystemConfig();

    this.COMMAND_REGISTRY = {
      // Public
      'help': { tier: 'PUBLIC', capability: null },
      'play': { tier: 'PUBLIC', capability: null },
      'nowplaying': { tier: 'PUBLIC', capability: null },
      'play-now': { tier: 'PUBLIC', capability: null },
      'pause': { tier: 'PUBLIC', capability: null },
      'queue': { tier: 'PUBLIC', capability: null },
      'setup-music': { tier: 'ADMIN', capability: 'TICKET_CONFIG' },
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
      'setup-logs': { tier: 'ADMIN', capability: 'SECURITY_CONFIG' },
      'whitelist-role': { tier: 'WHITELISTED_USER', capability: 'ROLE_ASSIGN' },

      // Server Owner
      'whitelist': { tier: 'SERVER_OWNER', capability: null },

      // Bot Developer
      'whitelist-server': { tier: 'BOT_DEVELOPER', capability: null },
      'lockdown': { tier: 'BOT_DEVELOPER', capability: null }
    };

    this.dynamicOwnerId = null;
  }

  async onInit() {
    this.logger.info('Initializing Permission Engine...');
    this.dbService = this.runtime.getService('DatabaseManager');
    this.cacheService = this.runtime.getService('CacheManager');
  }

  setDynamicOwnerId(id) {
    this.dynamicOwnerId = id;
  }

  isDeveloper(userId) {
    if (this.config.developers.includes(userId)) return true;
    if (this.dynamicOwnerId && userId === this.dynamicOwnerId) return true;
    return false;
  }

  generateAuditId() {
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const random = Math.floor(100000 + Math.random() * 900000);
    return `WL-${year}${month}${day}-${random}`;
  }

  resolvePermission(member, cmd, userId) {
    const emergencyLock = this.dbService.get('emergencyLock', false);

    // 1. Developer bypasses all
    if (this.isDeveloper(userId)) {
      return { allowed: true, tier: 'BOT_DEVELOPER', reason: 'BYPASS_DEV' };
    }

    // 2. Lockdown check (harmless commands: help, owner-help, whoami bypass)
    if (emergencyLock) {
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

    const reg = this.COMMAND_REGISTRY[cmd];
    if (!reg) {
      return this.evaluateAccess(member, userId, 'STAFF', 'MODERATION_EXECUTE');
    }

    const requiredTier = reg.tier;
    const requiredCap = reg.capability;

    // 4. Cache check
    const guildId = member?.guild?.id;
    if (guildId && this.cacheService) {
      const cached = this.cacheService.get(`perm-${guildId}-${userId}-${cmd}`);
      if (cached) return cached;
    }

    const result = this.evaluateAccess(member, userId, requiredTier, requiredCap);
    
    if (guildId && this.cacheService) {
      this.cacheService.set(`perm-${guildId}-${userId}-${cmd}`, result, 30000); // cache for 30s
    }
    
    return result;
  }

  evaluateAccess(member, userId, requiredTier, requiredCap) {
    const guildId = member?.guild?.id;

    // Retrieve user capability from guildWhitelists
    const guildWhitelists = this.dbService.get('guildWhitelists') || {};
    const guildWhitelist = guildWhitelists[guildId] || { users: {}, roles: {} };

    let isWhitelistedUser = false;
    let userCaps = [];

    if (guildWhitelist.users && guildWhitelist.users[userId]) {
      isWhitelistedUser = true;
      userCaps = guildWhitelist.users[userId];
    } else {
      const legacyWhitelist = this.dbService.get('roleWhitelist') || [];
      if (legacyWhitelist.includes(userId)) {
        isWhitelistedUser = true;
        userCaps = ['AI_CONFIG', 'SECURITY_CONFIG', 'MODERATION_EXECUTE', 'ROLE_ASSIGN', 'EMBED_MANAGE', 'TICKET_CONFIG'];
      }
    }

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
    const roleWhitelist = this.dbService.get('commandRoleWhitelist') || { admin: [], staff: [], member: [] };
    const roleCapabilities = this.dbService.get('roleCapabilities') || {};

    if (member) {
      const hasAdminRole = roleWhitelist.admin && roleWhitelist.admin.some(roleId => member.roles.cache.has(roleId));
      const hasStaffRole = roleWhitelist.staff && roleWhitelist.staff.some(roleId => member.roles.cache.has(roleId));
      const hasMemberRole = roleWhitelist.member && roleWhitelist.member.some(roleId => member.roles.cache.has(roleId));

      const isDiscordAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

      // Collect capabilities from all roles of the member
      const memberRoleCaps = [];
      member.roles.cache.forEach(role => {
        if (roleCapabilities[role.id]) {
          memberRoleCaps.push(...roleCapabilities[role.id]);
        }
      });

      // Whitelisted Role checks
      if (requiredTier === 'ADMIN') {
        if (hasAdminRole || isDiscordAdmin) {
          if (!requiredCap || memberRoleCaps.includes(requiredCap)) return { allowed: true, tier: 'WHITELISTED_ROLE' };
          if (isWhitelistedUser && userCaps.includes(requiredCap)) {
            return { allowed: true, tier: 'WHITELISTED_USER', capabilities: userCaps };
          }
          return { allowed: false, requiredTier, reason: 'MISSING_CAPABILITY', capability: requiredCap };
        }
      }

      if (requiredTier === 'STAFF') {
        if (hasAdminRole || hasStaffRole || isDiscordAdmin) {
          if (!requiredCap || requiredCap === 'MODERATION_EXECUTE' || memberRoleCaps.includes(requiredCap)) return { allowed: true, tier: 'WHITELISTED_ROLE' };
          if (isWhitelistedUser && userCaps.includes(requiredCap)) {
            return { allowed: true, tier: 'WHITELISTED_USER', capabilities: userCaps };
          }
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
}

module.exports = PermissionEngine;
