const { PermissionFlagsBits } = require('discord.js');

async function executeAiAction(interaction, responseText, runtime, db, ID, logToChannel, isDeveloper, isOwner, staffCheck) {
  const match = responseText.match(/\|\|ACTION:(.*?)\|\|/);
  if (!match) {
    return { cleanText: responseText };
  }

  const cleanText = responseText.replace(/\|\|ACTION:(.*?)\|\|/, '').trim();
  const actionJson = match[1].trim();

  // Parse JSON
  let action;
  try {
    action = JSON.parse(actionJson);
  } catch (err) {
    console.error('[AI ACTION] Failed to parse action JSON:', err);
    return { cleanText, error: 'Invalid action format.' };
  }

  console.log('[AI ACTION] Parsed action:', action);

  // Authorization check (ONLY Owner, Developer, or Whitelisted users can trigger actions via AI)
  const guildId = interaction.guildId;
  const guildWhitelist = db.guildWhitelists && db.guildWhitelists[guildId] ? db.guildWhitelists[guildId] : null;
  const isWhitelistedUser = (guildWhitelist && guildWhitelist.users && guildWhitelist.users[interaction.user.id]) ||
                            (db.roleWhitelist && db.roleWhitelist.includes(interaction.user.id));

  const isAuthorized = isOwner(interaction.user.id) || 
                       isDeveloper(interaction.user.id) || 
                       isWhitelistedUser;

  if (!isAuthorized) {
    return { cleanText: cleanText + '\n⚠️ *Action blocked: Only the Owner, Developer, or Whitelisted users are authorized to perform actions via AI.*' };
  }

  try {
    const guild = interaction.guild;
    if (!guild) return { cleanText: cleanText + '\n⚠️ *Action failed: Not in a server.*' };

    switch (action.type) {
      case 'mute': {
        const member = await guild.members.fetch(action.userId).catch(() => null);
        if (!member) return { cleanText: cleanText + `\n⚠️ *Action failed: User not found.*` };
        const durationMs = (action.durationMinutes || 10) * 60_000;
        await member.timeout(durationMs, action.reason || 'Muted by ZENITSU AI').catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Timed out <@${action.userId}> for ${action.durationMinutes || 10} minutes.**` };
      }
      case 'unmute': {
        const member = await guild.members.fetch(action.userId).catch(() => null);
        if (!member) return { cleanText: cleanText + `\n⚠️ *Action failed: User not found.*` };
        await member.timeout(null, 'Timeout removed by ZENITSU AI').catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Removed timeout for <@${action.userId}>.**` };
      }
      case 'kick': {
        const member = await guild.members.fetch(action.userId).catch(() => null);
        if (!member) return { cleanText: cleanText + `\n⚠️ *Action failed: User not found.*` };
        await member.kick(action.reason || 'Kicked by ZENITSU AI').catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Kicked <@${action.userId}> from the server.**` };
      }
      case 'ban': {
        await guild.members.ban(action.userId, { reason: action.reason || 'Banned by ZENITSU AI' }).catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Banned user ID ${action.userId} from the server.**` };
      }
      case 'unban': {
        await guild.members.unban(action.userId, 'Unbanned by ZENITSU AI').catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Unbanned user ID ${action.userId}.**` };
      }
      case 'purge': {
        const channel = interaction.channel;
        const count = Math.min(Math.max(parseInt(action.count, 10) || 1, 1), 100);
        await channel.bulkDelete(count, true).catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Purged ${count} messages in this channel.**` };
      }
      case 'lock': {
        const channel = interaction.channel;
        await channel.permissionOverwrites.edit(guild.id, { SendMessages: false }).catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Channel Locked.**` };
      }
      case 'unlock': {
        const channel = interaction.channel;
        await channel.permissionOverwrites.edit(guild.id, { SendMessages: null }).catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Channel Unlocked.**` };
      }
      case 'slowmode': {
        const channel = interaction.channel;
        const secs = parseInt(action.seconds, 10) || 0;
        await channel.setRateLimitPerUser(secs, 'Slowmode updated by ZENITSU AI').catch(e => { throw e; });
        return { cleanText: cleanText + `\n✅ **Slowmode set to ${secs}s.**` };
      }
      case 'warn': {
        const caseManager = require('./case-manager');
        const reason = action.reason || 'Warned by ZENITSU AI';
        const user = await interaction.client.users.fetch(action.userId).catch(() => null);
        if (!user) return { cleanText: cleanText + `\n⚠️ *Action failed: User not found.*` };
        const newCase = caseManager.createCase(db, {
          guildId: guild.id,
          userId: action.userId,
          userTag: user.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Warning',
          reason
        });
        return { cleanText: cleanText + `\n✅ **Warned <@${action.userId}> (Case #${newCase.caseId}).**` };
      }
      default:
        return { cleanText: cleanText + `\n⚠️ *Unknown action type: ${action.type}*` };
    }
  } catch (err) {
    console.error('[AI ACTION EXECUTION ERROR]', err);
    return { cleanText: cleanText + `\n❌ *Failed to execute action: ${err.message || err}*` };
  }
}

module.exports = { executeAiAction };
