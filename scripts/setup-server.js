const { 
  Client, 
  GatewayIntentBits, 
  ChannelType, 
  PermissionFlagsBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', async () => {
  console.log(`Success! Logged in as ${client.user.tag}`);
  
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      console.error(`Guild not found for ID: ${config.guildId}. Make sure the bot is invited first!`);
      process.exit(1);
    }
    
    console.log(`Setting up server: ${guild.name} (${guild.id})`);
    
    // 1. Setup Roles
    console.log("Configuring roles...");
    const rolesToCreate = [
      { name: '👑 Owner', color: 0xD4AF37, permissions: [PermissionFlagsBits.Administrator] },
      { name: '🛡️ Moderator', color: 0x2E8B57, permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers] },
      { name: '👤 Member', color: 0x3498DB, permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { name: '🔇 Muted', color: 0x808080, permissions: [] },
      { name: '🔓 Bypassed', color: 0x9B59B6, permissions: [] }
    ];
    
    const createdRoles = {};
    const existingRoles = await guild.roles.fetch();
    for (const rSpec of rolesToCreate) {
      let existing = existingRoles.find(r => r.name === rSpec.name);
      if (!existing) {
        existing = await guild.roles.create({
          name: rSpec.name,
          color: rSpec.color,
          permissions: rSpec.permissions,
          reason: 'Zenitsu Server Automation Setup'
        });
        console.log(`Created role: ${rSpec.name}`);
      } else {
        console.log(`Role already exists: ${rSpec.name}`);
      }
      createdRoles[rSpec.name] = existing.id;
    }
    
    // 2. Setup Categories & Channels
    console.log("Configuring categories and channels...");
    
    const structure = [
      {
        name: '📌 INFORMATION',
        type: ChannelType.GuildCategory,
        channels: [
          { name: '👋-welcome', type: ChannelType.GuildText, readOnly: true }
        ]
      },
      {
        name: '💻 SYSTEM PANEL',
        type: ChannelType.GuildCategory,
        channels: [
          { name: '💻-basic-panel', type: ChannelType.GuildText, readOnly: true }
        ]
      },
      {
        name: '💬 COMMUNITY',
        type: ChannelType.GuildCategory,
        channels: [
          { name: 'waifu-song-request', type: ChannelType.GuildText },
          { name: 'uid-bypass', type: ChannelType.GuildText },
          { name: '📷-feedback', type: ChannelType.GuildText }
        ]
      },
      {
        name: '🛡️ STAFF ONLY',
        type: ChannelType.GuildCategory,
        staffOnly: true,
        channels: [
          { name: '🚨-reports', type: ChannelType.GuildText }
        ]
      },
      {
        name: '🎫 SUPPORT TICKETS',
        type: ChannelType.GuildCategory,
        ticketsCategory: true,
        channels: []
      }
    ];
    
    const channelIds = {};
    
    for (const catSpec of structure) {
      let category = guild.channels.cache.find(c => c.name === catSpec.name && c.type === ChannelType.GuildCategory);
      if (!category) {
        const overwrites = [];
        if (catSpec.staffOnly) {
          overwrites.push(
            {
              id: guild.id, // @everyone
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: createdRoles['👑 Owner'],
              allow: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: createdRoles['🛡️ Moderator'],
              allow: [PermissionFlagsBits.ViewChannel]
            }
          );
        }
        category = await guild.channels.create({
          name: catSpec.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwrites
        });
        console.log(`Created category: ${catSpec.name}`);
      } else {
        console.log(`Category exists: ${catSpec.name}`);
      }
      
      if (catSpec.ticketsCategory) {
        channelIds['CATEGORY_TICKETS'] = category.id;
      }
      
      for (const chanSpec of catSpec.channels) {
        let channel = guild.channels.cache.find(c => c.name === chanSpec.name && c.parentId === category.id);
        if (!channel) {
          const overwrites = [];
          if (chanSpec.readOnly) {
            overwrites.push({
              id: guild.id, // @everyone
              deny: [PermissionFlagsBits.SendMessages],
              allow: [PermissionFlagsBits.ViewChannel]
            });
          }
          channel = await guild.channels.create({
            name: chanSpec.name,
            type: chanSpec.type,
            parent: category.id,
            permissionOverwrites: overwrites
          });
          console.log(`Created channel: ${chanSpec.name}`);
        } else {
          console.log(`Channel exists: ${chanSpec.name}`);
        }
        
        channelIds[chanSpec.name] = channel.id;
      }
    }
    
    // 3. Write generated channel IDs back to .env
    console.log("Saving channel IDs to .env...");
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    const setEnvKey = (key, value) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };
    
    if (channelIds['CATEGORY_TICKETS']) setEnvKey('CATEGORY_TICKETS', channelIds['CATEGORY_TICKETS']);
    if (channelIds['👋-welcome']) setEnvKey('CHANNEL_WELCOME', channelIds['👋-welcome']);
    if (channelIds['🚨-reports']) setEnvKey('CHANNEL_REPORTS', channelIds['🚨-reports']);
    if (channelIds['📷-feedback']) setEnvKey('CHANNEL_FEEDBACK', channelIds['📷-feedback']);
    if (channelIds['💻-basic-panel']) setEnvKey('CHANNEL_PANEL', channelIds['💻-basic-panel']);
    if (channelIds['waifu-song-request']) setEnvKey('CHANNEL_SONG_REQUEST', channelIds['waifu-song-request']);
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(".env file updated successfully!");
    
    // 4. Deploy panel to #💻-basic-panel
    console.log("Deploying Control Panel...");
    const panelChan = guild.channels.cache.get(channelIds['💻-basic-panel']);
    if (panelChan) {
      // Clean previous posts
      const fetched = await panelChan.messages.fetch({ limit: 10 }).catch(() => null);
      if (fetched) {
        for (const msg of fetched.values()) {
          await msg.delete().catch(() => {});
        }
      }
      
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_open')
          .setLabel('🎫 Open Ticket')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('uid_bypass_check')
          .setLabel('🔍 UID Bypass Check')
          .setStyle(ButtonStyle.Primary)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('report_submit_btn')
          .setLabel('📋 Submit Report')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('view_song_queue')
          .setLabel('🎶 View Song Queue')
          .setStyle(ButtonStyle.Secondary)
      );

      const panelEmbed = new EmbedBuilder()
        .setTitle('💻 ZENITSU LIVE - AUTOMATION PANEL')
        .setDescription('Welcome to the Server Panel! Use the buttons below to interact with our automation systems:\n\n' +
          '**🎫 Open Ticket**: Opens a private support channel to talk to administrators.\n' +
          '**🔍 UID Bypass Check**: Look up or register game UIDs for bypassing restrictions.\n' +
          '**📋 Submit Report**: Report players, bad behaviors, or bugs.\n' +
          '**🎶 View Song Queue**: Check active waifu song requests.')
        .setColor(0xEDC231)
        .setThumbnail(guild.iconURL())
        .setFooter({ text: 'Zenitsu Live Automation System v1.0' })
        .setTimestamp();

      await panelChan.send({ embeds: [panelEmbed], components: [row1, row2] });
      console.log("Panel deployed!");
    }
    
    console.log("====================================================");
    console.log("🎉 SERVER AUTOMATION SETUP COMPLETED SUCCESSFULLY!");
    console.log("====================================================");
    
    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error("Setup Error:", err);
    client.destroy();
    process.exit(1);
  }
});

client.login(config.token).catch(err => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
