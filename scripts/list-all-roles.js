const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log('Guild not found'); process.exit(1); }

  console.log('\n--- Roles ---');
  await guild.roles.fetch();
  guild.roles.cache.forEach(r => {
    console.log(`Role Name: "${r.name}", ID: ${r.id}, Position: ${r.position}`);
  });

  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
