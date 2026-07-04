const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MESSAGE_LOG_CHANNEL_ID = '1521935264426229793';
const ID = {
  MOD_ROLE: '1521573587859800204',
  SUPPORT_ROLE: '1521573594251923456',
  OWNER_ROLE: '1444534470869913752',
  ADMIN_ROLE: '1521573583766294728',
};

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error('Guild not found!');
    process.exit(1);
  }

  try {
    const channel = await guild.channels.fetch(MESSAGE_LOG_CHANNEL_ID);
    if (!channel) {
      console.error('Message log channel not found!');
      process.exit(1);
    }

    console.log(`Updating permissions for ${channel.name} to make it OWNER ONLY...`);

    await channel.permissionOverwrites.set([
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: ID.MOD_ROLE,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: ID.SUPPORT_ROLE,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: ID.OWNER_ROLE,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: ID.ADMIN_ROLE,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: client.user.id, // The Bot itself
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory]
      }
    ]);

    console.log('SUCCESS! Channel is now locked so only the Owner/Admin can see it.');
    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Failed to update channel permissions:', err.message);
    client.destroy();
    process.exit(1);
  }
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
