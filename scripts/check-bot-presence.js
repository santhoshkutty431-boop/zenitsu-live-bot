const { Client, GatewayIntentBits } = require('C:/Users/Admin/Pictures/Saved Pictures/ZenitsuLiveBot/node_modules/discord.js');
const dotenv = require('C:/Users/Admin/Pictures/Saved Pictures/ZenitsuLiveBot/node_modules/dotenv');
dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
  console.log(`Connected to check presence.`);
  try {
    const guild = await client.guilds.fetch('1444533392518680719');
    
    // Fetch member via REST API (does not require GuildMembers gateway intent)
    const member = await guild.members.fetch({ user: '1488445899448385627', force: true });
    console.log(`Bot Member Status:`);
    console.log(` - Nickname: ${member.nickname}`);
    console.log(` - Presence Status: ${member.presence ? member.presence.status : 'unknown'}`);
    
    // Wait, let's see if we can check if it is active. Since presence might be null without intents,
    // let's fetch the bot user object itself and check if it is online (presence is not available via REST user, but we can query it)
    console.log(` - Bot User: ${member.user.username}#${member.user.discriminator}`);
  } catch (err) {
    console.error('Error fetching bot presence:', err.message);
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error(err);
  process.exit(1);
});
