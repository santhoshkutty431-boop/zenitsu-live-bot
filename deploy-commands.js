const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('setup-panel')
    .setDescription('Deploys the basic panel interface to the configured channel'),

  new SlashCommandBuilder()
    .setName('request-song')
    .setDescription('Request a waifu song')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('Name or link of the song to request')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the current song requests queue'),

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
    .setDescription('Manage the role-giving whitelist')
    .addSubcommand(subcommand =>
      subcommand.setName('add')
        .setDescription('Add a user to the whitelist')
        .addUserOption(option => option.setName('user').setDescription('The user to whitelist').setRequired(true)))
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

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token || 'placeholder_token');

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    if (!config.token || config.token === 'YOUR_BOT_TOKEN_HERE' || !config.clientId) {
      console.warn("WARNING: Token or Client ID is missing/default in .env. Skipping deployment.");
      return;
    }

    // Clean up guild commands first if GUILD_ID is provided
    if (config.guildId) {
      console.log(`Clearing old guild-specific commands for guild: ${config.guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: [] },
      ).catch(err => console.log('Note: No guild commands to clean up or failed:', err.message));
    }

    // Deploy global commands
    const data = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} global application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
})();
