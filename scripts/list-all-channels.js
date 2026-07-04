const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log('Guild not found'); process.exit(1); }

  console.log('\n--- Channels ---');
  await guild.channels.fetch();
  guild.channels.cache.forEach(c => {
    console.log(`Type: ${c.type}, Name: "${c.name}", ID: ${c.id}`);
  });

  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
