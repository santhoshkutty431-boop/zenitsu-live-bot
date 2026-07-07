/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           TEMPORARY PUNISHMENT SCHEDULER                     ║
 * ║           modules/auto-punish.js                             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * On bot startup, automatically reverts expired temp bans and mutes.
 * Runs a recurring check every 60 seconds for newly-expired punishments.
 */

'use strict';

const { getExpiredCases, closeCase, CaseType } = require('./case-manager');
const { EmbedBuilder } = require('discord.js');

// ─── PROCESS EXPIRED CASES ──────────────────────────────────────────────────

/**
 * Process a single expired case — unban or unmute the user.
 * @param {import('discord.js').Client} client
 * @param {object} db
 * @param {function} saveDb
 * @param {function} logToChannel - logging helper
 * @param {object} ID - channel ID constants
 * @param {object} caseData
 */
async function processExpiredCase(client, db, saveDb, logToChannel, ID, caseData) {
  const guild = client.guilds.cache.get(caseData.guildId);
  if (!guild) return;

  try {
    if (caseData.type === CaseType.TEMPBAN) {
      // Unban the user
      await guild.members.unban(caseData.userId, `Temporary ban expired (${caseData.caseId})`).catch(() => {});
      closeCase(db, saveDb, caseData.caseId);

      const embed = new EmbedBuilder()
        .setTitle('✅ Temporary Ban Expired — Auto Unban')
        .setDescription(`**User:** <@${caseData.userId}> (${caseData.userTag})\n**Original Case:** ${caseData.caseId}\n**Ban Reason:** ${caseData.reason}`)
        .setColor(0x2ECC71)
        .setFooter({ text: 'Auto-punishment system' })
        .setTimestamp();
      await logToChannel(guild, ID.MOD_LOG, embed);

    } else if (caseData.type === CaseType.MUTE) {
      // Remove Muted role
      const member = await guild.members.fetch(caseData.userId).catch(() => null);
      if (member) {
        const mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
        if (mutedRole) await member.roles.remove(mutedRole, `Temporary mute expired (${caseData.caseId})`).catch(() => {});
      }
      closeCase(db, saveDb, caseData.caseId);

      const embed = new EmbedBuilder()
        .setTitle('🔊 Temporary Mute Expired — Auto Unmute')
        .setDescription(`**User:** <@${caseData.userId}> (${caseData.userTag})\n**Original Case:** ${caseData.caseId}`)
        .setColor(0x9B59B6)
        .setFooter({ text: 'Auto-punishment system' })
        .setTimestamp();
      await logToChannel(guild, ID.MOD_LOG, embed);
    }

    console.log(`[AutoPunish] Processed expired case ${caseData.caseId} (${caseData.type}) for ${caseData.userTag}`);
  } catch (err) {
    console.error(`[AutoPunish] Error processing case ${caseData.caseId}:`, err.message);
  }
}

// ─── SCHEDULER ──────────────────────────────────────────────────────────────

/**
 * Start the auto-punishment expiry scheduler.
 * - Immediately processes any already-expired cases on startup.
 * - Then checks every 60 seconds for newly-expired cases.
 *
 * @param {import('discord.js').Client} client
 * @param {object} db
 * @param {function} saveDb
 * @param {function} logToChannel
 * @param {object} ID
 */
function startAutoPunishScheduler(client, db, saveDb, logToChannel, ID) {
  const check = async () => {
    // Process pending DM deletions globally every interval check
    try {
      const { processPendingDmDeletions } = require('./dm-manager');
      await processPendingDmDeletions(client);
    } catch (dmErr) {
      console.error('[AutoDelete] DM deletion check error:', dmErr.message);
    }

    if (!global.asyncLocalStorage) return;

    for (const guild of client.guilds.cache.values()) {
      await global.asyncLocalStorage.run({ guildId: guild.id }, async () => {
        const expired = getExpiredCases(db);
        if (expired.length > 0) {
          console.log(`[AutoPunish] [Guild: ${guild.name} (${guild.id})] Processing ${expired.length} expired punishment(s)…`);
          for (const c of expired) {
            await processExpiredCase(client, db, saveDb, logToChannel, ID, c);
          }
        }
      });
    }
  };

  // Run immediately on startup
  check().catch(err => console.error('[AutoPunish] Startup check error:', err.message));

  // Run every 60 seconds
  setInterval(() => {
    check().catch(err => console.error('[AutoPunish] Interval check error:', err.message));
  }, 60_000);

  console.log('⚙️  Auto-punishment scheduler started.');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = { startAutoPunishScheduler };
