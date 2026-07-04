const { Client, GatewayIntentBits, Presence } = require('discord.js');
const config = require('./config');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ] 
});

client.once('ready', async () => {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log('Guild not found'); process.exit(1); }

  try {
    const member = await guild.members.fetch('1488445899448385627'); // kutty's user ID
    console.log(`Bot Status: ${member.presence ? member.presence.status : 'offline'}`);
  } catch (e) {
    console.log('Error fetching bot presence:', e.message);
  }
  
  client.destroy();
  process.exit(0);
});

client.login(config.token);
