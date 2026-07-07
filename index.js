try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }
} catch (e) {
  console.warn('[FFMPEG] Failed to load static ffmpeg binary:', e.message);
}

// Trigger Redeploy: 2026-07-05 17:21
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

// Intercept client.on and client.once to automatically propagate guild context.
//
// CRITICAL: the store MUST be resolved at EMIT time, not at file-load time.
// DatabaseManager (required further down) creates the canonical
// AsyncLocalStorage instance and assigns it to global.asyncLocalStorage.
// If we captured `global.asyncLocalStorage || new AsyncLocalStorage()` here,
// we'd capture our own orphan instance (DatabaseManager isn't loaded yet),
// and every event's guildId would be written to a store the DB proxy never
// reads — silently routing ALL guild data to global config. That exact bug
// broke XP/cases/whitelists after the SQLite migration.
const extractGuildId = (args) => {
  const firstArg = args[0];
  if (!firstArg) return null;
  if (firstArg.guild) return firstArg.guild.id;
  if (firstArg.guildId) return firstArg.guildId;
  if (firstArg.message) return firstArg.message.guild?.id ?? null;
  return null;
};

const runInGuildContext = (args, listener) => {
  const store = global.asyncLocalStorage; // canonical instance from DatabaseManager
  if (!store) return listener(...args);
  return store.run({ guildId: extractGuildId(args) }, () => listener(...args));
};

const originalOn = client.on;
client.on = function(event, listener) {
  return originalOn.call(this, event, (...args) => runInGuildContext(args, listener));
};

const originalOnce = client.once;
client.once = function(event, listener) {
  return originalOnce.call(this, event, (...args) => runInGuildContext(args, listener));
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

  SERVER_LOGS:   process.env.SERVER_LOGS_ID || '1523333922245705860',
  VOICE_LOG:     process.env.VOICE_LOG_ID   || '1521577051516047573',
  MOD_LOG:       process.env.MOD_LOG_ID     || '1523332003183984880',
  MESSAGE_LOG:   process.env.MESSAGE_LOG_ID || '1523332061425963031',
};

// Event helper imports
const eventHandler = require('./src/handlers/eventHandler');
const commandHandler = require('./src/handlers/commandHandler');

// Resolve helpers
const isOwner = (userId) => userId === client.guilds.cache.first()?.ownerId;
// Multi-server staff detection: Discord permissions + per-guild configured
// roles + main-server hardcoded roles. Works on ANY server.
const guildConfig = require('./modules/guild-config');
const staffCheck = (member) => {
  if (!member) return false;
  let gdb = null;
  try { gdb = runtime.getService('DatabaseManager').getGuildDb(member.guild.id); } catch { /* ignore */ }
  return guildConfig.isStaff(member, gdb, ID);
};
const getOrCreateRole = async (guild, name, color) => {
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, color, permissions: [] });
  }
  return role;
};
// Channel resolution honours THREE sources, in priority order:
//   1. db.logging.<xLogId>  — set per-guild via /setup-logs
//   2. ID map / env vars    — bot-wide default
//   3. name-based lookup    — for guilds that never ran /setup-logs and
//                             don't match the main-server env vars
const LOG_KIND_TO_DB_KEY = {
  MESSAGE_LOG: 'messageLogId',
  VOICE_LOG:   'voiceLogId',
  MOD_LOG:     'modLogId',
  MOD_REPORTS: 'modLogId',   // reports are moderator escalations
  SERVER_LOGS: 'serverLogsId'
};
const LOG_KIND_TO_CHANNEL_NAME = {
  MESSAGE_LOG: 'message-log',
  VOICE_LOG:   'voice-log',
  MOD_LOG:     'mod-log',
  MOD_REPORTS: 'mod-log',
  SERVER_LOGS: 'server-logs'
};

function resolveLogKind(nameOrId, ID) {
  // If caller passed a NAME string ('MOD_LOG'), that IS the kind.
  if (typeof nameOrId === 'string' && !/^\d+$/.test(nameOrId)) {
    return nameOrId.toUpperCase();
  }
  // If caller passed a numeric channel ID that matches one of the ID constants,
  // work backwards to the kind so we can still consult db.logging.
  for (const [kind, id] of Object.entries(ID)) {
    if (id && id === nameOrId && LOG_KIND_TO_DB_KEY[kind]) return kind;
  }
  return null;
}

