/**
 * SETUP UPGRADES — One-time setup script
 * Creates log channels, sets slowmode, wires join gate
 */
const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const fs = require('fs');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const IDS = {
  CAT_STAFF:     '1444548713531047986',  // 👑 STAFF
  CAT_COMMUNITY: '1444533393688760413',  // 💬 COMMUNITY (was VOICE)
  CAT_VOICE:     '1444534096825946153',  // 🎧 VOICE (was PURCHASE)
  CH_WELCOME:    '1444533393688760411',
  CH_GENERAL:    '1445573197998067733',
  ROLE_SAPPHIRE: '1444620237923418146',
  ROLE_NLC_BOT:  '1492731728924770478',
  ROLE_MEMBER:   '1444551212904218705',
  ROLE_CLIENTS:  '1449096942469644480',
  ROLE_ADMIN:    '1521573583766294728',
  ROLE_MOD:      '1521573587859800204',
  ROLE_SUPPORT:  '1521573594251923456',
  ROLE_OWNER:    '1444534470869913752',
};

client.once('ready', async () => {
  log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { log('Guild not found'); process.exit(1); }
  await guild.channels.fetch();

  const ch = (id) => guild.channels.cache.get(id);
  const EVERYONE = guild.id;
  const envUpdates = {};

  // ═══════════════════════════════════════════════════════
  // STEP 1 — Create Log Channels in STAFF
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 1: Creating log channels ══════');

  const staffPerms = [
    { id: EVERYONE,          deny: [PermissionFlagsBits.ViewChannel] },
    { id: IDS.ROLE_OWNER,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: IDS.ROLE_ADMIN,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: IDS.ROLE_MOD,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: IDS.ROLE_NLC_BOT,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: IDS.ROLE_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
  ];

  // #server-logs (message edits/deletes, joins, leaves, role changes)
  const serverLogsChannel = await guild.channels.create({
    name: 'server-logs',
    type: 0,
    parent: IDS.CAT_STAFF,
    topic: 'Message edits, deletions, member joins/leaves and role changes',
    permissionOverwrites: staffPerms,
    reason: 'Upgrade: Full logging system',
  });
  envUpdates.SERVER_LOGS_ID = serverLogsChannel.id;
  log(`  ✅ Created: #server-logs (${serverLogsChannel.id})`);
  await sleep(500);

  // #voice-log (VC join/leave/move/duration)
  const voiceLogChannel = await guild.channels.create({
    name: 'voice-log',
    type: 0,
    parent: IDS.CAT_STAFF,
    topic: 'Voice channel activity — joins, leaves, moves, duration',
    permissionOverwrites: staffPerms,
    reason: 'Upgrade: Voice logging',
  });
  envUpdates.VOICE_LOG_ID = voiceLogChannel.id;
  log(`  ✅ Created: #voice-log (${voiceLogChannel.id})`);
  await sleep(500);

  // #mod-log (bans, kicks, timeouts, mutes)
  const modLogChannel = await guild.channels.create({
    name: 'mod-log',
    type: 0,
    parent: IDS.CAT_STAFF,
    topic: 'Moderation actions — bans, kicks, timeouts, role changes by staff',
    permissionOverwrites: [
      ...staffPerms,
      { id: IDS.ROLE_SUPPORT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    ],
    reason: 'Upgrade: Mod action logging',
  });
  envUpdates.MOD_LOG_ID = modLogChannel.id;
  log(`  ✅ Created: #mod-log (${modLogChannel.id})`);
  await sleep(500);

  // ═══════════════════════════════════════════════════════
  // STEP 2 — Set Slowmode on general-chat (upgrade 5)
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 2: Setting slowmode on general-chat ══════');
  const generalChat = ch(IDS.CH_GENERAL);
  if (generalChat) {
    await generalChat.edit({ rateLimitPerUser: 5, reason: 'Anti-spam slowmode — 5 seconds' });
    log('  ✅ general-chat → 5 second slowmode applied');
  }
  await sleep(500);

  // ═══════════════════════════════════════════════════════
  // STEP 3 — Join Gate: Restrict @everyone from Community/Voice
  //          New members must click verify to get MEMBER role
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 3: Setting up Join Gate permissions ══════');

  // COMMUNITY category — deny @everyone, only MEMBER+ sees it
  const commCat = ch(IDS.CAT_COMMUNITY);
  if (commCat) {
    await commCat.permissionOverwrites.set([
      { id: EVERYONE,         deny:  [PermissionFlagsBits.ViewChannel] },
      { id: IDS.ROLE_MEMBER,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions, PermissionFlagsBits.AttachFiles] },
      { id: IDS.ROLE_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] },
      { id: IDS.ROLE_ADMIN,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: IDS.ROLE_MOD,     allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: IDS.ROLE_SAPPHIRE,allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: IDS.ROLE_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    ], 'Join gate: Community requires MEMBER role');
    log('  ✅ 💬 COMMUNITY → locked to MEMBER+ only');
  }
  await sleep(500);

  // VOICE category — deny @everyone
  const voiceCat = ch(IDS.CAT_VOICE);
  if (voiceCat) {
    await voiceCat.permissionOverwrites.set([
      { id: EVERYONE,         deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      { id: IDS.ROLE_MEMBER,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.UseVAD, PermissionFlagsBits.Stream] },
      { id: IDS.ROLE_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.UseVAD, PermissionFlagsBits.Stream] },
      { id: IDS.ROLE_ADMIN,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers] },
      { id: IDS.ROLE_MOD,     allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers] },
      { id: IDS.ROLE_SAPPHIRE,allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers] },
    ], 'Join gate: Voice requires MEMBER role');
    log('  ✅ 🎧 VOICE → locked to MEMBER+ only');
  }
  await sleep(500);

  // ═══════════════════════════════════════════════════════
  // STEP 4 — Post Verify Button in Welcome Channel
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 4: Posting verify button in welcome channel ══════');

  const welcomeCh = ch(IDS.CH_WELCOME);
  if (welcomeCh) {
    // Clear old bot messages
    const msgs = await welcomeCh.messages.fetch({ limit: 20 }).catch(() => null);
    if (msgs) {
      for (const msg of msgs.values()) {
        if (msg.author.bot) await msg.delete().catch(() => {});
      }
    }
    await sleep(500);

    const verifyEmbed = new EmbedBuilder()
      .setTitle('👋 Welcome to ZENITSU LIVE!')
      .setDescription(
        '> Thank you for joining! To get full access to the server, please read the rules and verify below.\n\n' +
        '**📜 Rules:** Read <#1444538272884981882> before verifying.\n\n' +
        '**After verifying you unlock:**\n' +
        '💬 `general-chat` — Talk with the community\n' +
        '📸 `feedback` — Share your experience\n' +
        '🎶 `song-requests` — Request waifu songs\n' +
        '🎧 All voice channels — Join and play\n\n' +
        '> Click ✅ **Verify** below to get started!'
      )
      .setColor(0xEDC231)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'ZENITSU LIVE • Verification System' })
      .setTimestamp();

    const verifyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_member')
        .setLabel('✅ Verify & Get Access')
        .setStyle(ButtonStyle.Success),
    );

    await welcomeCh.send({ embeds: [verifyEmbed], components: [verifyRow] });
    log('  ✅ Verify button posted in #welcome');
  }

  // ═══════════════════════════════════════════════════════
  // STEP 5 — Save channel IDs to .env
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 5: Saving channel IDs to .env ══════');
  let envContent = fs.readFileSync('.env', 'utf8');
  for (const [key, value] of Object.entries(envUpdates)) {
    if (envContent.includes(`${key}=`)) {
      envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync('.env', envContent);
  log('  ✅ .env updated with log channel IDs');

  log('\n══════════════════════════════════════════════════════');
  log('✅ SETUP COMPLETE! Run: node index.js to start the bot');
  log('══════════════════════════════════════════════════════');
  log(`SERVER_LOGS_ID = ${envUpdates.SERVER_LOGS_ID}`);
  log(`VOICE_LOG_ID   = ${envUpdates.VOICE_LOG_ID}`);
  log(`MOD_LOG_ID     = ${envUpdates.MOD_LOG_ID}`);

  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => { log(`Login failed: ${err.message}`); process.exit(1); });
