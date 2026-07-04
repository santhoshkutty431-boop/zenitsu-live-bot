const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const STAFF_CATEGORY_ID = '1444548713531047986'; // 👑┆STAFF ONLY

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error('Guild not found!');
    process.exit(1);
  }

  try {
    console.log('Checking for existing message-log channel...');
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(c => c.name.includes('message-log') && c.parentId === STAFF_CATEGORY_ID);

    if (!channel) {
      console.log('Creating 🗑️┆message-log channel...');
      
      // Get category to inherit permissions
      const category = guild.channels.cache.get(STAFF_CATEGORY_ID);
      
      channel = await guild.channels.create({
        name: '🗑️┆message-log',
        type: ChannelType.GuildText,
        parent: STAFF_CATEGORY_ID,
        topic: '🗑️ Logs of deleted and edited messages',
        permissionOverwrites: category ? category.permissionOverwrites.cache.map(o => o.toJSON()) : []
      });
      console.log(`Successfully created channel: ${channel.name} (ID: ${channel.id})`);
    } else {
      console.log(`Channel already exists: ${channel.name} (ID: ${channel.id})`);
    }

    // Write the channel ID to .env
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    const key = 'MESSAGE_LOG_ID';
    const val = channel.id;
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`Saved MESSAGE_LOG_ID=${val} to local .env file!`);

    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Failed to create channel or write to .env:', err.message);
    client.destroy();
    process.exit(1);
  }
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
