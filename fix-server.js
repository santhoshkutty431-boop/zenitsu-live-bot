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
// NOTE: uid-bypass is a product sales channel only — no bot logic needed
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ─── IDs of YOUR REAL existing channels / categories (from scan) ───
const REAL = {
  // Categories
  CAT_COMMUNITY:       '1444533393688760410',
  CAT_VOICE:           '1444533393688760413',
  CAT_FREE_ZONE:       '1460243779322777672',
  CAT_PURCHASE:        '1444534096825946153',
  CAT_INFORMATION:     '1444538003824447621',
  CAT_REQUIREMENT:     '1460870443174068306',
  CAT_PERSONAL:        '1444548713531047986',
  CAT_CLIENTS:         '1455565178849464502',
  CAT_STAR:            '1449099333508141196',

  // Channels
  CH_WELCOME:          '1444533393688760411',
  CH_REPORTS:          '1444639792846344273',
  CH_FEEDBACK:         '1445744625607507980',
  CH_INVITE_TRACKER:   '1454297254079762482',
  CH_PUBLIC_CHAT:      '1445573197998067733',
  CH_FREE_PANEL:       '1460245030102110402',
  CH_PAYMENT_PROOF:    '1446095251612762112',
  CH_TICKET_CENTER:    '1444538212583473162',
  CH_RULES:            '1444538272884981882',
  CH_FEEDBACK2:        '1444538404212834335',
  CH_ANNOUNCEMENTS:    '1444546036617056267',
  CH_ADMINS:           '1444549318299095182',
  CH_PANEL_BASIC:      '1460152526463832097',
  // uid-bypass is a plain product info channel — permissions set below
  CH_UID_BYPASS:       '1460152325267128520',
  CH_PROTECTME:        '1444737239887122635',
  CH_SONG_REQUEST:     '1459521604282486970',

  // Real Roles
  ROLE_SAPPHIRE:       '1444620237923418146',
  ROLE_KOYA:           '1444706452148191508',
  ROLE_PROTECTME:      '1444737238381629473',
  ROLE_BEST_FRND:      '1459603456095420416',
  ROLE_CLIENTS:        '1449096942469644480',
  ROLE_INVITE_TRACKER: '1454291833986355283',
  ROLE_SOUNDBOARD:     '1455032564896239659',
  ROLE_ALL_VC:         '1457379274884649044',
  ROLE_MUSICO:         '1459899479225270345',
  ROLE_FRND:           '1499463599796654100',
  ROLE_TICKET_KING:    '1460246811330609266',
  ROLE_KITT:           '1461182816476860540',
  ROLE_BOOSTER:        '1465681691770093578',
  ROLE_TWISHA:         '1483722902355447864',
  ROLE_NLC_BOT:        '1492731728924770478',
  ROLE_MEMBER:         '1444551212904218705',
};

// ─── IDs of DUMMY channels/categories WE created (to DELETE) ───
const DUMMY_TO_DELETE = [
  '1521562030040027366', // 🎫 SUPPORT TICKETS (cat)
  '1521562025514373375', // 🛡️ STAFF ONLY (cat)
  '1521562028114710598', // 🚨-reports (ours)
  '1521562010725126306', // 💬 COMMUNITY (cat)
  '1521562012935520348', // waifu-song-request (ours)
  '1521562019222913307', // uid-bypass (ours)
  '1521562022477566174', // 📷-feedback (ours)
  '1521562004924665946', // 💻 SYSTEM PANEL (cat)
  '1521562007646503172', // 💻-basic-panel (ours)
  '1521562000503734554', // 📌 INFORMATION (cat)
  '1521562002810736831', // 👋-welcome (ours)
];

