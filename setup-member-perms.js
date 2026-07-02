/**
 * setup-member-perms.js
 * 
 * Applies correct permission overwrites for the MEMBER role:
 *  - #general + #feedback  → can send messages
 *  - Voice channels        → can connect + speak
 *  - All other channels    → view + read history only (NO send)
 *  - Private channels      → completely hidden (no access)
 *
 * Run once: node setup-member-perms.js
 */

'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const GUILD_ID      = config.guildId;
const MEMBER_ROLE   = '1444551212904218705';  // Member role

// Channels where members CAN send messages
const SEND_ALLOWED_IDS = [
  '1521944260616781889',  // #💬┆general-chat
  '1445744625607507980',  // #📸┆feedback
];

// Keywords that mark a channel/category as PRIVATE (no access for members)
const PRIVATE_KEYWORDS = ['private', 'staff', 'admin', 'mod-only', 'internal', 'server-log', 'server_log', 'mod-log', 'mod_log', 'voice-log', 'audit', 'message-log'];

// Channel IDs that are always private (logs etc.)
const ALWAYS_PRIVATE_IDS = [];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isPrivateChannel(channel) {
  const name = (channel.name || '').toLowerCase();
  const parentName = (channel.parent?.name || '').toLowerCase();

  // Check by name keywords
  if (PRIVATE_KEYWORDS.some(kw => name.includes(kw))) return true;
  if (PRIVATE_KEYWORDS.some(kw => parentName.includes(kw))) return true;

  // Explicitly listed IDs
  if (ALWAYS_PRIVATE_IDS.includes(channel.id)) return true;

  return false;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log('🔧 Setting up Member role permissions...\n');

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error('❌ Guild not found!'); process.exit(1); }

  await guild.channels.fetch();
  const role = guild.roles.cache.get(MEMBER_ROLE);
  if (!role) { console.error('❌ Member role not found!'); process.exit(1); }

  console.log(`🏷️  Role: ${role.name} (${role.id})`);
  console.log(`📊 Total channels: ${guild.channels.cache.size}\n`);

  let sent = 0, readOnly = 0, hidden = 0, voice = 0, skipped = 0;

  for (const [, channel] of guild.channels.cache) {
    try {
      // ── CATEGORY: skip (categories inherit from role) ──────────────────────
      if (channel.type === ChannelType.GuildCategory) {
        continue;
      }

      // ── VOICE / STAGE CHANNELS ─────────────────────────────────────────────
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        if (isPrivateChannel(channel)) {
          // Private VC — hide completely
          await channel.permissionOverwrites.edit(role, {
            ViewChannel: false,
            Connect:     false,
          }, { reason: 'Member perm setup: private VC' });
          console.log(`  🔒 [HIDDEN-VC]    #${channel.name}`);
          hidden++;
        } else {
          // Normal VC — members can connect & speak
          await channel.permissionOverwrites.edit(role, {
            ViewChannel:  true,
            Connect:      true,
            Speak:        true,
            Stream:       false,  // No screen share for members
            SendMessages: true,   // Text-in-VC
          }, { reason: 'Member perm setup: voice channel' });
          console.log(`  🔊 [VOICE]        #${channel.name}`);
          voice++;
        }
        continue;
      }

      // ── TEXT CHANNELS ──────────────────────────────────────────────────────
      if (isPrivateChannel(channel)) {
        // Private — no access at all
        await channel.permissionOverwrites.edit(role, {
          ViewChannel:      false,
          SendMessages:     false,
          ReadMessageHistory: false,
        }, { reason: 'Member perm setup: private channel' });
        console.log(`  🔒 [HIDDEN]       #${channel.name}`);
        hidden++;

      } else if (SEND_ALLOWED_IDS.includes(channel.id)) {
        // General / Feedback — full chat access
        await channel.permissionOverwrites.edit(role, {
          ViewChannel:        true,
          ReadMessageHistory: true,
          SendMessages:       true,
          AddReactions:       true,
          AttachFiles:        true,
          EmbedLinks:         true,
          UseExternalEmojis:  true,
        }, { reason: 'Member perm setup: chat channel' });
        console.log(`  ✅ [SEND]         #${channel.name}`);
        sent++;

      } else {
        // All other channels — read only
        await channel.permissionOverwrites.edit(role, {
          ViewChannel:        true,
          ReadMessageHistory: true,
          SendMessages:       false,
          AddReactions:       false,
          AttachFiles:        false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        }, { reason: 'Member perm setup: read-only channel' });
        console.log(`  👁️  [READ-ONLY]    #${channel.name}`);
        readOnly++;
      }

      // Small delay to avoid hitting Discord rate limits
      await new Promise(r => setTimeout(r, 350));

    } catch (err) {
      console.warn(`  ⚠️  SKIPPED #${channel.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log('✅ MEMBER PERMISSION SETUP COMPLETE');
  console.log('══════════════════════════════════════════');
  console.log(`  ✅ Send allowed : ${sent} channels`);
  console.log(`  👁️  Read-only   : ${readOnly} channels`);
  console.log(`  🔊 Voice        : ${voice} channels`);
  console.log(`  🔒 Hidden       : ${hidden} channels`);
  console.log(`  ⚠️  Skipped     : ${skipped} channels`);
  console.log('══════════════════════════════════════════\n');

  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('❌ Login failed:', err.message);
  process.exit(1);
});
