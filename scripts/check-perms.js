const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log('Guild not found'); process.exit(1); }

  console.log('\n--- Channels & Categories ---');
  await guild.channels.fetch();
  guild.channels.cache.forEach(c => {
    if (c.type === 4) {
      console.log(`[Category] Name: "${c.name}", ID: ${c.id}`);
    }
  });

  const me = await guild.members.fetch(client.user.id);
  console.log('\n--- Bot Member Roles & Permissions ---');
  console.log(`Bot Roles: ${me.roles.cache.map(r => `${r.name} (${r.id}) [Pos: ${r.position}]`).join(', ')}`);
  console.log(`Bot Permissions: ${me.permissions.toArray().join(', ')}`);

  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
