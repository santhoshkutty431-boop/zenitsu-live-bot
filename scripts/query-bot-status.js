const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
  console.log(`Successfully connected as: ${client.user.tag}`);
  console.log('Bot Guilds:');
  for (const [guildId, guild] of client.guilds.cache) {
    console.log(` - ${guild.name} (${guildId})`);
    
    // Fetch channels to see what is cached
    try {
      const channels = await guild.channels.fetch();
      console.log('   Channels:');
      const targetNames = ['server-logs', 'voice-log', 'mod-log', 'message-log'];
      channels.forEach(ch => {
        if (targetNames.some(name => ch.name.toLowerCase().includes(name))) {
          console.log(`     * ${ch.name} (ID: ${ch.id}) - Type: ${ch.type}`);
        }
      });
    } catch (err) {
      console.error(`   Failed to fetch channels for ${guild.name}:`, err.message);
    }
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Failed to login:', err.message);
  process.exit(1);
});
