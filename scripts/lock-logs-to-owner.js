/**
 * lock-logs-to-owner.js
 * 
 * Configures channel permission overwrites on all log channels:
 * - Allows Owner role to Manage Messages (delete).
 * - Denies Admin, Mod, and Support roles from managing/deleting messages in log channels.
 */

'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const ID = {
  // Roles
  ADMIN_ROLE:    '1521573583766294728',
  MOD_ROLE:      '1521573587859800204',
  SUPPORT_ROLE:  '1521573594251923456',
  OWNER_ROLE:    '1444534470869913752',

  // Log channels
  SERVER_LOGS:   '1521577044687847464',
  VOICE_LOG:     '1521577051516047573',
  MOD_LOG:       '1521577060689248519',
  MESSAGE_LOG:   '1521935264426229793'
};

client.once('clientReady', async () => {
  console.log('🔒 SECURING LOG CHANNELS TO OWNER ONLY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error('❌ Guild not found!');
    process.exit(1);
  }

  const logChannelIds = [ID.SERVER_LOGS, ID.VOICE_LOG, ID.MOD_LOG, ID.MESSAGE_LOG];

  for (const id of logChannelIds) {
    const ch = guild.channels.cache.get(id);
    if (!ch) {
      console.log(`⚠️ Channel ${id} not found in server.`);
      continue;
    }

    try {
      console.log(`🔒 Configuring permissions for #${ch.name}...`);

      // Edit permission overwrites:
      // - Everyone: View Denied
      // - Owner: View Allowed, Send/Manage Messages Allowed
      // - Admin/Mod/Support: View Allowed, Manage Messages Denied
      await ch.permissionOverwrites.set([
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: ID.OWNER_ROLE,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages // Owner can delete logs
          ]
        },
        {
          id: ID.ADMIN_ROLE,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ],
          deny: [
            PermissionFlagsBits.ManageMessages // Admin cannot delete logs
          ]
        },
        {
          id: ID.MOD_ROLE,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ],
          deny: [
            PermissionFlagsBits.ManageMessages // Mod cannot delete logs
          ]
        },
        {
          id: ID.SUPPORT_ROLE,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ],
          deny: [
            PermissionFlagsBits.ManageMessages // Support cannot delete logs
          ]
        }
      ]);

      console.log(`✅ #${ch.name} locked down successfully.`);

    } catch (err) {
      console.error(`❌ Failed to secure #${ch.name}:`, err.message);
    }
  }

  console.log('\n🔒 Log channels secured! Only Owner has permission to delete logs.');
  process.exit(0);
});

client.login(config.token);
