const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', async () => {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log("Guild not found!"); process.exit(1); }

  await guild.channels.fetch();
  await guild.roles.fetch();

  console.log("\n=== ROLES ===");
  guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .forEach(r => {
      if (r.name === '@everyone') return;
      console.log(`[${r.position}] ${r.name} | ID: ${r.id} | Color: ${r.hexColor} | Hoist: ${r.hoist} | Permissions: ${r.permissions.toArray().join(', ')}`);
    });

  console.log("\n=== CATEGORIES & CHANNELS ===");
  const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).sort((a,b) => a.position - b.position);
  
  categories.forEach(cat => {
    console.log(`\n📁 [${cat.position}] ${cat.name} | ID: ${cat.id}`);
    const children = guild.channels.cache
      .filter(c => c.parentId === cat.id)
      .sort((a,b) => a.position - b.position);
    children.forEach(ch => {
      const type = ch.type === ChannelType.GuildText ? '#' : ch.type === ChannelType.GuildVoice ? '🔊' : '?';
      console.log(`  ${type} [${ch.position}] ${ch.name} | ID: ${ch.id}`);
    });
  });

  const noCategory = guild.channels.cache
    .filter(c => !c.parentId && c.type !== ChannelType.GuildCategory)
    .sort((a,b) => a.position - b.position);
  if (noCategory.size > 0) {
    console.log("\n📁 [NO CATEGORY]");
    noCategory.forEach(ch => {
      console.log(`  # ${ch.name} | ID: ${ch.id}`);
    });
  }

  client.destroy();
  process.exit(0);
});

client.login(config.token);
