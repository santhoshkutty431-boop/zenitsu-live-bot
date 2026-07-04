try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }
} catch (e) {
  console.warn('[FFMPEG] Failed to load static ffmpeg binary:', e.message);
}

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
  AuditLogEvent,
  StringSelectMenuBuilder,
  ActivityType
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { AsyncLocalStorage } = require('async_hooks');

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
const {
  setDynamicOwnerId,
  isDeveloper,
  resolvePermission,
  invalidatePermCache,
  generateAuditId,
  verifyPermissionSchema
} = require('./modules/permission-engine');

const config = require('./config');

// ─── CLIENT SETUP ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.User,
    Partials.Reaction,
  ]
});

// Intercept client.on and client.once to automatically propagate guild context
const asyncLocalStorage = global.asyncLocalStorage || new AsyncLocalStorage();

const originalOn = client.on;
client.on = function(event, listener) {
  return originalOn.call(this, event, (...args) => {
    let guildId = null;
    const firstArg = args[0];
    if (firstArg) {
      if (firstArg.guild) guildId = firstArg.guild.id;
      else if (firstArg.guildId) guildId = firstArg.guildId;
      else if (firstArg.message) guildId = firstArg.message.guild?.id;
    }
    return asyncLocalStorage.run({ guildId }, () => {
      return listener(...args);
    });
  });
};

const originalOnce = client.once;
client.once = function(event, listener) {
  return originalOnce.call(this, event, (...args) => {
    let guildId = null;
    const firstArg = args[0];
    if (firstArg) {
      if (firstArg.guild) guildId = firstArg.guild.id;
      else if (firstArg.guildId) guildId = firstArg.guildId;
      else if (firstArg.message) guildId = firstArg.message.guild?.id;
    }
    return asyncLocalStorage.run({ guildId }, () => {
      return listener(...args);
    });
  });
};

// v4.0 CORE RUNTIME SETUP
const RuntimeClass = require('./src/core/Runtime');
const DatabaseManager = require('./src/managers/DatabaseManager');
const CacheManager = require('./src/managers/CacheManager');
const CommandRouter = require('./src/managers/CommandRouter');
const PermissionEngine = require('./src/managers/PermissionEngine');
const AIProviderManager = require('./src/managers/AIProviderManager');
const SessionManager = require('./src/managers/SessionManager');
const TaskScheduler = require('./src/managers/TaskScheduler');
const HealthMonitor = require('./src/managers/HealthMonitor');
const KnowledgeEngine = require('./src/managers/KnowledgeEngine');
const CognitionEngine = require('./src/managers/CognitionEngine');
const AnalyticsManager = require('./src/managers/AnalyticsManager');
const WorkflowEngine = require('./src/managers/WorkflowEngine');
const SetupWizard = require('./src/core/onboarding/SetupWizard');
const OnboardingScanner = require('./src/core/onboarding/OnboardingScanner');
const SyncListeners = require('./src/core/sync/SyncListeners');
const PluginManager = require('./src/managers/PluginManager');

const runtime = new RuntimeClass();
// Expose runtime for legacy modules that need cross-cutting access
// (e.g. ai-handler telemetry). Prefer explicit injection for new code.
global.__zenitsuRuntime = runtime;
runtime.registerService('DatabaseManager', new DatabaseManager(runtime));
runtime.registerService('CacheManager', new CacheManager(runtime));
runtime.registerService('CommandRouter', new CommandRouter(runtime));
runtime.registerService('PermissionEngine', new PermissionEngine(runtime));
runtime.registerService('AIProviderManager', new AIProviderManager(runtime));
runtime.registerService('SessionManager', new SessionManager(runtime));
runtime.registerService('TaskScheduler', new TaskScheduler(runtime));
const healthMonitor = new HealthMonitor(runtime);
healthMonitor.setDiscordClient(client);
runtime.registerService('HealthMonitor', healthMonitor);
runtime.registerService('KnowledgeEngine', new KnowledgeEngine(runtime));
runtime.registerService('CognitionEngine', new CognitionEngine(runtime));
runtime.registerService('AnalyticsManager', new AnalyticsManager(runtime));
runtime.registerService('WorkflowEngine', new WorkflowEngine(runtime));
runtime.registerService('SetupWizard', new SetupWizard(runtime));
runtime.registerService('OnboardingScanner', new OnboardingScanner(runtime));
runtime.registerService('SyncListeners', new SyncListeners(runtime));
runtime.registerService('PluginManager', new PluginManager(runtime));

// Direct reference to the DatabaseManager's proxied db object.
// (The DatabaseManager itself already provides guild/global auto-routing via
// its own Proxy — no need for a second layer of indirection.)
const db = runtime.getService('DatabaseManager').db;

// Structured logger (Pino) — shared across index.js
const log = runtime.logger;

// Self-ping to keep Render alive
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  log.info(`Self-ping enabled → ${RENDER_URL}`);
  setInterval(() => {
    http.get(RENDER_URL, (res) => {
      log.debug('Self-ping OK', { status: res.statusCode });
    }).on('error', (err) => {
      log.warn('Self-ping failed', { error: err.message });
    });
  }, 14 * 60 * 1000);
}

