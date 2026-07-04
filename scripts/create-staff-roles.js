const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Existing IDs
const EXISTING = {
  ROLE_OWNER:    '1444534470869913752',
  ROLE_CO_OWNER: '1460145933709742203',
  ROLE_CLIENTS:  '1449096942469644480',
  ROLE_MEMBER:   '1444551212904218705',
  ROLE_SAPPHIRE: '1444620237923418146',
  ROLE_NLC_BOT:  '1492731728924770478',
  ROLE_PROTECTME:'1444737238381629473',

  // Staff channels
  CH_ADMIN_CHAT:    '1444549318299095182',
  CH_MOD_REPORTS:   '1444639792846344273',
  CH_PROTECTME_LOG: '1444737239887122635',

  // Categories
  CAT_STAFF:   '1444548713531047986',
  CAT_CLIENTS: '1449099333508141196',
  CAT_COMMUNITY: '1444533393688760413',
  CAT_VOICE:   '1444534096825946153',
};

client.once('ready', async () => {
  log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { log('Guild not found'); process.exit(1); }
  await guild.channels.fetch();
  await guild.roles.fetch();

  const ch  = (id) => guild.channels.cache.get(id);
  const rol = (id) => guild.roles.cache.get(id);

  // ═══════════════════════════════════════════════════════
  // STEP 1 — Create the 3 Staff Roles
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 1: Creating Staff Roles ══════');

  // 🛡️ Admin — position just below CO-OWNER
  const adminRole = await guild.roles.create({
    name: '🛡️ Admin',
    color: 0xFF4444,
    hoist: true,
    mentionable: true,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageNicknames,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageWebhooks,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.MuteMembers,
      PermissionFlagsBits.DeafenMembers,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.MentionEveryone,
      PermissionFlagsBits.UseExternalEmojis,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.UseVAD,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.ManageEvents,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.UseApplicationCommands,
      PermissionFlagsBits.ChangeNickname,
    ],
    reason: 'Professional staff role setup',
  });
  log(`  ✅ Created: 🛡️ Admin (${adminRole.id})`);
  await sleep(500);

  // ⚔️ Moderator — below Admin
  const modRole = await guild.roles.create({
    name: '⚔️ Moderator',
    color: 0x3498DB,
    hoist: true,
    mentionable: true,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.MuteMembers,
      PermissionFlagsBits.DeafenMembers,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.UseExternalEmojis,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.UseVAD,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.UseApplicationCommands,
      PermissionFlagsBits.ChangeNickname,
      PermissionFlagsBits.ManageNicknames,
    ],
    reason: 'Professional staff role setup',
  });
  log(`  ✅ Created: ⚔️ Moderator (${modRole.id})`);
  await sleep(500);

  // 🎧 Support — below Moderator
  const supportRole = await guild.roles.create({
    name: '🎧 Support',
    color: 0x2ECC71,
    hoist: true,
    mentionable: true,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.UseExternalEmojis,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.UseVAD,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.UseApplicationCommands,
      PermissionFlagsBits.ChangeNickname,
    ],
    reason: 'Professional staff role setup',
  });
  log(`  ✅ Created: 🎧 Support (${supportRole.id})`);
  await sleep(500);

  // ═══════════════════════════════════════════════════════
  // STEP 2 — Position Roles in Correct Order
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 2: Setting role positions ══════');

  const coOwner = rol(EXISTING.ROLE_CO_OWNER);
  const clients = rol(EXISTING.ROLE_CLIENTS);

  if (coOwner && clients) {
    // Place Admin just below CO-OWNER, Mod below Admin, Support below Mod
    // CO-OWNER is at position 21
    // We set: Admin=20→below CO-OWNER, Mod=19→below Admin, Support=18→below Mod
    // But since managed roles exist in between, we use setPositions
    await guild.roles.setPositions([
      { role: adminRole.id,   position: coOwner.position - 1 },
      { role: modRole.id,     position: coOwner.position - 2 },
      { role: supportRole.id, position: coOwner.position - 3 },
    ]).catch(e => log(`  ⚠️  Position set warning: ${e.message}`));
    log('  ✅ Roles positioned in hierarchy');
  }
  await sleep(600);

  // ═══════════════════════════════════════════════════════
  // STEP 3 — Give Staff Access to STAFF Category Channels
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 3: Wiring staff roles to STAFF channels ══════');

  const SAPPH   = EXISTING.ROLE_SAPPHIRE;
  const NLCBOT  = EXISTING.ROLE_NLC_BOT;
  const PROTECT = EXISTING.ROLE_PROTECTME;
  const EVERYONE = guild.id;

  const setPerms = async (chanId, overwrites, label) => {
    const channel = ch(chanId);
    if (!channel) { log(`  ⚠️  Not found: ${label}`); return; }
    try {
      await channel.permissionOverwrites.set(overwrites, 'Staff role separation');
      log(`  ✅ ${label}`);
    } catch (e) {
      log(`  ❌ ${label} — ${e.message}`);
    }
    await sleep(500);
  };

  // admin-chat — Owner + Admin only
  await setPerms(EXISTING.CH_ADMIN_CHAT, [
    { id: EVERYONE,          deny:  [PermissionFlagsBits.ViewChannel] },
    { id: EXISTING.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    { id: adminRole.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    { id: SAPPH,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: NLCBOT,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ], 'admin-chat → Owner + Admin only');

  // mod-reports — Owner + Admin + Moderator
  await setPerms(EXISTING.CH_MOD_REPORTS, [
    { id: EVERYONE,          deny:  [PermissionFlagsBits.ViewChannel] },
    { id: EXISTING.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    { id: adminRole.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    { id: modRole.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: SAPPH,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: NLCBOT,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ], 'mod-reports → Owner + Admin + Mod');

  // protectme-logs — All staff can see (Support too — helps them monitor)
  await setPerms(EXISTING.CH_PROTECTME_LOG, [
    { id: EVERYONE,          deny:  [PermissionFlagsBits.ViewChannel] },
    { id: EXISTING.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: adminRole.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: modRole.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: supportRole.id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: PROTECT,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: NLCBOT,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ], 'protectme-logs → All staff can read');

  // ═══════════════════════════════════════════════════════
  // STEP 4 — Give Support Role access to ticket channels
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 4: Support role ticket access ══════');

  // Support can see ticket-center and interact with ticket panels
  const ticketCenter = ch('1444538212583473162');
  if (ticketCenter) {
    await ticketCenter.permissionOverwrites.edit(supportRole.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
    }).catch(e => log(`  ⚠️  ticket-center support: ${e.message}`));
    log('  ✅ Support → ticket-center access granted');
    await sleep(500);
  }

  // ═══════════════════════════════════════════════════════
  // STEP 5 — Update STAFF Category to include all 3 roles
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 5: Update STAFF category permissions ══════');

  const staffCat = ch(EXISTING.CAT_STAFF);
  if (staffCat) {
    await staffCat.permissionOverwrites.set([
      { id: EVERYONE,          deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      { id: EXISTING.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: adminRole.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: modRole.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: supportRole.id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      { id: SAPPH,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: NLCBOT,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: PROTECT,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ], 'Staff role separation');
    log('  ✅ 👑 STAFF category — all 3 staff roles wired in');
    await sleep(500);
  }

  // ═══════════════════════════════════════════════════════
  // STEP 6 — Confirm CLIENTS category stays separate
  // ═══════════════════════════════════════════════════════
  log('\n══════ STEP 6: Confirm CLIENTS separation ══════');

  const clientsCat = ch(EXISTING.CAT_CLIENTS);
  if (clientsCat) {
    await clientsCat.permissionOverwrites.set([
      { id: EVERYONE,          deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      { id: EXISTING.ROLE_MEMBER, deny: [PermissionFlagsBits.ViewChannel] },
      { id: EXISTING.ROLE_CLIENTS, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream] },
      { id: adminRole.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: modRole.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: EXISTING.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: SAPPH,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      { id: NLCBOT,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ], 'Staff + Clients separation');
    log('  ✅ ✨ CLIENTS category — staff can monitor, clients access, members blocked');
    await sleep(500);
  }

  // ═══════════════════════════════════════════════════════
  log('\n══════════════════════════════════════════════════════');
  log('🎉 STAFF & CLIENT SEPARATION COMPLETE!');
  log('══════════════════════════════════════════════════════');
  log(`  🛡️  Admin role ID:     ${adminRole.id}`);
  log(`  ⚔️  Moderator role ID: ${modRole.id}`);
  log(`  🎧  Support role ID:   ${supportRole.id}`);
  log('');
  log('Role Hierarchy:');
  log('  👑 [OWNER]     → Full server control');
  log('  🔴 CO-OWNER    → Near-full control');
  log('  🛡️  Admin       → Manage server + ban/kick');
  log('  ⚔️  Moderator   → Moderate + ban/kick');
  log('  🎧  Support     → View tickets + help members');
  log('  ────────────────────────────────────');
  log('  💜 CLIENTS✨   → Paying customers (separate)');
  log('  🟠 MEMBER      → Verified community');
  log('  ⚫ @everyone   → Public browsing only');

  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => {
  log(`Login failed: ${err.message}`);
  process.exit(1);
});