// ─── Dummy Roles WE created (to DELETE) ───
const DUMMY_ROLES_TO_DELETE = [
  '1521561989090906132', // 👑 Owner
  '1521561990894583860', // 🛡️ Moderator
  '1521561993616691353', // 👤 Member
  '1521561995046817855', // 🔇 Muted
  '1521561997697613864', // 🔓 Bypassed
];

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.error('Guild not found!'); process.exit(1); }

  await guild.channels.fetch();
  await guild.roles.fetch();

  // ═══════════════════════════════════════════════════════════════
  // STEP 1 — Delete all dummy channels/categories we created
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 1] Deleting duplicate channels/categories we created...');
  for (const id of DUMMY_TO_DELETE) {
    const ch = guild.channels.cache.get(id);
    if (ch) {
      await ch.delete('Removing duplicate created by bot setup').catch(e => console.error(`  Could not delete ${ch.name}: ${e.message}`));
      console.log(`  Deleted: ${ch.name}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2 — Delete dummy roles we created
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 2] Deleting dummy roles we created...');
  for (const id of DUMMY_ROLES_TO_DELETE) {
    const role = guild.roles.cache.get(id);
    if (role) {
      await role.delete('Removing dummy role').catch(e => console.error(`  Could not delete ${role.name}: ${e.message}`));
      console.log(`  Deleted role: ${role.name}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3 — Fix permissions on REAL channels professionally
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 3] Configuring permissions on real channels...');

  const everyone = guild.id;
  const R_SAPPHIRE    = REAL.ROLE_SAPPHIRE;
  const R_MEMBER      = REAL.ROLE_MEMBER;
  const R_CLIENTS     = REAL.ROLE_CLIENTS;
  const R_NLC_BOT     = REAL.ROLE_NLC_BOT;
  const R_PROTECTME   = REAL.ROLE_PROTECTME;
  const R_KOYA        = REAL.ROLE_KOYA;

  // Helper
  const setPerms = async (chanId, overwrites) => {
    const ch = guild.channels.cache.get(chanId);
    if (!ch) { console.log(`  ⚠️  Channel ${chanId} not found, skipping`); return; }
    await ch.permissionOverwrites.set(overwrites, 'Professional permission setup').catch(e => console.error(`  Error on ${ch.name}: ${e.message}`));
    console.log(`  ✅  Set permissions on: ${ch.name}`);
  };

  // #👋 WELCOME — Read only for everyone
  await setPerms(REAL.CH_WELCOME, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #🚨-REPORTS — Staff only (Sapphire + NLC BOT only)
  await setPerms(REAL.CH_REPORTS, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ]);

  // #📸 FEED-BACK — Members can post, Sapphire manages
  await setPerms(REAL.CH_FEEDBACK, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_MEMBER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
    { id: R_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #💬 public-chat — All members can chat
  await setPerms(REAL.CH_PUBLIC_CHAT, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_MEMBER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.AddReactions] },
    { id: R_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_PROTECTME, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #💻-basic-panel (PURCHASE PANEL) — Read only, Sapphire can post
  await setPerms(REAL.CH_PANEL_BASIC, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #🛒-uid-bypass — Product info channel, read-only for everyone (Sapphire posts info)
  await setPerms(REAL.CH_UID_BYPASS, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #🤖protectme-bot — Staff/Bot only
  await setPerms(REAL.CH_PROTECTME, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: R_PROTECTME, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ]);

  // #waifu-song-request — Members can request, read only style (bot posts queue)
  await setPerms(REAL.CH_SONG_REQUEST, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_MEMBER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ]);

  // #📢 ANNOUNCEMENTS — Read only everyone
  await setPerms(REAL.CH_ANNOUNCEMENTS, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MentionEveryone] }
  ]);

  // #📜 SERVER-RULES — Read only for all
  await setPerms(REAL.CH_RULES, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #🎫 ticket-center — Visible to all, bot posts the ticket panel
  await setPerms(REAL.CH_TICKET_CENTER, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // #💸-PAYMENT-PROOF — Clients post, Sapphire verifies
  await setPerms(REAL.CH_PAYMENT_PROOF, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
  ]);

  // 👑-ADMINS — Only Sapphire
  await setPerms(REAL.CH_ADMINS, [
    { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
  ]);

  // free-panel — visible to everyone
  await setPerms(REAL.CH_FREE_PANEL, [
    { id: everyone, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: R_SAPPHIRE, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: R_NLC_BOT, allow: [PermissionFlagsBits.SendMessages] }
  ]);

  // ═══════════════════════════════════════════════════════════════
  // STEP 4 — Deploy the professional control panel to #💻-basic-panel
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 4] Deploying control panel to #💻-basic-panel...');
  const panelCh = guild.channels.cache.get(REAL.CH_PANEL_BASIC);
  if (panelCh) {
    const fetched = await panelCh.messages.fetch({ limit: 20 }).catch(() => null);
    if (fetched) {
      for (const msg of fetched.values()) {
        if (msg.author.bot) await msg.delete().catch(() => {});
      }
    }

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('report_submit_btn').setLabel('🚨 Report User').setStyle(ButtonStyle.Danger)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('view_song_queue').setLabel('🎶 Song Queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('get_member_role').setLabel('✅ Get Member Role').setStyle(ButtonStyle.Primary)
    );

    const panelEmbed = new EmbedBuilder()
      .setTitle('🖥️ ZENITSU LIVE — CONTROL PANEL')
      .setDescription(
        '> Welcome to the Official Server Panel!\n\n' +
        '**🎫 Open Ticket** — Open a private support channel with staff.\n' +
        '**🚨 Report User** — Report a member to moderation.\n' +
        '**🎶 Song Queue** — View current waifu song requests.\n' +
        '**✅ Get Member Role** — Verify and get the MEMBER role to access the server.'
      )
      .setColor(0xEDC231)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'ZENITSU LIVE • Powered by NLC BOT' })
      .setTimestamp();

    await panelCh.send({ embeds: [panelEmbed], components: [row1, row2] });
    console.log('  ✅  Panel deployed!');
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 5 — Deploy ticket panel to #ticket-center
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 5] Deploying ticket panel to #ticket-center...');
  const ticketCh = guild.channels.cache.get(REAL.CH_TICKET_CENTER);
  if (ticketCh) {
    const fetched = await ticketCh.messages.fetch({ limit: 20 }).catch(() => null);
    if (fetched) {
      for (const msg of fetched.values()) {
        if (msg.author.bot) await msg.delete().catch(() => {});
      }
    }

    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open').setLabel('🎫 Create Support Ticket').setStyle(ButtonStyle.Success)
    );

    const ticketEmbed = new EmbedBuilder()
      .setTitle('🎫 ZENITSU LIVE — SUPPORT TICKETS')
      .setDescription(
        '> Need help? Click the button below to open a **private ticket** with our staff.\n\n' +
        '**Guidelines:**\n' +
        '• Describe your issue clearly.\n' +
        '• Do not spam or open duplicate tickets.\n' +
        '• Be respectful to staff members.'
      )
      .setColor(0x2ECC71)
      .setFooter({ text: 'ZENITSU LIVE • Support System' })
      .setTimestamp();

    await ticketCh.send({ embeds: [ticketEmbed], components: [ticketRow] });
    console.log('  ✅  Ticket panel deployed!');
  }

  console.log('\n====================================================');
  console.log('🎉 SERVER PROFESSIONALLY CONFIGURED!');
  console.log('====================================================');

  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
