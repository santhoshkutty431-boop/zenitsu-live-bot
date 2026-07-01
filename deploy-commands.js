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
