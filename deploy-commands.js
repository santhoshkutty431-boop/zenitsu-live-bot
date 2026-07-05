const {
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Zenitsu bot commands and permission tiers'),

  new SlashCommandBuilder()
    .setName('debug-bot')
    .setDescription('Exposes live bot status for diagnostics and checks'),

  new SlashCommandBuilder()
    .setName('setup-panel')
    .setDescription('Deploys the basic panel interface to the configured channel'),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Plays a song or playlist from a name or URL')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('Name or link of the song to request')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Shows the track currently playing'),

  new SlashCommandBuilder()
    .setName('play-now')
    .setDescription('Immediately plays a track and interrupts the current one')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('Name or link of the song to request')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pauses or resumes the current track'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the current song requests queue'),

  new SlashCommandBuilder()
    .setName('setup-music')
    .setDescription('Creates the setup channel for music controls and status'),

  new SlashCommandBuilder()
    .setName('protectme')
    .setDescription('Toggle or configure auto-moderation settings')
    .addBooleanOption(option =>
      option.setName('active')
        .setDescription('Enable or disable anti-spam/link protection')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('check-bypass')
    .setDescription('Check or register bypass status for a UID and obtain the Bypassed role')
    .addStringOption(option =>
      option.setName('uid')
        .setDescription('The Game UID to register')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('report-user')
    .setDescription('Submit a user report to the staff')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user you are reporting')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the report')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member (Timeout and assign Muted role)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to mute')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Mute duration in minutes (default: 10)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the mute')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a member (Remove timeout and Muted role)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to unmute')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel (Deny Send Messages overwrite for @everyone)')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to lock (defaults to current)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel (Restore Send Messages overwrite for @everyone)')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to unlock (defaults to current)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage user roles')
    .addSubcommand(subcommand =>
      subcommand.setName('add')
        .setDescription('Give a role to a member')
        .addUserOption(option => option.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to add').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand.setName('remove')
        .setDescription('Remove a role from a member')
        .addUserOption(option => option.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to remove').setRequired(true))),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your XP rank or another member\'s rank')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to check (leave empty for yourself)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top 10 most active members by XP'),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a plain text message through the bot')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send the message to')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message content')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('📢 Send a professional embed announcement (supports fields, buttons, images, mentions)')
    // ─ Required ─
    .addChannelOption(o => o.setName('channel').setDescription('Channel to send the embed to').setRequired(true))
    // ─ Core Content ─
    .addStringOption(o => o.setName('title').setDescription('Embed title (max 256 chars)').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Main body text — supports **bold**, *italic*, > quotes, bullet lists (max 4096)').setRequired(false))
    .addStringOption(o => o.setName('color').setDescription('Color: hex (#FF0000) or name: red, blue, gold, cyan, zenitsu, green, purple…').setRequired(false))
    // ─ Media ─
    .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail image URL (top-right corner)').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Large banner image URL (bottom of embed)').setRequired(false))
    // ─ Author ─
    .addStringOption(o => o.setName('author_name').setDescription('Author name shown above the title').setRequired(false))
    .addStringOption(o => o.setName('author_icon').setDescription('Author icon URL (shown left of author name)').setRequired(false))
    // ─ Footer ─
    .addStringOption(o => o.setName('footer_text').setDescription('Footer text at the bottom of the embed').setRequired(false))
    .addStringOption(o => o.setName('footer_icon').setDescription('Footer icon URL (shown left of footer text)').setRequired(false))
    // ─ Extras ─
    .addBooleanOption(o => o.setName('timestamp').setDescription('Add current timestamp to the embed?').setRequired(false))
    .addStringOption(o => o.setName('mention').setDescription('Mention before embed: @everyone, @here, or a Role ID').setRequired(false))
    // ─ Field 1 ─
    .addStringOption(o => o.setName('field1_name').setDescription('Field 1: Name/header').setRequired(false))
    .addStringOption(o => o.setName('field1_value').setDescription('Field 1: Content').setRequired(false))
    .addBooleanOption(o => o.setName('field1_inline').setDescription('Field 1: Display inline?').setRequired(false))
    // ─ Field 2 ─
    .addStringOption(o => o.setName('field2_name').setDescription('Field 2: Name/header').setRequired(false))
    .addStringOption(o => o.setName('field2_value').setDescription('Field 2: Content').setRequired(false))
    .addBooleanOption(o => o.setName('field2_inline').setDescription('Field 2: Display inline?').setRequired(false))
    // ─ Field 3 ─
    .addStringOption(o => o.setName('field3_name').setDescription('Field 3: Name/header').setRequired(false))
    .addStringOption(o => o.setName('field3_value').setDescription('Field 3: Content').setRequired(false))
    .addBooleanOption(o => o.setName('field3_inline').setDescription('Field 3: Display inline?').setRequired(false))
    // ─ Button 1 ─
    .addStringOption(o => o.setName('button1_label').setDescription('Button 1: Label text').setRequired(false))
    .addStringOption(o => o.setName('button1_url').setDescription('Button 1: URL link').setRequired(false))
    // ─ Button 2 ─
    .addStringOption(o => o.setName('button2_label').setDescription('Button 2: Label text').setRequired(false))
    .addStringOption(o => o.setName('button2_url').setDescription('Button 2: URL link').setRequired(false)),

  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage the whitelisted users and their capabilities')
    .addSubcommand(subcommand =>
      subcommand.setName('add')
        .setDescription('Add a user to the whitelist with optional capabilities')
        .addUserOption(option => option.setName('user').setDescription('The user to whitelist').setRequired(true))
        .addStringOption(option => option.setName('capabilities').setDescription('Comma-separated list: AI_CONFIG, SECURITY_CONFIG, ROLE_ASSIGN, MODERATION_EXECUTE, etc.').setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand.setName('remove')
        .setDescription('Remove a user from the whitelist')
        .addUserOption(option => option.setName('user').setDescription('The user to remove').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand.setName('list')
        .setDescription('List all whitelisted users')),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and log the warning')
    .addUserOption(option => option.setName('user').setDescription('The member to warn').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(option => option.setName('user').setDescription('The member to kick').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the kick').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the ban').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .addStringOption(option => option.setName('user_id').setDescription('The Discord user ID to unban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the unban').setRequired(false)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete recent messages in a channel (max 100, messages under 14 days)')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete (1-100, default: 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('clear-channel')
    .setDescription('Clear ALL messages in a channel by cloning it (works on old messages too)')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to clear (defaults to current channel)')
        .setRequired(false)),

  // ══════════════════════════════════════════════════════════════════════════
  //  ENTERPRISE MODERATION COMMANDS
  // ══════════════════════════════════════════════════════════════════════════

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Temporarily timeout a member (they cannot send messages or join VC)')
    .addUserOption(o => o.setName('user').setDescription('The member to timeout').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration: 60s, 5m, 2h, 1d, 1w (max 28d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the timeout').setRequired(false)),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a timeout from a member')
    .addUserOption(o => o.setName('user').setDescription('The member to un-timeout').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for removing timeout').setRequired(false)),

  new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Ban a member temporarily — auto-unban after the duration expires')
    .addUserOption(o => o.setName('user').setDescription('The user to temp-ban').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration: 1h, 1d, 7d, 30d').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the temp ban').setRequired(true)),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode for a channel (0 to disable)')
    .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0–21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: current)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Change a member\'s nickname')
    .addUserOption(o => o.setName('user').setDescription('The member to rename').setRequired(true))
    .addStringOption(o => o.setName('nickname').setDescription('New nickname (leave empty to reset)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove a specific warning from a user by case ID')
    .addUserOption(o => o.setName('user').setDescription('The member whose warning to remove').setRequired(true))
    .addStringOption(o => o.setName('case_id').setDescription('Case ID to remove (e.g. CASE-0003)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add a moderator note to a user\'s case history')
    .addUserOption(o => o.setName('user').setDescription('The member to add a note for').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('The note to add').setRequired(true)),

  new SlashCommandBuilder()
    .setName('cases')
    .setDescription('View moderation history for a user')
    .addUserOption(o => o.setName('user').setDescription('The user to look up').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Filter by type: BAN, KICK, WARN, TIMEOUT, MUTE…').setRequired(false)),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('View details for a specific moderation case')
    .addStringOption(o => o.setName('id').setDescription('Case ID (e.g. CASE-0042)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('security')
    .setDescription('View or configure the security module settings')
    .addSubcommand(s => s.setName('status').setDescription('Show current security module status'))
    .addSubcommand(s => s.setName('toggle-antinuke').setDescription('Toggle anti-nuke protection on/off'))
    .addSubcommand(s => s.setName('toggle-antiraid').setDescription('Toggle anti-raid protection on/off'))
    .addSubcommand(s => s.setName('toggle-quarantine').setDescription('Toggle auto-quarantine for suspicious joins')),

  // ══════════════════════════════════════════════════════════════════════════
  //  ZENITSU AI — MULTI-MODEL AI ASSISTANT
  // ══════════════════════════════════════════════════════════════════════════

  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Ask ZENITSU AI a question using your choice of AI model')
    .addStringOption(o => o
      .setName('prompt')
      .setDescription('Your question or message for the AI')
      .setRequired(true))
    .addStringOption(o => o
      .setName('model')
      .setDescription('Which AI model to use (default: Gemini)')
      .setRequired(false)
      .addChoices(
        { name: '🔷 Gemini 2.0 Flash (Free)',       value: 'gemini' },
        { name: '🟢 GPT-4o (Best)',                  value: 'gpt4o'  },
        { name: '🟡 GPT-3.5 Turbo (Fast & Cheap)',   value: 'gpt35'  },
        { name: '⚡ Groq Llama-3.3-70b (Free+Fast)', value: 'groq'   },
      )),

  new SlashCommandBuilder()
    .setName('ai-reset')
    .setDescription('Clear your AI conversation memory and start fresh'),

  new SlashCommandBuilder()
    .setName('ai-lang')
    .setDescription('Set or change your preferred AI chat language/dialect')
    .addStringOption(o => o
      .setName('language')
      .setDescription('Select your preferred dialect')
      .setRequired(true)
      .addChoices(
        { name: '🇬🇧 English', value: 'english' },
        { name: '🇮🇳 Hinglish (Hindi + English)', value: 'hinglish' },
        { name: '🐯 Tanglish (Tamil + English)', value: 'tanglish' },
      )),

  new SlashCommandBuilder()
    .setName('ai-channel')
    .setDescription('Set or clear the dedicated AI chat channel (Admin only)')
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('The channel to use for AI auto-replies (leave empty to disable)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('ai-model')
    .setDescription('Set the default AI model for the server (Admin only)')
    .addStringOption(o => o
      .setName('model')
      .setDescription('Select the default AI model')
      .setRequired(true)
      .addChoices(
        { name: '🔷 Gemini 2.0 Flash (Free)',       value: 'gemini' },
        { name: '🟢 GPT-4o (Best)',                  value: 'gpt4o'  },
        { name: '🟡 GPT-3.5 Turbo (Fast & Cheap)',   value: 'gpt35'  },
        { name: '⚡ Groq Llama-3.3-70b (Free+Fast)', value: 'groq'   },
      )),

  // ══════════════════════════════════════════════════════════════════════════
  //  PRIVACY & SERVER WHITELIST
  // ══════════════════════════════════════════════════════════════════════════

  new SlashCommandBuilder()
    .setName('whitelist-server')
    .setDescription('Manage which servers are allowed to use this bot (Owner only)')
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Allow a server to use the bot')
      .addStringOption(o => o.setName('server_id').setDescription('Server (Guild) ID to whitelist').setRequired(true)))
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a server from the whitelist')
      .addStringOption(o => o.setName('server_id').setDescription('Server (Guild) ID to remove').setRequired(true)))
    .addSubcommand(s => s
      .setName('list')
      .setDescription('Show all whitelisted servers')),

  // ══════════════════════════════════════════════════════════════════════════
  //  AI EMBED ASSISTANT
  // ══════════════════════════════════════════════════════════════════════════

  new SlashCommandBuilder()
    .setName('ai-embed')
    .setDescription('Generate a professional embed message using AI based on a description')
    .addStringOption(o => o
      .setName('description')
      .setDescription('Describe what the embed should contain (e.g. welcome message, red color, rules list)')
      .setRequired(true))
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('The channel to send the embed to (default: current)')
      .setRequired(false))
    .addStringOption(o => o
      .setName('mention')
      .setDescription('Optionally mention @everyone, @here, or a role ID')
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('draw')
    .setDescription('Generate an AI image based on your prompt')
    .addStringOption(o => o
      .setName('prompt')
      .setDescription('Description of the image you want to generate')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('whitelist-role')
    .setDescription('Manage whitelisted roles for bot commands (Admin only)')
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Add a role to a command tier whitelist')
      .addRoleOption(o => o.setName('role').setDescription('The role to whitelist').setRequired(true))
      .addStringOption(o => o.setName('tier').setDescription('The command tier').setRequired(true)
        .addChoices(
          { name: '🛠️ Admin Commands', value: 'admin' },
          { name: '👮 Staff Commands', value: 'staff' },
          { name: '👥 Normal Member Commands', value: 'member' }
        ))
      .addStringOption(o => o.setName('capabilities').setDescription('Optional capabilities for the role: ROLE_ASSIGN, SECURITY_CONFIG, AI_CONFIG').setRequired(false)))
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a role from a command tier whitelist')
      .addRoleOption(o => o.setName('role').setDescription('The role to remove').setRequired(true))
      .addStringOption(o => o.setName('tier').setDescription('The command tier').setRequired(true)
        .addChoices(
          { name: '🛠️ Admin Commands', value: 'admin' },
          { name: '👮 Staff Commands', value: 'staff' },
          { name: '👥 Normal Member Commands', value: 'member' }
        )))
    .addSubcommand(s => s
      .setName('list')
      .setDescription('Show all whitelisted roles for each command tier')),

  new SlashCommandBuilder()
    .setName('owner-help')
    .setDescription('Detailed guide on bot features, whitelist permission hierarchy, and configuration'),

  new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Inspect your active permissions, tier, and granted capabilities'),

  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Toggle emergency lockdown status (Bot Developer only)')
    .addStringOption(o => o
      .setName('action')
      .setDescription('Lockdown state')
      .setRequired(true)
      .addChoices(
        { name: '🛑 Enable Lockdown', value: 'on' },
        { name: '🟢 Lift Lockdown', value: 'off' }
      )),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription("Configure Sentinel's knowledge channels and access settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Sentinel a question about this server.')
    .addStringOption(opt =>
      opt
        .setName('question')
        .setDescription('What would you like to know?')
        .setRequired(true)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('reload')
    .setDescription('[Dev] Hot-reload a plugin without restarting the bot')
    .addStringOption(o => o
      .setName('plugin')
      .setDescription('The plugin folder name (e.g. ai, moderation, tickets)')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('reindex')
    .setDescription('[Dev] Rebuild the knowledge index for this server (RAG memory)'),

  new SlashCommandBuilder()
    .setName('spam-signature')
    .setDescription('Manage semantic spam signatures for this server')
    .addSubcommand(sc => sc
      .setName('add')
      .setDescription('Teach the bot a new scam pattern')
      .addStringOption(o => o.setName('label').setDescription('Short label (e.g. "nitro scam")').setRequired(true))
      .addStringOption(o => o.setName('sample').setDescription('A real example of the scam text').setRequired(true))
      .addNumberOption(o => o.setName('threshold').setDescription('Similarity threshold 0.7–0.95 (default 0.82)').setRequired(false).setMinValue(0.7).setMaxValue(0.95)))
    .addSubcommand(sc => sc
      .setName('remove')
      .setDescription('Delete a signature by ID')
      .addIntegerOption(o => o.setName('id').setDescription('Signature ID from /spam-signature list').setRequired(true)))
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('View all active spam signatures for this server')),

  new SlashCommandBuilder()
    .setName('setup-logs')
    .setDescription('Configure custom logging channels for this server')
    .addChannelOption(option =>
      option.setName('message-logs')
        .setDescription('Channel for message edit/delete logs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('voice-logs')
        .setDescription('Channel for voice activity logs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('server-logs')
        .setDescription('Channel for server events (joins/leaves/role updates)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('mod-logs')
        .setDescription('Channel for moderation audit logs (kicks/bans/timeouts)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('system-health')
    .setDescription('Report the database and synchronization system health (Dev only)'),

].map(command => command
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild));

// ─── Default member permission gates ───────────────────────────────────────────
// Discord itself hides these commands from users without the required permission,
// providing a first-line UX/security layer on top of our own permission engine.
const PERMISSION_GATES = {
  // Admin / server-management
  'ban':              PermissionFlagsBits.BanMembers,
  'tempban':          PermissionFlagsBits.BanMembers,
  'unban':            PermissionFlagsBits.BanMembers,
  'kick':             PermissionFlagsBits.KickMembers,
  'warn':             PermissionFlagsBits.ModerateMembers,
  'unwarn':           PermissionFlagsBits.ModerateMembers,
  'mute':             PermissionFlagsBits.ModerateMembers,
  'unmute':           PermissionFlagsBits.ModerateMembers,
  'timeout':          PermissionFlagsBits.ModerateMembers,
  'untimeout':        PermissionFlagsBits.ModerateMembers,
  'note':             PermissionFlagsBits.ModerateMembers,
  'cases':            PermissionFlagsBits.ModerateMembers,
  'case':             PermissionFlagsBits.ModerateMembers,
  'purge':            PermissionFlagsBits.ManageMessages,
  'clear-channel':    PermissionFlagsBits.ManageChannels,
  'lock':             PermissionFlagsBits.ManageChannels,
  'unlock':           PermissionFlagsBits.ManageChannels,
  'slowmode':         PermissionFlagsBits.ManageChannels,
  'nick':             PermissionFlagsBits.ManageNicknames,
  'role':             PermissionFlagsBits.ManageRoles,
  'embed':            PermissionFlagsBits.ManageMessages,
  'ai-embed':         PermissionFlagsBits.ManageMessages,
  'say':              PermissionFlagsBits.ManageMessages,
  'ai-channel':       PermissionFlagsBits.ManageGuild,
  'ai-model':         PermissionFlagsBits.ManageGuild,
  'security':         PermissionFlagsBits.ManageGuild,
  'setup-panel':      PermissionFlagsBits.ManageGuild,
  'setup':            PermissionFlagsBits.ManageGuild,
  'whitelist':        PermissionFlagsBits.Administrator,
  'whitelist-role':   PermissionFlagsBits.Administrator,
  'whitelist-server': PermissionFlagsBits.Administrator,
  'lockdown':         PermissionFlagsBits.Administrator,
  'protectme':        PermissionFlagsBits.ModerateMembers,
  'reload':           PermissionFlagsBits.Administrator,
  'reindex':          PermissionFlagsBits.Administrator,
  'spam-signature':   PermissionFlagsBits.ManageGuild,
  'setup-logs':       PermissionFlagsBits.ManageGuild,
  'system-health':     PermissionFlagsBits.Administrator,
};

for (const command of commands) {
  const gate = PERMISSION_GATES[command.name];
  if (gate) command.setDefaultMemberPermissions(gate);
}

const commandsJson = commands.map(c => c.toJSON());


const rest = new REST({ version: '10' }).setToken(config.token || 'placeholder_token');

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    if (!config.token || config.token === 'YOUR_BOT_TOKEN_HERE' || !config.clientId) {
      console.warn("WARNING: Token or Client ID is missing/default in .env. Skipping deployment.");
      return;
    }

    // Deploy guild-specific commands for instant update
    if (config.guildId) {
      console.log(`Deploying commands directly to guild: ${config.guildId}`);
      const data = await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandsJson },
      );
      console.log(`Successfully reloaded ${data.length} guild-specific application (/) commands.`);
    } else {
      console.log('No guildId configured, skipping guild deploy.');
    }
  } catch (error) {
    console.error(error);
  }
})();
