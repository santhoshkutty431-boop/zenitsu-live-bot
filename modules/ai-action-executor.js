const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const PENDING_AUTOMATIONS = new Map();

async function executeAiAction(interaction, responseText, runtime, db, saveDb, ID, logToChannel, isDeveloper, isOwner, staffCheck) {
  // Check for immediate moderation actions first
  const match = responseText.match(/\|\|ACTION:(.*?)\|\|/);
  if (match) {
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

    // Authorization check (ONLY Owner, Developer, or Whitelisted users with AI_ACTIONS capability can trigger actions via AI)
    const guildId = interaction.guildId;
    const guildWhitelist = db.guildWhitelists && db.guildWhitelists[guildId] ? db.guildWhitelists[guildId] : null;
    const isWhitelistedUserWithAiActions = 
      (guildWhitelist && guildWhitelist.users && guildWhitelist.users[interaction.user.id] && guildWhitelist.users[interaction.user.id].includes('AI_ACTIONS')) ||
      (db.roleWhitelist && db.roleWhitelist.includes(interaction.user.id));

    const isAuthorized = isOwner(interaction.user.id) || 
                         isDeveloper(interaction.user.id) || 
                         isWhitelistedUserWithAiActions;

    if (!isAuthorized) {
      return { cleanText: cleanText + '\n⚠️ *Action blocked: Only the Owner, Developer, or Whitelisted users with the AI_ACTIONS capability are authorized to perform actions via AI.*' };
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
          const newCase = caseManager.createCase(db, saveDb, {
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
        case 'play': {
          const query = action.song;
          if (!query) return { cleanText: cleanText + `\n⚠️ *Action failed: No song query provided.*` };
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) return { cleanText: cleanText + `\n⚠️ *Action failed: You must be in a voice channel to request music!*` };

          const pluginMgr = runtime.getService('PluginManager');
          const musicPlugin = pluginMgr ? pluginMgr.getPlugin('music') : null;
          if (!musicPlugin) return { cleanText: cleanText + `\n⚠️ *Action failed: Music system is not available.*` };

          const track = await musicPlugin.resolveTrack(query);
          if (!track) return { cleanText: cleanText + `\n❌ *No results found for:* **${query}**` };

          const guildPlayer = await musicPlugin.getOrCreatePlayer(voiceChannel);
          const playerState = db.guildWhitelists?.[guild.id] || db;
          const currentMusicPlayer = db.getMusicPlayer ? db.getMusicPlayer(guild.id) : null;
          
          const playerStateObj = currentMusicPlayer || {
            guildId: guild.id,
            currentSong: null,
            isPaused: false,
            loopMode: 'off',
            volume: 100,
            positionSec: 0,
            durationSec: 0,
            queue: [],
            setupChannelId: null,
            setupMessageId: null
          };

          const isPlaying = guildPlayer.audioPlayer.state.status === 'playing';
          if (!isPlaying && !playerStateObj.currentSong) {
            await musicPlugin.playTrack(guild.id, track);
            return { cleanText: cleanText + `\n💿 **Now playing:** **${track.title}**` };
          } else {
            playerStateObj.queue.push(track);
            const dbMgr = runtime.getService('DatabaseManager');
            if (dbMgr && dbMgr.saveMusicPlayer) {
              dbMgr.saveMusicPlayer(playerStateObj);
            }
            await musicPlugin.updateControllerMessage(playerStateObj);
            return { cleanText: cleanText + `\n✅ **Added to queue:** **${track.title}**` };
          }
        }
        case 'skip': {
          const pluginMgr = runtime.getService('PluginManager');
          const musicPlugin = pluginMgr ? pluginMgr.getPlugin('music') : null;
          if (!musicPlugin) return { cleanText: cleanText + `\n⚠️ *Action failed: Music system is not available.*` };
          const active = musicPlugin.activePlayers.get(guild.id);
          if (!active) return { cleanText: cleanText + `\n⚠️ *Action failed: Bot is not currently playing music.*` };
          await musicPlugin.handleTrackEnd(guild.id);
          return { cleanText: cleanText + `\n⏭️ **Track skipped.**` };
        }
        case 'pause': {
          const pluginMgr = runtime.getService('PluginManager');
          const musicPlugin = pluginMgr ? pluginMgr.getPlugin('music') : null;
          if (!musicPlugin) return { cleanText: cleanText + `\n⚠️ *Action failed: Music system is not available.*` };
          const active = musicPlugin.activePlayers.get(guild.id);
          if (!active) return { cleanText: cleanText + `\n⚠️ *Action failed: Bot is not currently playing music.*` };
          active.audioPlayer.pause();
          const stateObj = musicPlugin.dbService.getMusicPlayer(guild.id);
          if (stateObj) {
            stateObj.isPaused = true;
            musicPlugin.dbService.saveMusicPlayer(stateObj);
            await musicPlugin.updateControllerMessage(stateObj);
          }
          return { cleanText: cleanText + `\n⏸️ **Playback paused.**` };
        }
        case 'resume': {
          const pluginMgr = runtime.getService('PluginManager');
          const musicPlugin = pluginMgr ? pluginMgr.getPlugin('music') : null;
          if (!musicPlugin) return { cleanText: cleanText + `\n⚠️ *Action failed: Music system is not available.*` };
          const active = musicPlugin.activePlayers.get(guild.id);
          if (!active) return { cleanText: cleanText + `\n⚠️ *Action failed: Bot is not currently playing music.*` };
          active.audioPlayer.unpause();
          const stateObj = musicPlugin.dbService.getMusicPlayer(guild.id);
          if (stateObj) {
            stateObj.isPaused = false;
            musicPlugin.dbService.saveMusicPlayer(stateObj);
            await musicPlugin.updateControllerMessage(stateObj);
          }
          return { cleanText: cleanText + `\n▶️ **Playback resumed.**` };
        }
        case 'stop': {
          const pluginMgr = runtime.getService('PluginManager');
          const musicPlugin = pluginMgr ? pluginMgr.getPlugin('music') : null;
          if (!musicPlugin) return { cleanText: cleanText + `\n⚠️ *Action failed: Music system is not available.*` };
          musicPlugin.cleanupPlayer(guild.id);
          return { cleanText: cleanText + `\n🛑 **Music stopped and bot disconnected.**` };
        }
        case 'start_trivia': {
          const games = require('./games');
          const promptMsg = games.startTrivia(interaction.channelId, interaction.user);
          return { cleanText: cleanText + `\n\n${promptMsg}` };
        }
        case 'server_analytics': {
          const totalMembers = guild.memberCount || 0;
          const textChannels = guild.channels.cache.filter(c => c.type === 0).size;
          const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
          const rolesCount = guild.roles.cache.size;

          const dbMgr = runtime.getService('DatabaseManager');
          const guildDb = dbMgr ? dbMgr.getGuildDb(guild.id) : null;
          const totalCases = guildDb && guildDb.cases ? guildDb.cases.length : 0;
          const totalWarnings = guildDb && guildDb.warnings ? Object.keys(guildDb.warnings).length : 0;

          const statsEmbed = new EmbedBuilder()
            .setTitle(`📊 Server Analytics — ${guild.name}`)
            .setColor(0x00D4FF)
            .addFields(
              { name: '👥 Total Members', value: `\`${totalMembers}\``, inline: true },
              { name: '💬 Text Channels', value: `\`${textChannels}\``, inline: true },
              { name: '🔊 Voice Channels', value: `\`${voiceChannels}\``, inline: true },
              { name: '🛡️ Roles Configured', value: `\`${rolesCount}\``, inline: true },
              { name: '🚨 Total Mod Cases', value: `\`${totalCases}\``, inline: true },
              { name: '⚠️ Warning Count', value: `\`${totalWarnings}\``, inline: true }
            )
            .setFooter({ text: 'ZENITSU AI Analytics Engine' })
            .setTimestamp();

          await interaction.channel.send({ embeds: [statsEmbed] }).catch(() => {});
          return { cleanText: cleanText + `\n✅ **Server analytics embed generated.**` };
        }
        default:
          return { cleanText: cleanText + `\n⚠️ *Unknown action type: ${action.type}*` };
      }
    } catch (err) {
      console.error('[AI ACTION EXECUTION ERROR]', err);
      return { cleanText: cleanText + `\n❌ *Failed to execute action: ${err.message || err}*` };
    }
  }

  // Check for automation confirmation requests next
  const confirmMatch = responseText.match(/\|\|CONFIRM_ACTION:(.*?)\|\|/);
  if (confirmMatch) {
    const cleanText = responseText.replace(/\|\|CONFIRM_ACTION:(.*?)\|\|/, '').trim();
    const actionJson = confirmMatch[1].trim();

    // Parse JSON
    let action;
    try {
      action = JSON.parse(actionJson);
    } catch (err) {
      console.error('[AI AUTOMATION] Failed to parse action JSON:', err);
      return { cleanText, error: 'Invalid automation format.' };
    }

    console.log('[AI AUTOMATION] Parsed action:', action);

    const guildId = interaction.guildId;
    const guildWhitelist = db.guildWhitelists && db.guildWhitelists[guildId] ? db.guildWhitelists[guildId] : null;
    const isWhitelistedUserWithAiAutomation = 
      (guildWhitelist && guildWhitelist.users && guildWhitelist.users[interaction.user.id] && guildWhitelist.users[interaction.user.id].includes('AI_AUTOMATION')) ||
      (db.roleWhitelist && db.roleWhitelist.includes(interaction.user.id));

    // Only Owner and Developer can execute create_guild or setup_server_template actions
    const isSpecialAction = action.type === 'create_guild' || action.type === 'setup_server_template';
    const isAuthorized = isOwner(interaction.user.id) || isDeveloper(interaction.user.id) || (!isSpecialAction && isWhitelistedUserWithAiAutomation);

    if (!isAuthorized) {
      const errMsg = isSpecialAction 
        ? '\n⚠️ *Automation blocked: Only the Owner or Developer are authorized to create new servers or set up templates.*'
        : '\n⚠️ *Automation blocked: Only the Owner, Developer, or Whitelisted users with the AI_AUTOMATION capability are authorized to trigger automations.*';
      return { cleanText: cleanText + errMsg };
    }

    const actionId = Math.random().toString(36).substring(2, 8);
    PENDING_AUTOMATIONS.set(actionId, {
      action,
      userId: interaction.user.id,
      guildId: interaction.guildId
    });

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_confirm_auto_${actionId}`).setLabel('🟢 Confirm Automation').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ai_cancel_auto_${actionId}`).setLabel('🔴 Cancel').setStyle(ButtonStyle.Danger)
    );

    const jsonPreview = JSON.stringify(action, null, 2);
    const confirmText = `⚠️ **Pending Automation Request**:\n\`\`\`json\n${jsonPreview.slice(0, 700)}${jsonPreview.length > 700 ? '\n...(truncated)' : ''}\n\`\`\``.slice(0, 1024);

    return {
      cleanText,
      hasConfirmation: true,
      confirmRow,
      confirmText
    };
  }

  return { cleanText: responseText };
}