const logToChannel = async (guild, channelNameOrId, embed) => {
  if (!guild || !channelNameOrId) return;

  const kind = resolveLogKind(channelNameOrId, ID);

  // Gather candidate channel IDs in priority order.
  const candidateIds = [];
  if (kind) {
    try {
      const gdb = runtime.getService('DatabaseManager').getGuildDb(guild.id);
      const configured = gdb?.logging?.[LOG_KIND_TO_DB_KEY[kind]];
      if (configured) candidateIds.push(configured);
    } catch { /* db not ready */ }
    if (ID[kind]) candidateIds.push(ID[kind]); // env/default map, all servers
  }
  if (!kind && typeof channelNameOrId === 'string' && /^\d+$/.test(channelNameOrId)) {
    candidateIds.push(channelNameOrId); // raw ID passed directly
  }

  // Try each candidate. A deleted+recreated channel makes its old ID resolve
  // to null here, which drops us into the self-healing name lookup below.
  let channel = null;
  for (const id of candidateIds) {
    if (!id) continue;
    channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (channel && channel.isTextBased?.()) break;
    channel = null;
  }

  // ── SELF-HEALING NAME FALLBACK (universal — main server included) ──────────
  // Runs whenever no configured ID resolves, e.g. the admin deleted and
  // recreated the log channel (new ID). Force a full channel fetch so the
  // freshly-created channel is in cache, then match by conventional name.
  if (!channel && kind && LOG_KIND_TO_CHANNEL_NAME[kind]) {
    await guild.channels.fetch().catch(() => {});
    const cleanName = LOG_KIND_TO_CHANNEL_NAME[kind].toLowerCase().replace(/[^a-z0-9-]/g, '');
    channel = guild.channels.cache.find(c => {
      if (!c?.isTextBased?.()) return false;
      const cClean = c.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
      return cClean === cleanName || cClean.includes(cleanName);
    }) || null;

    // Persist the rediscovered ID so future logs skip the fetch (immediate
    // flush so it survives a restart).
    if (channel) {
      try {
        const dbMgr = runtime.getService('DatabaseManager');
        const gdb = dbMgr.getGuildDb(guild.id);
        gdb.logging = gdb.logging || {};
        gdb.logging[LOG_KIND_TO_DB_KEY[kind]] = channel.id;
        dbMgr.saveGuildDb(guild.id, true);
      } catch { /* best effort */ }
    }
  }

  if (!channel || !channel.isTextBased?.()) return;
  try {
    await channel.send({ embeds: [embed] });
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
    // ── GLOBAL INTERACTION WATCHDOG ────────────────────────────────────────
    // Every slash command / button / select flows through here. If ANY
    // handler defers the reply and then hangs (provider stall, deadlock,
    // future bug), the user would otherwise sit on "Sentinel Security is
    // thinking..." until Discord's 15-minute cutoff. This watchdog
    // guarantees a visible answer within 30 seconds no matter what.
    const watchdog = setTimeout(() => {
      if (interaction.deferred && !interaction.replied) {
        const cmdName = interaction.commandName || interaction.customId || 'interaction';
        log.error(`Watchdog: handler for "${cmdName}" hung >30s — replying with timeout notice`, {
          user: interaction.user?.id, guild: interaction.guildId
        });
        interaction.editReply({
          content: '⏳ This took too long and timed out. Please try again — if it keeps happening, contact staff.'
        }).catch(() => {});
      }
    }, 30_000);

    global.asyncLocalStorage.run({ guildId: interaction.guildId }, async () => {
      try {
        await commandHandler.handleInteraction(
          interaction, runtime, db, ID, logToChannel, isDeveloper, resolvePermission, client, staffCheck, isOwner, getOrCreateRole
        );
      } catch (err) {
        log.error('Interaction handler error', { error: err.message, stack: err.stack });
        try {
          if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `❌ Something went wrong: ${err.message}` }).catch(() => {});
          } else if (!interaction.replied && typeof interaction.reply === 'function' && interaction.isRepliable?.()) {
            await interaction.reply({ content: `❌ Something went wrong: ${err.message}`, ephemeral: true }).catch(() => {});
          }
        } catch { /* interaction already dead */ }
      } finally {
        clearTimeout(watchdog);
      }
    });
  });

  // Start the dashboard web server immediately on startup
  try {
    startDashboardServer(client, db, () => {
      const store = global.asyncLocalStorage?.getStore();
      const guildId = store?.guildId;
      const dbMgr = runtime.getService('DatabaseManager');
      dbMgr.saveGlobal();
      if (guildId) {
        dbMgr.saveGuildDb(guildId);
      }
    });
  } catch (err) {
    log.error('Failed to start dashboard server', { error: err.message });
  }

  client.once('clientReady', async () => {
    log.info(`Bot logged in as ${client.user.tag}`);

    // Trigger pruning of all historical DMs sent by the bot asynchronously on startup
    const { pruneAllHistoricalDms } = require('./modules/dm-manager');
    pruneAllHistoricalDms(client).catch(err => {
      log.error('Failed to run startup DM pruning:', { error: err.message });
    });

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
  const isKoyeb = !!(process.env.KOYEB || process.env.KOYEB_APP_NAME || process.env.KOYEB_SERVICE_NAME);
  const isRender = !!process.env.RENDER;
  const isPrimary = process.env.IS_PRIMARY_INSTANCE === 'true';
  const renderServiceId = process.env.RENDER_SERVICE_ID;
  const isCorrectRenderService = !isRender || (renderServiceId === 'srv-d920leegvqtc73935vgg');
  
  const shouldSkipLogin = process.env.SPACE_ID || isKoyeb || (isRender && !isPrimary) || !isCorrectRenderService;

  if (shouldSkipLogin) {
    log.info('🤖 Skipping Discord Bot login to prevent duplicate instances (Running on non-primary/duplicate instance, Koyeb, or HF Space).');
  } else {
    client.login(config.token).catch(err => {
      log.error('Discord client login failed', { error: err.message });
    });
  }
}).catch(err => {
  // Runtime not yet available — fall back to console
  console.error('[RUNTIME BOOTSTRAP ERROR]', err);
});
