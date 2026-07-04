const {
  Client,
  GatewayIntentBits,
  ChannelType,
} = require('discord.js');
const config = require('./config');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ]
});

function permList(perms) {
  if (!perms) return [];
  return perms.toArray();
}

client.once('ready', async () => {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.error('Guild not found'); process.exit(1); }

  await guild.channels.fetch();
  await guild.roles.fetch();
  await guild.members.fetch();

  const report = {};

  // ── GUILD META ──────────────────────────────────────────────
  report.guild = {
    name: guild.name,
    id: guild.id,
    memberCount: guild.memberCount,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    mfaLevel: guild.mfaLevel,
    premiumTier: guild.premiumTier,
    premiumSubscriptionCount: guild.premiumSubscriptionCount,
    systemChannelId: guild.systemChannelId,
    rulesChannelId: guild.rulesChannelId,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    features: guild.features,
    icon: guild.iconURL(),
  };

  // ── ROLES ────────────────────────────────────────────────────
  report.roles = guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      position: r.position,
      color: r.hexColor,
      hoist: r.hoist,
      mentionable: r.mentionable,
      managed: r.managed,
      permissions: permList(r.permissions),
      memberCount: r.members?.size ?? 0,
      isBot: r.managed,
      tags: r.tags ? { botId: r.tags.botId, premiumSubscriber: r.tags.premiumSubscriberRole } : null,
    }));

  // ── CHANNELS ─────────────────────────────────────────────────
  const allChannels = guild.channels.cache.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  report.categories = [];
  report.uncategorized = [];

  const cats = allChannels.filter(c => c.type === ChannelType.GuildCategory)
    .sort((a,b) => a.rawPosition - b.rawPosition);

  for (const cat of cats.values()) {
    const children = allChannels.filter(c => c.parentId === cat.id)
      .sort((a,b) => a.rawPosition - b.rawPosition);

    const catData = {
      id: cat.id,
      name: cat.name,
      position: cat.rawPosition,
      permissionOverwrites: cat.permissionOverwrites.cache.map(o => ({
        id: o.id,
        type: o.type,
        allow: permList(o.allow),
        deny: permList(o.deny),
      })),
      channels: [],
    };

    for (const ch of children.values()) {
      const chData = {
        id: ch.id,
        name: ch.name,
        type: ChannelType[ch.type] ?? ch.type,
        position: ch.rawPosition,
        topic: ch.topic ?? null,
        nsfw: ch.nsfw ?? false,
        slowmode: ch.rateLimitPerUser ?? 0,
        userLimit: ch.userLimit ?? null,
        lastMessage: ch.lastMessageId ?? null,
        permissionOverwrites: ch.permissionOverwrites?.cache.map(o => ({
          id: o.id,
          type: o.type,
          allow: permList(o.allow),
          deny: permList(o.deny),
        })) ?? [],
      };
      catData.channels.push(chData);
    }

    report.categories.push(catData);
  }

  // Uncategorized
  const noCat = allChannels.filter(c => !c.parentId && c.type !== ChannelType.GuildCategory);
  for (const ch of noCat.values()) {
    report.uncategorized.push({
      id: ch.id,
      name: ch.name,
      type: ChannelType[ch.type] ?? ch.type,
      topic: ch.topic ?? null,
      permissionOverwrites: ch.permissionOverwrites?.cache.map(o => ({
        id: o.id,
        type: o.type,
        allow: permList(o.allow),
        deny: permList(o.deny),
      })) ?? [],
    });
  }

  // ── WEBHOOKS ─────────────────────────────────────────────────
  try {
    const webhooks = await guild.fetchWebhooks();
    report.webhooks = webhooks.map(w => ({
      id: w.id,
      name: w.name,
      channelId: w.channelId,
      type: w.type,
      owner: w.owner?.tag ?? null,
    }));
  } catch { report.webhooks = ['No permission to read webhooks']; }

  // ── EMOJIS ───────────────────────────────────────────────────
  report.emojis = guild.emojis.cache.map(e => ({
    id: e.id,
    name: e.name,
    animated: e.animated,
    managed: e.managed,
  }));

  // ── STICKERS ─────────────────────────────────────────────────
  report.stickers = guild.stickers.cache.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

  // ── BOTS DETECTED ────────────────────────────────────────────
  report.bots = guild.members.cache
    .filter(m => m.user.bot)
    .map(m => ({
      id: m.user.id,
      tag: m.user.tag,
      roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, permissions: permList(r.permissions) })),
    }));

  // ── INVITES ──────────────────────────────────────────────────
  try {
    const invites = await guild.invites.fetch();
    report.invites = invites.map(i => ({
      code: i.code,
      channelName: i.channel?.name,
      uses: i.uses,
      maxUses: i.maxUses,
      inviter: i.inviter?.tag,
      expiresAt: i.expiresAt,
    }));
  } catch { report.invites = ['No permission to read invites']; }

  // ── SAVE ─────────────────────────────────────────────────────
  fs.writeFileSync('./audit-data.json', JSON.stringify(report, null, 2));
  console.log('AUDIT COMPLETE — saved to audit-data.json');
  console.log(`Roles: ${report.roles.length}`);
  console.log(`Categories: ${report.categories.length}`);
  console.log(`Uncategorized channels: ${report.uncategorized.length}`);
  console.log(`Bots detected: ${report.bots.length}`);
  console.log(`Webhooks: ${report.webhooks.length}`);
  console.log(`Emojis: ${report.emojis.length}`);

  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
