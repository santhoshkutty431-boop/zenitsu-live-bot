const { Client, GatewayIntentBits, Partials } = require('C:/Users/Admin/Pictures/Saved Pictures/ZenitsuLiveBot/node_modules/discord.js');
const dotenv = require('C:/Users/Admin/Pictures/Saved Pictures/ZenitsuLiveBot/node_modules/dotenv');
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

client.once('ready', () => {
  console.log(`Test client logged in as: ${client.user.tag}`);
});

client.on('messageCreate', msg => {
  console.log(`[CREATE EVENT] Message from ${msg.author.tag} in #${msg.channel.name}: "${msg.content}"`);
});

client.on('messageDelete', msg => {
  console.log(`[DELETE EVENT] Message deleted in guild: ${msg.guild?.name || 'DM'}`);
  console.log(`  Channel: ${msg.channel?.name}`);
  console.log(`  Author: ${msg.author?.tag || 'Unknown'}`);
  console.log(`  Content: ${msg.content || '(No content / uncached)'}`);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login failed:', err.message);
});