// ─── KNOWN CHANNEL / ROLE IDS ─────────────────────────────────────────────────
const ID = {
  MEMBER_ROLE:   '1444551212904218705',
  CLIENTS_ROLE:  '1449096942469644480',
  ADMIN_ROLE:    '1521573583766294728',
  MOD_ROLE:      '1521573587859800204',
  SUPPORT_ROLE:  '1521573594251923456',
  OWNER_ROLE:    '1444534470869913752',

  WELCOME:       '1444533393688760411',
  RULES:         '1444538272884981882',
  GENERAL:       '1521944260616781889',
  FEEDBACK:      '1445744625607507980',
  SONG_REQUEST:  '1459521604282486970',
  TICKET_CENTER: '1444538212583473162',
  MOD_REPORTS:   '1444639792846344273',
  BASIC_PANEL:   '1460152526463832097',
  STAFF_CHAT:    '1521940599031333045',

  SERVER_LOGS:   process.env.SERVER_LOGS_ID || '1521577044687847464',
  VOICE_LOG:     process.env.VOICE_LOG_ID   || '1521577051516047573',
  MOD_LOG:       process.env.MOD_LOG_ID     || '1521577060689248519',
  MESSAGE_LOG:   process.env.MESSAGE_LOG_ID || '1521935264426229793',
};

// Event helper imports
const eventHandler = require('./src/handlers/eventHandler');
const commandHandler = require('./src/handlers/commandHandler');

// Resolve helpers
const isOwner = (userId) => userId === client.guilds.cache.first()?.ownerId;
const staffCheck = (member) => member.roles.cache.has(ID.MOD_ROLE) || member.roles.cache.has(ID.ADMIN_ROLE);
const getOrCreateRole = async (guild, name, color) => {
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, color, permissions: [] });
  }
  return role;
};
const logToChannel = async (guild, channelNameOrId, embed) => {
  if (!guild || !channelNameOrId) return;
  
  let channelId = channelNameOrId;
  const isMainServer = guild.id === (process.env.GUILD_ID || '1444533392518680719');

  if (!isMainServer) {
    let targetName = 'server-logs';
    if (channelNameOrId === ID.MESSAGE_LOG || channelNameOrId === 'MESSAGE_LOG') targetName = 'message-log';
    else if (channelNameOrId === ID.VOICE_LOG || channelNameOrId === 'VOICE_LOG') targetName = 'voice-log';
    else if (channelNameOrId === ID.MOD_LOG || channelNameOrId === 'MOD_LOG' || channelNameOrId === ID.MOD_REPORTS || channelNameOrId === 'MOD_REPORTS') targetName = 'mod-log';

    const cleanName = targetName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const foundCh = guild.channels.cache.find(c => {
      const cClean = c.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
      return cClean === cleanName || cClean.includes(cleanName);
    });

    if (foundCh) {
      channelId = foundCh.id;
    } else {
      return; // Do not log if channel is not found on other servers
    }
  } else if (typeof channelNameOrId === 'string' && isNaN(Number(channelNameOrId))) {
    channelId = ID[channelNameOrId.toUpperCase()];
  }
  
  if (!channelId) return;

  try {
    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`Failed to log to channel ${channelNameOrId}:`, err.message);
  }
};

// Bootstrap the runtime
runtime.client = client;
runtime.bootstrap().then(() => {
  client.runtime = runtime;
  log.info('ZENITSU LIVE v4.0 Runtime Bootstrapped.');

  // Bind events and command handlers
  eventHandler.registerEvents(
    client, runtime, db, ID, logToChannel, isDeveloper, resolvePermission, staffCheck, isOwner, getOrCreateRole, secHandleJoin, handleMessageSecurity
  );

  client.on('interactionCreate', async interaction => {
    try {
      await commandHandler.handleInteraction(
        interaction, runtime, db, ID, logToChannel, isDeveloper, resolvePermission, client, staffCheck, isOwner, getOrCreateRole
      );
    } catch (err) {
      log.error('Interaction handler error', { error: err.message, stack: err.stack });
    }
  });

  // Start the dashboard web server immediately on startup
  try {
    startDashboardServer(client, db, () => runtime.getService('DatabaseManager').saveGlobal());
  } catch (err) {
    log.error('Failed to start dashboard server', { error: err.message });
  }

  client.once('clientReady', async () => {
    log.info(`Bot logged in as ${client.user.tag}`);

    // Seed semantic spam defaults (idempotent, safe to call every boot).
    try {
      const semanticSpam = require('./modules/semantic-spam');
      await semanticSpam.seedDefaults({
        dbService: runtime.getService('DatabaseManager'),
        logger: log
      });
    } catch (err) {
      log.warn('Semantic spam seed failed', { error: err.message });
    }

    // Register live synchronization event listeners
    const syncListeners = runtime.getService('SyncListeners');
    if (syncListeners) {
      syncListeners.register(client);
    }

    startAutoPunishScheduler(client, db, () => runtime.getService('DatabaseManager').saveGlobal(), logToChannel, ID);
    
    // Initialize active polls manager
    try {
      const { initPolls } = require('./modules/poll-manager');
      await initPolls(client, runtime);
    } catch (err) {
      log.error('Failed to initialize active polls', { error: err.message });
    }

    // Set dynamic owner ID
    try {
      const app = await client.application.fetch();
      setDynamicOwnerId(app.owner.id);
    } catch (e) {
      log.error('Failed to fetch application owner ID', { error: e.message });
    }
  });

  // Connect to Discord
  client.login(config.token).catch(err => {
    log.error('Discord client login failed', { error: err.message });
  });
}).catch(err => {
  // Runtime not yet available — fall back to console
  console.error('[RUNTIME BOOTSTRAP ERROR]', err);
});