async function handleAiConfirmClick(interaction, actionId, runtime, db, saveDb, isDeveloper, isOwner) {
  const pending = PENDING_AUTOMATIONS.get(actionId);
  if (!pending) {
    return interaction.reply({ content: '⚠️ This automation request has expired or is invalid.', ephemeral: true });
  }

  // Double check authorization on button click
  const guildId = interaction.guildId;
  const guildWhitelist = db.guildWhitelists && db.guildWhitelists[guildId] ? db.guildWhitelists[guildId] : null;
  const isWhitelistedUserWithAiAutomation = 
    (guildWhitelist && guildWhitelist.users && guildWhitelist.users[interaction.user.id] && guildWhitelist.users[interaction.user.id].includes('AI_AUTOMATION')) ||
    (db.roleWhitelist && db.roleWhitelist.includes(interaction.user.id));

  // Only Owner and Developer can execute create_guild or setup_server_template actions
  const isSpecialAction = action.type === 'create_guild' || action.type === 'setup_server_template';
  const isAuthorized = isOwner(interaction.user.id) || isDeveloper(interaction.user.id) || (!isSpecialAction && isWhitelistedUserWithAiAutomation);

  if (!isAuthorized) {
    return interaction.reply({ content: '❌ You are not authorized to approve this automation.', ephemeral: true });
  }

  await interaction.deferUpdate();

  const { action } = pending;
  const guild = interaction.guild;

  try {
    let resultMessage = '';

    switch (action.type) {
      case 'create_channel': {
        const typeMap = { text: 0, voice: 2 };
        const chType = typeMap[action.channelType] || 0;
        
        let parent = null;
        if (action.categoryName) {
          parent = guild.channels.cache.find(c => c.name.toLowerCase() === action.categoryName.toLowerCase() && c.type === 4);
        }

        const channel = await guild.channels.create({
          name: action.name,
          type: chType,
          parent: parent ? parent.id : null
        });
        resultMessage = `✅ **Created ${action.channelType || 'text'} channel ${channel} under category '${action.categoryName || 'None'}'.**`;
        break;
      }
      case 'delete_channel': {
        const channel = guild.channels.cache.get(action.channelId);
        if (!channel) throw new Error('Channel not found.');
        await channel.delete();
        resultMessage = `✅ **Deleted channel ID ${action.channelId} (formerly #${channel.name}).**`;
        break;
      }
      case 'rename_channel': {
        const channel = guild.channels.cache.get(action.channelId);
        if (!channel) throw new Error('Channel not found.');
        const oldName = channel.name;
        await channel.setName(action.newName);
        resultMessage = `✅ **Renamed channel #${oldName} to #${action.newName}.**`;
        break;
      }
      case 'set_topic': {
        const channel = guild.channels.cache.get(action.channelId);
        if (!channel) throw new Error('Channel not found.');
        await channel.setTopic(action.topic);
        resultMessage = `✅ **Set topic for #${channel.name} to: "${action.topic}".**`;
        break;
      }
      case 'create_role': {
        const role = await guild.roles.create({
          name: action.name,
          color: action.color || null,
          reason: 'Created by ZENITSU AI Automation'
        });
        resultMessage = `✅ **Created role ${role} with color ${action.color || 'default'}.**`;
        break;
      }
      case 'delete_role': {
        const role = guild.roles.cache.get(action.roleId);
        if (!role) throw new Error('Role not found.');
        await role.delete();
        resultMessage = `✅ **Deleted role ID ${action.roleId} (formerly @${role.name}).**`;
        break;
      }
      case 'set_status': {
        const typeMap = { PLAYING: 0, STREAMING: 1, LISTENING: 2, WATCHING: 3 };
        const actType = typeMap[action.activityType] || 0;
        interaction.client.user.setActivity(action.statusText, { type: actType });
        resultMessage = `✅ **Updated bot activity status to: "${action.statusText}".**`;
        break;
      }
      case 'dm_user': {
        const user = await interaction.client.users.fetch(action.userId);
        await user.send(action.message);
        resultMessage = `✅ **Sent DM to ${user.tag}:** "${action.message.slice(0, 100)}..."`;
        break;
      }
      case 'announce': {
        const channel = guild.channels.cache.get(action.channelId);
        if (!channel) throw new Error('Channel not found.');
        const embed = new EmbedBuilder()
          .setTitle(action.title || 'Announcement')
          .setDescription(action.description)
          .setColor(action.color ? parseInt(action.color.replace('#', ''), 16) : 0x00D4FF)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        resultMessage = `✅ **Sent announcement to #${channel.name}.**`;
        break;
      }
      case 'create_guild': {
        const newGuild = await interaction.client.guilds.create({
          name: action.name
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
        // Find default text channel to create invite
        const textChannel = newGuild.channels.cache.find(c => c.type === 0);
        if (!textChannel) throw new Error('Could not find system or text channel in new server.');
        const invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 });
        resultMessage = `✅ **Created new server "${action.name}"! Join here: ${invite.url}**`;
        break;
      }
      case 'setup_server_template': {
        // Create categories and channels
        const categories = [
          { name: '📢 INFORMATION', channels: ['welcome', 'rules', 'announcements'] },
          { name: '💬 COMMUNITY', channels: ['general-chat', 'media-sharing', 'bot-commands'] },
          { name: '👮 STAFF ZONE', channels: ['staff-chat', 'logs'] }
        ];

        for (const cat of categories) {
          const category = await guild.channels.create({
            name: cat.name,
            type: 4 // Category
          });
          for (const chName of cat.channels) {
            await guild.channels.create({
              name: chName,
              type: 0, // Text
              parent: category.id
            });
          }
        }
        resultMessage = `✅ **Successfully built default server layout categories and channels.**`;
        break;
      }
      default:
        throw new Error(`Unknown automation type: ${action.type}`);
    }

    // Update original message to show completion status
    const origEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setDescription(resultMessage)
      .setColor(0x2ECC71)
      .setFields([])
      .setTimestamp();

    await interaction.editReply({ embeds: [origEmbed], components: [] });
    PENDING_AUTOMATIONS.delete(actionId);

  } catch (err) {
    console.error('[AI AUTOMATION EXECUTION ERROR]', err);
    const errEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setDescription(`❌ **Automation Failed**: ${err.message || err}`)
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errEmbed], components: [] });
  }
}

async function handleAiCancelClick(interaction, actionId) {
  PENDING_AUTOMATIONS.delete(actionId);
  await interaction.deferUpdate();
  const cancelEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setDescription('❌ **Automation Request Cancelled.**')
    .setColor(0xE74C3C)
    .setFields([])
    .setTimestamp();
  await interaction.editReply({ embeds: [cancelEmbed], components: [] });
}

module.exports = { executeAiAction, handleAiConfirmClick, handleAiCancelClick };
