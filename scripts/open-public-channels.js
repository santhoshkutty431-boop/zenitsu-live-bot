const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const IDS = {
  // Text channels
  GENERAL_CHAT:  '1445573197998067733',
  FEEDBACK:      '1445744625607507980',
  SONG_REQUESTS: '1459521604282486970',
  // Voice channels
  PUBLIC_VC:     '1444533393688760414',
  DUO_VC:        '1444533393688760415',
  TRIO_VC:       '1444537473748439161',
  SQUAD_VC:      '1444537666849734656',
  // Roles
  SAPPHIRE:      '1444620237923418146',
  NLC_BOT:       '1492731728924770478',
};

client.once('ready', async () => {
  log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { log('Guild not found'); process.exit(1); }
  await guild.channels.fetch();

  const ch = (id) => guild.channels.cache.get(id);
  const EVERYONE = guild.id;
  const SAPPH    = IDS.SAPPHIRE;
  const NLCBOT   = IDS.NLC_BOT;

  const setPerms = async (chanId, overwrites, label) => {
    const channel = ch(chanId);
    if (!channel) { log(`  ⚠️  Not found: ${label}`); return; }
    try {
      await channel.permissionOverwrites.set(overwrites, 'Open to all members');
      log(`  ✅ ${label}`);
    } catch (e) {
      log(`  ❌ ${label} — ${e.message}`);
    }
    await sleep(400);
  };

  log('\n=== Opening text channels to @everyone ===');

  // general-chat — everyone can read & chat
  await setPerms(IDS.GENERAL_CHAT, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.UseApplicationCommands,
    ]},
    { id: SAPPH,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: NLCBOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ], 'general-chat → open to everyone');

  // feedback — everyone can post feedback
  await setPerms(IDS.FEEDBACK, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.UseExternalEmojis,
    ]},
    { id: SAPPH,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: NLCBOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ], 'feedback → open to everyone');

  // song-requests — everyone can request songs
  await setPerms(IDS.SONG_REQUESTS, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseExternalEmojis,
    ]},
    { id: SAPPH,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: NLCBOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ], 'song-requests → open to everyone');

  log('\n=== Opening voice channels to @everyone ===');

  // public-vc — unlimited, everyone can join
  await setPerms(IDS.PUBLIC_VC, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseSoundboard,
    ]},
    { id: SAPPH, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers] },
  ], 'public-vc → open to everyone');

  // duo-vc — limit 2
  await setPerms(IDS.DUO_VC, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.Stream,
    ]},
    { id: SAPPH, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers] },
  ], 'duo-vc → open to everyone');

  // trio-vc — limit 3
  await setPerms(IDS.TRIO_VC, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.Stream,
    ]},
    { id: SAPPH, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers] },
  ], 'trio-vc → open to everyone');

  // squad-vc — limit 4
  await setPerms(IDS.SQUAD_VC, [
    { id: EVERYONE, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.Stream,
    ]},
    { id: SAPPH, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers] },
  ], 'squad-vc → open to everyone');

  log('\n================================================');
  log('✅ DONE — All 7 channels now open to everyone!');
  log('================================================');
  log('Text: general-chat, feedback, song-requests');
  log('Voice: public-vc, duo-vc, trio-vc, squad-vc');

  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => {
  log(`Login failed: ${err.message}`);
  process.exit(1);
});
