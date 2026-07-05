const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config');

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds] 
});

client.once('ready', async () => {
  console.log('========================================');
  console.log(`Bot is currently in ${client.guilds.cache.size} server(s):`);
  console.log('----------------------------------------');
  client.guilds.cache.forEach(guild => {
    console.log(`• Name: ${guild.name}`);
    console.log(`  ID  : ${guild.id}`);
    console.log(`  Size: ${guild.memberCount} members`);
    console.log('----------------------------------------');
  });
  console.log('========================================');
  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error(`Login failed: ${err.message}`);
  process.exit(1);
});
