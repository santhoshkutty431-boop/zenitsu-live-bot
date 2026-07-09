const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    console.log(`Logged in as ${client.user.tag}`);
    const channelId = process.env.CHANNEL_FEEDBACK || '1445744625607507980';
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`Channel ${channelId} not found.`);
      process.exit(1);
    }
    
    console.log(`Setting permissions for ${channel.name} (${channel.id})...`);
    
    // Set permission overrides for @everyone (View, Send, Attach, React, Read History)
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      AddReactions: true,
      ReadMessageHistory: true
    });
    
    console.log('Successfully updated channel permissions for @everyone!');
    process.exit(0);
  } catch (err) {
    console.error('Error updating channel permissions:', err);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
