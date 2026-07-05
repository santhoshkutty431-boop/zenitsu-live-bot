const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
  console.log(`Connected as: ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    console.log(`\nGuild: ${guild.name} (${guildId})`);
    try {
      const me = await guild.members.fetch(client.user.id);
      console.log(`  Bot Roles: ${me.roles.cache.map(r => r.name).join(', ')}`);
      
      const hasAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
      console.log(`  Has Administrator Permission: ${hasAdmin}`);
      
      const permissionsToCheck = [
        PermissionFlagsBits.ViewAuditLog,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ViewChannel
      ];
      
      permissionsToCheck.forEach(perm => {
        const name = Object.keys(PermissionFlagsBits).find(key => PermissionFlagsBits[key] === perm);
        console.log(`  - Global ${name}: ${me.permissions.has(perm)}`);
      });

      console.log('  Checking specific log channels:');
      const logChannelIds = {
        serverLog: '1521577044687847464',
        voiceLog: '1521577051516047573',
        modLog: '1521577060689248519',
        messageLog: '1521935264426229793',
        aiAnalytics: '1522252177387815074'
      };

      for (const [name, id] of Object.entries(logChannelIds)) {
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel) {
          console.log(`    - ${name} (ID: ${id}): NOT FOUND`);
          continue;
        }
        const perms = channel.permissionsFor(me);
        console.log(`    - ${name} (ID: ${id}, Name: "${channel.name}"):`);
        console.log(`      * ViewChannel: ${perms.has(PermissionFlagsBits.ViewChannel)}`);
        console.log(`      * SendMessages: ${perms.has(PermissionFlagsBits.SendMessages)}`);
        console.log(`      * EmbedLinks: ${perms.has(PermissionFlagsBits.EmbedLinks)}`);
      }
    } catch (err) {
      console.error(`  Failed to check permissions: ${err.message}`);
    }
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
