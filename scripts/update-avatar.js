const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const avatarPath = path.join(__dirname, 'avatar.png');
    if (!fs.existsSync(avatarPath)) {
      console.error('avatar.png not found!');
      process.exit(1);
    }
    console.log('Updating avatar on Discord...');
    await client.user.setAvatar(avatarPath);
    console.log('✅ SUCCESS! Bot avatar updated successfully.');
  } catch (e) {
    console.error('❌ Failed to update avatar:', e.message);
  }
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
