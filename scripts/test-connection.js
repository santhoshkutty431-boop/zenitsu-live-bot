const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

// Create a minimal client
const client = new Client({ 
  intents: [GatewayIntentBits.Guilds] 
});

// Load Discord Bot Token from configuration
const BOT_TOKEN = config.token; 

client.once('ready', () => {
  console.log('========================================');
  console.log(`✅ CONNECTION SUCCESSFUL!`);
  console.log(`Connected to Discord API as: ${client.user.tag}`);
  console.log('========================================');
  client.destroy(); // Shut down after verification
  process.exit(0);
});

console.log('Connecting to Discord API...');
client.login(BOT_TOKEN).catch(err => {
  console.error('========================================');
  console.error('❌ CONNECTION FAILED!');
  console.error(`Error details: ${err.message}`);
  console.error('========================================');
  process.exit(1);
});
