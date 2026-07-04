const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const channelRenames = {
  // Categories
  '1444533393688760410': '📌┆INFORMATION',
  '1444533393688760413': '💬┆COMMUNITY',
  '1444534096825946153': '🎧┆VOICE',
  '1460243779322777672': '🛒┆SHOP',
  '1444538003824447621': '🎫┆SUPPORT',
  '1460870443174068306': '📋┆REQUIREMENTS',
  '1444548713531047986': '👑┆STAFF ONLY',
  '1449099333508141196': '✨┆CLIENTS',

  // Information
  '1444533393688760411': '👋┆welcome',
  '1444538272884981882': '📜┆rules',
  '1444546036617056267': '📢┆announcements',
  '1454297254079762482': '📈┆invite-tracker',

  // Community
  '1445573197998067733': '💬┆general-chat',
  '1445744625607507980': '📸┆feedback',
  '1459521604282486970': '🎶┆song-requests',

  // Voice
  '1444533393688760414': '🎙️┆public-vc',
  '1444533393688760415': '🎙️┆duo-vc',
  '1444537473748439161': '🎙️┆trio-vc',
  '1444537666849734656': '🎙️┆squad-vc',
  '1449290971391983747': '🔒┆private-vc',

  // Shop
  '1460245030102110402': '🎁┆free-panel',
  '1460152526463832097': '💻┆basic-panel',
  '1446095251612762112': '💸┆payment-proof',
  '1453191409141158093': '🎯┆aim-silent',
  '1460147753576300597': '💀┆aim-kill',
  '1460149291996676188': '⚙️┆panel-internal',
  '1460149421177045112': '🖥️┆panel-external',
  '1460151022088491059': '🎥┆streamer-panel',
  '1460152237836730419': '🛡️┆bypass-emulator',
  '1460152325267128520': '🔍┆uid-bypass',

  // Support
  '1444538212583473162': '🎫┆ticket-center',
  '1444538404212834335': '📁┆feedback-archive',

  // Requirements
  '1460870595297284387': '📲┆free-fire-apk',
  '1505382439017644212': '🛠️┆beta-tools',

  // Staff
  '1444549318299095182': '👑┆admin-chat',
  '1444639792846344273': '🚨┆mod-reports',
  '1444737239887122635': '🛡️┆protectme-logs',
  '1521577044687847464': '📋┆server-logs',
  '1521577051516047573': '🎙️┆voice-log',
  '1521577060689248519': '⚖️┆mod-log',

  // Clients
  '1521553349084713010': '📢┆client-announcements',
  '1449099449203691570': '💬┆client-chat',
  '1455565235426562173': '🎯┆aimsilent-access',
};

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error('Guild not found!');
    process.exit(1);
  }

  console.log('Starting channel renaming...');
  await guild.channels.fetch();

  for (const [id, newName] of Object.entries(channelRenames)) {
    const channel = guild.channels.cache.get(id);
    if (channel) {
      if (channel.name === newName) {
        console.log(`  [Skip] ${channel.name} is already set.`);
        continue;
      }
      try {
        const oldName = channel.name;
        await channel.setName(newName);
        console.log(`  [Success] Renamed "${oldName}" -> "${newName}"`);
        // Wait 1 second to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`  [Error] Failed to rename channel ${id}:`, err.message);
      }
    } else {
      console.log(`  [Warn] Channel with ID ${id} not found on server.`);
    }
  }

  console.log('Channel renaming complete!');
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
