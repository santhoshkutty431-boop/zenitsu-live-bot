const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Capability label maps
const CAPABILITY_LABELS = {
  'AI_CONFIG': '🤖 Manage AI Settings',
  'SECURITY_CONFIG': '🛡️ Manage Security Settings',
  'ROLE_ASSIGN': '🔐 Manage Roles & Whitelists',
  'MODERATION_EXECUTE': '👮 Execute Moderation Actions'
};

async function handleInteraction(interaction, runtime, db, ID, logToChannel, isDeveloper, resolvePermission, client, staffCheck, isOwner, getOrCreateRole) {
  loadDb(); // Sync with disk before interaction checks

  // ── SERVER WHITELIST CHECK ───────────────────────────────────────────────────
  if (interaction.guildId) {
    const isMainGuild      = interaction.guildId === config.guildId;
    const isWhitelisted    = (db.serverWhitelist || []).includes(interaction.guildId);
    const isBotOwner       = isOwner(interaction.user.id);

    if (!isMainGuild && !isWhitelisted && !isBotOwner) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🔒 Private Bot')
          .setDescription(
            'This bot is **private** and only operates in authorized servers.\n\n' +
            '> To request access for your server, check the **bot\'s bio/profile** for the owner\'s support server link, join it, and contact the owner: **kutty**.'
          )
          .setColor(0xFF0000)
          .setFooter({ text: 'ZENITSU BOT — Private Use Only' })
          .setTimestamp()
        ],
        ephemeral: true,
      }).catch(() => {});
    }
  }

  // ── SLASH COMMANDS ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    // ── ROLE / TIER PERMISSION CHECK ─────────────────────────────────────────
    const res = resolvePermission(interaction.member, cmd, interaction.user.id, db);
    if (!res.allowed) {
      const embed = new EmbedBuilder()
        .setTitle('🚫 Access Denied')
        .setColor(0xFF4444)
        .setTimestamp();

      if (res.reason === 'LOCKED') {
        embed.setDescription(res.message);
      } else {
        const requiredTier = res.requiredTier || 'STAFF';
        const missingCap = res.capability;
        
        let userTier = 'Normal User';
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        db.guildWhitelists = db.guildWhitelists || {};
        const guildWhitelist = db.guildWhitelists[guildId] || { users: {}, roles: {} };
        
        if (isDeveloper(userId)) {
          userTier = 'Bot Developer';
        } else if (interaction.member && userId === interaction.guild?.ownerId) {
          userTier = 'Server Owner';
        } else if (guildWhitelist.users?.[userId] || (db.roleWhitelist && db.roleWhitelist.includes(userId))) {
          userTier = 'Whitelisted User';
        } else {
          db.commandRoleWhitelist = db.commandRoleWhitelist || { admin: [], staff: [], member: [] };
          const roleWhitelist = db.commandRoleWhitelist;
          if (roleWhitelist.admin && roleWhitelist.admin.some(id => interaction.member?.roles?.cache?.has(id))) {
            userTier = 'Admin Role';
          } else if (roleWhitelist.staff && roleWhitelist.staff.some(id => interaction.member?.roles?.cache?.has(id))) {
            userTier = 'Staff Role';
          } else if (roleWhitelist.member && roleWhitelist.member.some(id => interaction.member?.roles?.cache?.has(id))) {
            userTier = 'Member Role';
          }
        }

        let desc = `You do not have the required permissions to use \`/${cmd}\`.\n\n` +
                   `• **Your Tier**: \`${userTier}\`\n` +
                   `• **Required Tier**: \`${requiredTier}\`\n`;
        
        if (missingCap) {
          desc += `• **Missing Capability**: \`${missingCap}\`\n`;
        }

        let suggestedAction = 'Contact the **Server Owner** to request whitelisting or command tier role assignment.';
        if (requiredTier === 'SERVER_OWNER') {
          suggestedAction = 'This command is restricted strictly to the **Server Owner**.';
        } else if (requiredTier === 'BOT_DEVELOPER') {
          suggestedAction = 'This command is restricted strictly to **Bot Developers**.';
        } else if (missingCap) {
          const capFriendlyName = CAPABILITY_LABELS[missingCap] || missingCap;
          if (userTier === 'Whitelisted User') {
            suggestedAction = `Contact the **Server Owner** to assign the missing capability (**${capFriendlyName}**) to your whitelist.`;
          } else {
            suggestedAction = `Contact the **Server Owner** to request whitelisting with the (**${capFriendlyName}**) capability.`;
          }
        }

        desc += `\n> **Suggested Action**: ${suggestedAction}`;
        embed.setDescription(desc);
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Record privileged moderation audit logs
    const isPublic = ['help', 'request-song', 'queue', 'report-user', 'ai', 'ai-reset', 'ai-lang', 'draw', 'leaderboard', 'check-bypass'].includes(cmd);
    const isMember = ['rank'].includes(cmd);
    if (!isPublic && !isMember) {
      const targetUser = interaction.options.getUser('user') || interaction.options.getUser('member') || interaction.options.getUser('target');
      const targetId = targetUser ? targetUser.id : null;
      
      const params = {};
      interaction.options.data.forEach(opt => {
        params[opt.name] = opt.value;
      });

      const dbService = runtime.getService('DatabaseManager');
      if (dbService) {
        dbService.recordAudit(
          interaction.guildId,
          interaction.user.id,
          targetId,
          cmd,
          params,
          'SUCCESS'
        );
      }
    }

    // Publish COMMAND_RUN event to EventBus
    runtime.eventBus.publish('COMMAND_RUN', { commandName: cmd });

    // v4.0 Runtime command router delegation
    const commandRouter = runtime.getService('CommandRouter');
    if (commandRouter.commands.has(cmd)) {
      return commandRouter.route(interaction);
    }

    // /help
    if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('ZENITSU LIVE Bot Help')
        .setColor(0xEDC231)
        .setDescription('Useful commands are grouped by access level.')
        .addFields(
          { name: 'Public', value: '`/help`, `/ai`, `/ai-lang`, `/ai-reset`, `/draw`, `/request-song`, `/queue`, `/leaderboard`, `/report-user`, `/check-bypass`' },
          { name: 'Member', value: '`/rank`' },
          { name: 'Staff', value: '`/warn`, `/unwarn`, `/kick`, `/mute`, `/unmute`, `/timeout`, `/untimeout`, `/cases`, `/case`, `/purge`, `/lock`, `/unlock`, `/say`' },
          { name: 'Admin', value: '`/setup-panel`, `/embed`, `/ai-embed`, `/security`, `/ai-channel`, `/role`, `/ban`, `/tempban`, `/unban`, `/clear-channel`, `/whitelist-role`' }
        )
        .setFooter({ text: 'ZENITSU LIVE | Use commands responsibly' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /rank
    else if (cmd === 'rank') {
      const target = interaction.options.getUser('user') || interaction.user;
      const data   = db.xp?.[target.id];
      if (!data) return interaction.reply({ content: `${target.username} has not earned any XP yet.`, ephemeral: true });

      const level  = calcLevel(data.xp);
      const needed = xpForLevel(level + 1);
      const progress = Math.min(Math.floor(((data.xp - xpForLevel(level)) / (needed - xpForLevel(level))) * 20), 20);
      const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${target.username}'s Rank`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '⭐ Level',    value: `${level}`,         inline: true },
          { name: '✨ XP',       value: `${data.xp}`,        inline: true },
          { name: '🎯 Next Level', value: `${needed} XP`,   inline: true },
          { name: '📈 Progress', value: `\`[${bar}]\` ${data.xp}/${needed}` },
        )
        .setColor(0xEDC231)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /leaderboard
    else if (cmd === 'leaderboard') {
      const sorted = Object.entries(db.xp || {})
        .sort(([, a], [, b]) => b.xp - a.xp)
        .slice(0, 10);

      if (sorted.length === 0)
        return interaction.reply({ content: 'No XP data yet!', ephemeral: true });

      const medals = ['🥇', '🥈', '🥉'];
      const desc = sorted.map(([uid, d], i) =>
        `${medals[i] || `**${i + 1}.**`} <@${uid}> — **Level ${calcLevel(d.xp)}** · ${d.xp} XP`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🏆 ZENITSU LIVE Leaderboard')
        .setDescription(desc)
        .setColor(0xEDC231)
        .setFooter({ text: 'Top 10 most active members' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /request-song
    else if (cmd === 'request-song') {
      const song = interaction.options.getString('song');
      db.songQueue.push({ name: song, requester: interaction.user.tag, requesterId: interaction.user.id, requestedAt: new Date().toISOString() });
      saveDb();
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Requested!')
        .setDescription(`**Song:** ${song}\n**By:** ${interaction.user}`)
        .setColor(0xEDC231).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /queue
    else if (cmd === 'queue') {
      if (!db.songQueue.length) return interaction.reply({ content: 'Queue is empty!', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Queue')
        .setColor(0xEDC231)
        .setDescription(db.songQueue.slice(0, 20).map((s, i) => `**${i + 1}.** ${s.name} *(${s.requester})*`).join('\n'))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // /protectme
    else if (cmd === 'protectme') {
      const active = interaction.options.getBoolean('active');
      db.protectmeActive = active; saveDb();
      await interaction.reply({ content: `Auto-mod is now **${active ? 'ENABLED ✅' : 'DISABLED ❌'}**`, ephemeral: true });
    }

    // /report-user
    else if (cmd === 'report-user') {
      const user   = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const embed  = new EmbedBuilder()
        .setTitle('🚨 User Report')
        .setDescription(`**Reporter:** ${interaction.user}\n**Reported:** ${user}\n**Reason:** ${reason}`)
        .setColor(0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ content: 'Report submitted to staff.', ephemeral: true });
    }

    // /mute
    else if (cmd === 'mute') {
      const target   = interaction.options.getMember('user');
      const duration = interaction.options.getInteger('duration') || 10;
      const reason   = interaction.options.getString('reason') || 'No reason';
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      await target.timeout(duration * 60_000, reason).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔇 Member Muted')
        .setDescription(`**User:** ${target}\n**Duration:** ${duration}m\n**Reason:** ${reason}\n**By:** ${interaction.user}`)
        .setColor(0xFF0000).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, embed);
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /unmute
    else if (cmd === 'unmute') {
      const target = interaction.options.getMember('user');
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      await target.timeout(null).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔊 Member Unmuted')
        .setDescription(`**User:** ${target}\n**By:** ${interaction.user}`)
        .setColor(0x2ECC71).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /lock & /unlock
    else if (cmd === 'lock' || cmd === 'unlock') {
      const ch = interaction.options.getChannel('channel') || interaction.channel;
      await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: cmd === 'lock' ? false : null }).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle(cmd === 'lock' ? '🔒 Channel Locked' : '🔓 Channel Unlocked')
        .setDescription(`${ch} was ${cmd === 'lock' ? 'locked' : 'unlocked'} by ${interaction.user}`)
        .setColor(cmd === 'lock' ? 0xFF0000 : 0x2ECC71).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /role add|remove
    else if (cmd === 'role') {
      const sub    = interaction.options.getSubcommand();
      const target = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      if (!target) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      if (sub === 'add')    await target.roles.add(role).catch(() => {});
      if (sub === 'remove') await target.roles.remove(role).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle(sub === 'add' ? '➕ Role Added' : '➖ Role Removed')
        .setDescription(`**User:** ${target}\n**Role:** ${role}\n**By:** ${interaction.user}`)
        .setColor(sub === 'add' ? 0x2ECC71 : 0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ embeds: [embed] });
    }

    // /check-bypass
    else if (cmd === 'check-bypass') {
      await interaction.reply({ content: 'Check the <#1460152325267128520> channel for bypass info.', ephemeral: true });
    }

    // /say  ── upgraded: permission check + mod log
    else if (cmd === 'say') {
      const ch      = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      // Permission: Administrator or Manage Server
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setTitle('❌ Permission Denied')
          .setDescription('You need **Administrator** or **Manage Server** to use `/say`.')
          .setColor(0xE74C3C)], ephemeral: true });
      }

      if (!ch.isTextBased()) return interaction.reply({ content: '❌ Selected channel is not a text channel.', ephemeral: true });

      await ch.send({ content: message }).catch(() => {});

      // Log to mod log
      const sayLog = new EmbedBuilder()
        .setTitle('📣 /say Used')
        .setDescription(`**Sent by:** ${interaction.user} (${interaction.user.tag})\n**Channel:** ${ch}\n**Message:** ${message.slice(0, 500)}`)
        .setColor(0x3498DB).setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, sayLog);

      await interaction.reply({ content: `✅ Message sent to ${ch}!`, ephemeral: true });
    }

    // /embed  ── professional announcement system
    else if (cmd === 'embed') {
      await handleEmbed(interaction, db, saveDb, logToChannel, ID);
    }

    // /whitelist
    else if (cmd === 'whitelist') {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      db.guildWhitelists = db.guildWhitelists || {};
      db.guildWhitelists[guildId] = db.guildWhitelists[guildId] || { users: {}, roles: {} };

      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        const capString = interaction.options.getString('capabilities');

        const systemCapabilities = ['AI_CONFIG', 'SECURITY_CONFIG', 'MODERATION_EXECUTE', 'ROLE_ASSIGN', 'EMBED_MANAGE', 'TICKET_CONFIG'];
        
        let targetCapabilities = [...systemCapabilities];
        if (capString) {
          targetCapabilities = capString.split(',').map(s => s.trim().toUpperCase()).filter(s => systemCapabilities.includes(s));
          if (targetCapabilities.length === 0) {
            return interaction.reply({ content: `❌ Invalid capabilities specified. Available options: \`${systemCapabilities.join(', ')}\``, ephemeral: true });
          }
        }

        const isAlreadyWhitelisted = db.guildWhitelists[guildId].users[user.id] !== undefined;
        const previousState = isAlreadyWhitelisted ? [...db.guildWhitelists[guildId].users[user.id]] : null;

        db.guildWhitelists[guildId].users[user.id] = targetCapabilities;

        if (!db.roleWhitelist) db.roleWhitelist = [];
        if (!db.roleWhitelist.includes(user.id)) {
          db.roleWhitelist.push(user.id);
        }

        saveDb();
        invalidatePermCache(guildId, user.id);

        const auditId = generateAuditId();

        const auditLogEmbed = new EmbedBuilder()
          .setTitle('🔐 Permission Audit Log')
          .addFields(
            { name: 'Audit ID', value: `\`${auditId}\`` },
            { name: 'Action', value: isAlreadyWhitelisted ? 'Updated Whitelisted User' : 'Added Whitelisted User' },
            { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
            { name: 'Target User', value: `${user} (ID: \`${user.id}\`)` },
            { name: 'Capabilities (New)', value: targetCapabilities.map(c => `• ${CAPABILITY_LABELS[c] || c}`).join('\n') },
            { name: 'Capabilities (Prev)', value: previousState ? previousState.map(c => `• ${CAPABILITY_LABELS[c] || c}`).join('\n') : '*None (New Whitelist)*' },
            { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
          )
          .setColor(isAlreadyWhitelisted ? 0xF39C12 : 0x2ECC71)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

        const listStr = targetCapabilities.map(cap => `• ${CAPABILITY_LABELS[cap] || cap}`).join('\n');

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ User Successfully Whitelisted')
          .setDescription(`Successfully updated permissions for ${user}.`)
          .addFields(
            { name: '👤 User', value: `${user} (\`${user.id}\`)`, inline: true },
            { name: '🛡️ Audit ID', value: `\`${auditId}\``, inline: true },
            { name: '🔑 Granted Access', value: listStr }
          )
          .setFooter({ text: 'Use /owner-help to learn more' })
          .setColor(0x2ECC71)
          .setTimestamp();

        await interaction.reply({ embeds: [successEmbed], ephemeral: true });

        // Send appointment DM to target user
        const memberTarget = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (memberTarget) {
          const appointmentEmbed = new EmbedBuilder()
            .setTitle('⚡ ZENITSU LIVE — Security Permission Appointed')
            .setDescription(
              `Hello! You have been whitelisted as an authorized administrator in **${interaction.guild.name}** by the **Server Owner**.\n\n` +
              `You have been granted the following capabilities:`
            )
            .addFields(
              { name: '🔑 Granted Capabilities', value: listStr },
              { name: '📖 How to get started', value: '• Run `/whoami` to inspect your active capabilities in the server.\n• Ask `/ai` helper questions for ticket or moderation setups.' }
            )
            .setColor(0xEDC231)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setTimestamp();
          
          await memberTarget.send({ embeds: [appointmentEmbed] }).catch(() => {});
        }
      }

      else if (sub === 'remove') {
        const user = interaction.options.getUser('user');

        const isWhitelisted = db.guildWhitelists[guildId]?.users?.[user.id] !== undefined;
        if (!isWhitelisted && !db.roleWhitelist.includes(user.id)) {
          return interaction.reply({ content: `⚠️ ${user} is not whitelisted.`, ephemeral: true });
        }

        const previousState = db.guildWhitelists[guildId]?.users?.[user.id] || ['Legacy Role Whitelist'];

        if (db.guildWhitelists[guildId]?.users) {
          delete db.guildWhitelists[guildId].users[user.id];
        }
        db.roleWhitelist = db.roleWhitelist.filter(id => id !== user.id);

        saveDb();
        invalidatePermCache(guildId, user.id);

        const auditId = generateAuditId();

        const auditLogEmbed = new EmbedBuilder()
          .setTitle('🔐 Permission Audit Log')
          .addFields(
            { name: 'Audit ID', value: `\`${auditId}\`` },
            { name: 'Action', value: 'Removed Whitelisted User' },
            { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
            { name: 'Target User', value: `${user} (ID: \`${user.id}\`)` },
            { name: 'Capabilities (Revoked)', value: previousState.map(c => `• ${CAPABILITY_LABELS[c] || c}`).join('\n') },
            { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
          )
          .setColor(0xE74C3C)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

        const successEmbed = new EmbedBuilder()
          .setTitle('❌ Whitelist Removed')
          .setDescription(`Successfully revoked all whitelisted capabilities for ${user}.`)
          .addFields(
            { name: '👤 User', value: `${user} (\`${user.id}\`)`, inline: true },
            { name: '🛡️ Audit ID', value: `\`${auditId}\``, inline: true }
          )
          .setColor(0xE74C3C)
          .setTimestamp();

        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
      }

      else if (sub === 'list') {
        const guildUsers = db.guildWhitelists[guildId]?.users || {};
        const legacyUsers = db.roleWhitelist || [];

        const allUserIds = Array.from(new Set([...Object.keys(guildUsers), ...legacyUsers]));

        if (allUserIds.length === 0) {
          return interaction.reply({ content: '📝 The whitelisted users list is currently empty for this server.', ephemeral: true });
        }

        const listLines = [];
        const selectOptions = [];

        for (const id of allUserIds) {
          const caps = guildUsers[id] || [];
          const capsFormatted = caps.length > 0
            ? caps.map(c => CAPABILITY_LABELS[c] || c).join(', ')
            : 'Legacy (All capabilities)';
          listLines.push(`• <@${id}> (\`${id}\`)\n  **Capabilities**: ${capsFormatted}`);

          const cachedUser = interaction.client.users.cache.get(id);
          const label = cachedUser ? cachedUser.tag : `User ID: ${id}`;
          selectOptions.push({
            label: label.slice(0, 100),
            description: `Remove ${label.slice(0, 50)} from whitelist`,
            value: id
          });
        }

        const embed = new EmbedBuilder()
          .setTitle('🛡️ Whitelisted Users Directory')
          .setDescription(`Below are the trusted users whitelisted on this server:\n\n${listLines.join('\n\n')}`)
          .setColor(0x00D4FF)
          .setTimestamp();

        const components = [];
        if (selectOptions.length > 0) {
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_whitelist_select')
            .setPlaceholder('🛑 Select a user to remove from whitelist')
            .addOptions(selectOptions.slice(0, 25));

          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await interaction.reply({ embeds: [embed], components, ephemeral: true });
      }
    }

    // /whitelist-role
    else if (cmd === 'whitelist-role') {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      db.commandRoleWhitelist = db.commandRoleWhitelist || { admin: [], staff: [], member: [] };

      if (sub === 'add') {
        const role = interaction.options.getRole('role');
        const tier = interaction.options.getString('tier');
        const capabilitiesStr = interaction.options.getString('capabilities');

        if (!db.commandRoleWhitelist[tier]) db.commandRoleWhitelist[tier] = [];
        if (db.commandRoleWhitelist[tier].includes(role.id)) {
          return interaction.reply({ content: `⚠️ The role ${role} is already whitelisted for **${tier.toUpperCase()}** commands.`, ephemeral: true });
        }

        let capabilities = [];
        if (capabilitiesStr) {
          capabilities = capabilitiesStr.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
        }

        db.commandRoleWhitelist[tier].push(role.id);
        db.roleCapabilities = db.roleCapabilities || {};
        db.roleCapabilities[role.id] = capabilities;

        saveDb();
        invalidatePermCache(guildId);

        const auditId = generateAuditId();

        const auditLogEmbed = new EmbedBuilder()
          .setTitle('🔐 Permission Audit Log')
          .addFields(
            { name: 'Audit ID', value: `\`${auditId}\`` },
            { name: 'Action', value: 'Added Whitelisted Role' },
            { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
            { name: 'Target Role', value: `${role} (ID: \`${role.id}\`)` },
            { name: 'Assigned Tier', value: `\`${tier.toUpperCase()}\`` },
            { name: 'Capabilities', value: capabilities.length ? capabilities.map(c => `• ${CAPABILITY_LABELS[c] || c}`).join('\n') : 'None' },
            { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
          )
          .setColor(0x2ECC71)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Role Whitelisted Successfully')
          .setDescription(`Custom role configuration updated.`)
          .addFields(
            { name: '🛡️ Role', value: `${role} (\`${role.id}\`)`, inline: true },
            { name: '🔑 Assigned Tier', value: `\`${tier.toUpperCase()}\``, inline: true },
            { name: '🔑 Capabilities', value: capabilities.length ? capabilities.map(c => `• ${CAPABILITY_LABELS[c] || c}`).join('\n') : 'None', inline: true },
            { name: '🛡️ Audit ID', value: `\`${auditId}\``, inline: true }
          )
          .setColor(0x2ECC71)
          .setTimestamp();

        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
      }

      else if (sub === 'remove') {
        const role = interaction.options.getRole('role');
        const tier = interaction.options.getString('tier');

        if (!db.commandRoleWhitelist[tier] || !db.commandRoleWhitelist[tier].includes(role.id)) {
          return interaction.reply({ content: `⚠️ The role ${role} is not whitelisted for **${tier.toUpperCase()}** commands.`, ephemeral: true });
        }

        db.commandRoleWhitelist[tier] = db.commandRoleWhitelist[tier].filter(id => id !== role.id);
        if (db.roleCapabilities) {
          delete db.roleCapabilities[role.id];
        }
        
        saveDb();
        invalidatePermCache(guildId);

        const auditId = generateAuditId();

        const auditLogEmbed = new EmbedBuilder()
          .setTitle('🔐 Permission Audit Log')
          .addFields(
            { name: 'Audit ID', value: `\`${auditId}\`` },
            { name: 'Action', value: 'Removed Whitelisted Role' },
            { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
            { name: 'Target Role', value: `${role} (ID: \`${role.id}\`)` },
            { name: 'Revoked Tier', value: `\`${tier.toUpperCase()}\`` },
            { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
          )
          .setColor(0xE74C3C)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

        const successEmbed = new EmbedBuilder()
          .setTitle('❌ Role Whitelist Removed')
          .setDescription(`Successfully removed custom role authorization.`)
          .addFields(
            { name: '🛡️ Role', value: `${role} (\`${role.id}\`)`, inline: true },
            { name: '🔑 Revoked Tier', value: `\`${tier.toUpperCase()}\``, inline: true },
            { name: '🛡️ Audit ID', value: `\`${auditId}\``, inline: true }
          )
          .setColor(0xE74C3C)
          .setTimestamp();

        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
      }

      else if (sub === 'list') {
        const adminRoles = db.commandRoleWhitelist.admin || [];
        const staffRoles = db.commandRoleWhitelist.staff || [];
        const memberRoles = db.commandRoleWhitelist.member || [];

        const selectOptions = [];

        adminRoles.forEach(id => {
          const role = interaction.guild.roles.cache.get(id);
          const label = role ? role.name : `Role ID: ${id}`;
          selectOptions.push({
            label: `Remove ${label.slice(0, 50)} (Admin Tier)`,
            description: `Remove this role from Admin Whitelist`,
            value: `admin_${id}`
          });
        });

        staffRoles.forEach(id => {
          const role = interaction.guild.roles.cache.get(id);
          const label = role ? role.name : `Role ID: ${id}`;
          selectOptions.push({
            label: `Remove ${label.slice(0, 50)} (Staff Tier)`,
            description: `Remove this role from Staff Whitelist`,
            value: `staff_${id}`
          });
        });

        memberRoles.forEach(id => {
          const role = interaction.guild.roles.cache.get(id);
          const label = role ? role.name : `Role ID: ${id}`;
          selectOptions.push({
            label: `Remove ${label.slice(0, 50)} (Member Tier)`,
            description: `Remove this role from Member Whitelist`,
            value: `member_${id}`
          });
        });

        const embed = new EmbedBuilder()
          .setTitle('🛡️ Bot Command Role Whitelist')
          .setDescription('Custom roles authorized to run Zenitsu bot commands:')
          .addFields(
            { name: '🛠️ Admin Commands Whitelist', value: adminRoles.map(id => `• <@&${id}>`).join('\n') || 'None' },
            { name: '👮 Staff Commands Whitelist', value: staffRoles.map(id => `• <@&${id}>`).join('\n') || 'None' },
            { name: '👥 Normal Member Commands Whitelist', value: memberRoles.map(id => `• <@&${id}>`).join('\n') || 'None' }
          )
          .setColor(0x00D4FF)
          .setTimestamp();

        const components = [];
        if (selectOptions.length > 0) {
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_whitelist_role_select')
            .setPlaceholder('🛑 Select a role to remove from whitelist')
            .addOptions(selectOptions.slice(0, 25));

          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await interaction.reply({ embeds: [embed], components, ephemeral: true });
      }
    }

    // /warn
    else if (cmd === 'warn') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (!db.warnings)           db.warnings = {};
      if (!db.warnings[target.id]) db.warnings[target.id] = [];

      // Legacy entry (backward compat)
      db.warnings[target.id].push({
        warnerTag: interaction.user.tag,
        warnerId:  interaction.user.id,
        reason,
        timestamp: new Date().toISOString(),
      });

      // Enterprise case entry
      const caseData = createCase(db, saveDb, {
        type:    CaseType.WARN,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      saveDb();

      await target.send(`⚠️ **Warning:** You have been warned in **${interaction.guild.name}**\n**Reason:** ${reason}\n**Case:** ${caseData.caseId}\n**Total warnings:** ${db.warnings[target.id].length}`).catch(() => {});
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('⚠️ Member Warned')
          .setDescription(`**User:** ${target} (${target.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .addFields({ name: 'Total Warnings', value: `${db.warnings[target.id].length}` })
          .setColor(0xF1C40F).setTimestamp()
      ]});
    }

    // /kick
    else if (cmd === 'kick') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: '❌ Member not found in this server.', ephemeral: true });
      if (!target.kickable) return interaction.reply({ content: '❌ I cannot kick this member. Check role hierarchy.', ephemeral: true });

      await target.send(`🚪 **Kicked:** You have been kicked from **${interaction.guild.name}**\n**Reason:** ${reason}`).catch(() => {});
      await target.kick(reason).catch(() => {});

      const caseData = createCase(db, saveDb, {
        type:    CaseType.KICK,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.user.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🚪 Member Kicked')
          .setDescription(`**User:** ${target.user} (${target.user.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .setColor(0xE67E22).setTimestamp()
      ]});
    }

    // /ban
    else if (cmd === 'ban') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = interaction.options.getMember('user');

      if (member && !member.bannable)
        return interaction.reply({ content: '❌ I cannot ban this member. Check role hierarchy.', ephemeral: true });

      await target.send(`🔨 **Banned:** You have been permanently banned from **${interaction.guild.name}**\n**Reason:** ${reason}`).catch(() => {});
      await interaction.guild.members.ban(target.id, { reason }).catch(() => {});

      const caseData = createCase(db, saveDb, {
        type:    CaseType.BAN,
        guildId: interaction.guild.id,
        userId:  target.id,
        userTag: target.tag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🔨 Member Banned')
          .setDescription(`**User:** ${target} (${target.tag})\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``)
          .setColor(0xE74C3C).setTimestamp()
      ]});
    }

    // /unban
    else if (cmd === 'unban') {
      const userId = interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      if (!/^\d{17,20}$/.test(userId)) {
        return interaction.reply({ content: 'Invalid Discord user ID.', ephemeral: true });
      }

      let user;
      try {
        await interaction.guild.members.unban(userId, reason);
        user = await interaction.client.users.fetch(userId).catch(() => null);
      } catch (err) {
        return interaction.reply({ content: `Could not unban that user: ${err.message}`, ephemeral: true });
      }
      const userTag = user?.tag || userId;

      const caseData = createCase(db, saveDb, {
        type:    CaseType.UNBAN,
        guildId: interaction.guild.id,
        userId,
        userTag,
        modId:   interaction.user.id,
        modTag:  interaction.user.tag,
        reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ content: `Unbanned **${userTag}**. Case: \`${caseData.caseId}\``, ephemeral: true });
    }

    // /purge
    else if (cmd === 'purge') {
      const amount = interaction.options.getInteger('amount') || 50;
      await interaction.deferReply({ ephemeral: true });
      try {
        const deleted = await interaction.channel.bulkDelete(amount, true); // true = skip messages >14 days
        await interaction.editReply({ content: `✅ Deleted **${deleted.size}** messages. (Messages older than 14 days are skipped automatically.)` });
      } catch (err) {
        await interaction.editReply({ content: `❌ Failed to purge: ${err.message}` });
      }
    }

    // /clear-channel
    else if (cmd === 'clear-channel') {
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
      await interaction.deferReply({ ephemeral: true });
      try {
        const ch = interaction.guild.channels.cache.get(targetChannel.id);
        if (!ch) return interaction.editReply({ content: '❌ Channel not found.' });

        // Clone the channel with the same settings
        const cloned = await ch.clone({
          name: ch.name,
          reason: `Channel cleared by ${interaction.user.tag} via /clear-channel`
        });

        // Move it to same position
        await cloned.setPosition(ch.rawPosition).catch(() => {});

        // Delete the old channel
        await ch.delete(`Cleared by ${interaction.user.tag}`);

        const logEmbed = new EmbedBuilder()
          .setTitle('🧹 Channel Cleared')
          .setDescription(`**Channel:** #${ch.name}\n**By:** ${interaction.user}\n\nAll messages have been wiped by cloning and deleting the original channel.`)
          .setColor(0x00D4FF)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, logEmbed);

        // Reply in the new channel
        await cloned.send({ embeds: [new EmbedBuilder()
          .setTitle('🧹 Channel Cleared')
          .setDescription(`This channel was cleared by ${interaction.user}. All previous messages have been removed.`)
          .setColor(0x00D4FF)
          .setTimestamp()
        ]});

        await interaction.editReply({ content: `✅ **#${ch.name}** has been fully cleared! All messages deleted.` });
      } catch (err) {
        await interaction.editReply({ content: `❌ Failed to clear channel: ${err.message}` });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ENTERPRISE MODERATION COMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    // /timeout
    else if (cmd === 'timeout') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target   = interaction.options.getMember('user');
      const durStr   = interaction.options.getString('duration');
      const reason   = interaction.options.getString('reason') || 'No reason provided';
      const durMs    = parseDuration(durStr);

      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      if (!durMs)  return interaction.reply({ content: '❌ Invalid duration. Use: `60s`, `5m`, `2h`, `1d`, `1w`', ephemeral: true });
      if (durMs > 28 * 24 * 60 * 60 * 1000) return interaction.reply({ content: '❌ Discord maximum timeout is 28 days.', ephemeral: true });
      if (!target.moderatable) return interaction.reply({ content: '❌ I cannot timeout this member (check role hierarchy).', ephemeral: true });

      await target.timeout(durMs, reason);
      const caseData = createCase(db, saveDb, {
        type: CaseType.TIMEOUT, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration: durMs,
      });
      await target.send(`⏸️ You have been timed out in **${interaction.guild.name}** for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** ${caseData.caseId}`).catch(() => {});
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏸️ Member Timed Out').setDescription(`${target.user.tag} timed out for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\``).setColor(0xF39C12).setTimestamp()], ephemeral: true });
    }

    // /untimeout
    else if (cmd === 'untimeout') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      await target.timeout(null, reason);
      const caseData = createCase(db, saveDb, {
        type: CaseType.UNTIMEOUT, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ content: `✅ Timeout removed from **${target.user.tag}**. Case: \`${caseData.caseId}\``, ephemeral: true });
    }

    // /tempban
    else if (cmd === 'tempban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers))
        return interaction.reply({ content: '❌ You need **Ban Members** permission.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const durStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason');
      const durMs  = parseDuration(durStr);
      if (!durMs) return interaction.reply({ content: '❌ Invalid duration. Use: `1h`, `1d`, `7d`, `30d`', ephemeral: true });

      const member = interaction.options.getMember('user');
      if (member && !member.bannable) return interaction.reply({ content: '❌ I cannot ban this member.', ephemeral: true });

      await target.send(`🔨 You have been **temporarily banned** from **${interaction.guild.name}** for **${formatDuration(durMs)}**.\n**Reason:** ${reason}`).catch(() => {});
      await interaction.guild.members.ban(target.id, { reason: `Temp ban (${formatDuration(durMs)}): ${reason}` });
      const caseData = createCase(db, saveDb, {
        type: CaseType.TEMPBAN, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration: durMs,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏱️🔨 Temp Ban Applied').setDescription(`**${target.tag}** temp-banned for **${formatDuration(durMs)}**.\n**Reason:** ${reason}\n**Case:** \`${caseData.caseId}\`\n**Auto-unban:** <t:${Math.floor((Date.now() + durMs) / 1000)}:R>`).setColor(0xC0392B).setTimestamp()], ephemeral: true });
    }

    // /slowmode
    else if (cmd === 'slowmode') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return interaction.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });

      const seconds = interaction.options.getInteger('seconds');
      const ch      = interaction.options.getChannel('channel') || interaction.channel;
      await ch.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
      const caseData = createCase(db, saveDb, {
        type: CaseType.SLOWMODE, guildId: interaction.guild.id,
        userId: interaction.user.id, userTag: interaction.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Slowmode set to ${seconds}s in #${ch.name}`,
      });
      await interaction.reply({ content: `✅ Slowmode in ${ch} set to **${seconds}s** (Case: \`${caseData.caseId}\`).`, ephemeral: true });
    }

    // /nick
    else if (cmd === 'nick') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames))
        return interaction.reply({ content: '❌ You need **Manage Nicknames** permission.', ephemeral: true });

      const target   = interaction.options.getMember('user');
      const nickname = interaction.options.getString('nickname') || null;
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      const oldNick = target.nickname || target.user.username;
      await target.setNickname(nickname, `Changed by ${interaction.user.tag}`);
      const caseData = createCase(db, saveDb, {
        type: CaseType.NICK, guildId: interaction.guild.id,
        userId: target.id, userTag: target.user.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Nickname: "${oldNick}" → "${nickname || 'reset'}"`,
      });
      await interaction.reply({ content: `✅ Nickname changed for ${target}: \`${oldNick}\` → \`${nickname || 'reset'}\` (Case: \`${caseData.caseId}\`)`, ephemeral: true });
    }

    // /unwarn
    else if (cmd === 'unwarn') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: '❌ You need **Moderate Members** permission.', ephemeral: true });

      const target = interaction.options.getUser('user');
      const caseId = interaction.options.getString('case_id').toUpperCase();
      const found  = getCase(db, caseId);

      if (!found) return interaction.reply({ content: `❌ Case \`${caseId}\` not found.`, ephemeral: true });
      if (found.userId !== target.id) return interaction.reply({ content: `❌ Case \`${caseId}\` does not belong to ${target.tag}.`, ephemeral: true });
      if (found.type !== CaseType.WARN) return interaction.reply({ content: `❌ Case \`${caseId}\` is not a WARN case.`, ephemeral: true });

      closeCase(db, saveDb, caseId);
      const removeCaseData = createCase(db, saveDb, {
        type: CaseType.UNWARN, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: `Removed warning ${caseId}`,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(removeCaseData));
      await interaction.reply({ content: `✅ Warning \`${caseId}\` removed from **${target.tag}**. New case: \`${removeCaseData.caseId}\``, ephemeral: true });
    }

    // /note
    else if (cmd === 'note') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to add notes.', ephemeral: true });

      const target  = interaction.options.getUser('user');
      const noteText = interaction.options.getString('note');
      const caseData = createCase(db, saveDb, {
        type: CaseType.NOTE, guildId: interaction.guild.id,
        userId: target.id, userTag: target.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason: noteText,
      });
      await logToChannel(interaction.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
      await interaction.reply({ content: `✅ Note added for **${target.tag}**. Case: \`${caseData.caseId}\``, ephemeral: true });
    }

    // /cases
    else if (cmd === 'cases') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to view cases.', ephemeral: true });

      const target  = interaction.options.getUser('user');
      const typeFilter = interaction.options.getString('type')?.toUpperCase();
      let   cases   = getCasesForUser(db, interaction.guild.id, target.id);
      if (typeFilter) cases = cases.filter(c => c.type === typeFilter);

      const embed = formatUserCasesEmbed(target.id, target.tag, cases);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /case
    else if (cmd === 'case') {
      if (!staffCheck(interaction.member))
        return interaction.reply({ content: '❌ You need staff permissions to view cases.', ephemeral: true });

      const caseId = interaction.options.getString('id').toUpperCase();
      const found  = getCase(db, caseId);
      if (!found) return interaction.reply({ content: `❌ Case \`${caseId}\` not found.`, ephemeral: true });

      await interaction.reply({ embeds: [formatCaseEmbed(found)], ephemeral: true });
    }

    // /security
    else if (cmd === 'security') {

      const sub = interaction.options.getSubcommand();
      if (!db.securityConfig) db.securityConfig = { ...DEFAULT_SECURITY_CONFIG };

      if (sub === 'status') {
        const cfg = db.securityConfig;
        const embed = new EmbedBuilder()
          .setTitle('🛡️ Security Module Status')
          .setColor(0x00D4FF)
          .addFields(
            { name: '🔒 Anti-Raid',         value: cfg.antiRaidEnabled     ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '💣 Anti-Nuke',          value: cfg.antiNukeEnabled     ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '🔒 Auto-Quarantine',    value: cfg.quarantineEnabled   ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '⚡ Join Rate Limit',    value: `${cfg.joinRateLimit} joins / ${cfg.joinRateSeconds}s`, inline: true },
            { name: '📅 Min Account Age',    value: `${cfg.minAccountAgeDays} days`,                        inline: true },
            { name: '💬 Mention Limit',      value: `${cfg.mentionSpamLimit} mentions`,                     inline: true },
            { name: '🌊 Flood Limit',        value: `${cfg.messageFloodCount} msgs / ${cfg.messageFloodWindow / 1000}s`, inline: true },
            { name: '🔁 Repeat Limit',       value: `${cfg.repeatedMsgCount}× same message`,                inline: true },
            { name: '⏱️ Spam Timeout',      value: `${cfg.spamTimeoutMinutes} minutes`,                    inline: true },
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });

      } else if (sub === 'toggle-antinuke') {
        db.securityConfig.antiNukeEnabled = !db.securityConfig.antiNukeEnabled;
        saveDb();
        await interaction.reply({ content: `💣 Anti-Nuke is now **${db.securityConfig.antiNukeEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });

      } else if (sub === 'toggle-antiraid') {
        db.securityConfig.antiRaidEnabled = !db.securityConfig.antiRaidEnabled;
        saveDb();
        await interaction.reply({ content: `🔒 Anti-Raid is now **${db.securityConfig.antiRaidEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });

      } else if (sub === 'toggle-quarantine') {
        db.securityConfig.quarantineEnabled = !db.securityConfig.quarantineEnabled;
        saveDb();
        await interaction.reply({ content: `🔒 Auto-Quarantine is now **${db.securityConfig.quarantineEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ZENITSU AI COMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    // /ai
    else if (cmd === 'ai') {
      const dbService = runtime.getService('DatabaseManager');
      const allowed = dbService.checkAndRecordQuery(interaction.guildId, interaction.user.id);
      if (!allowed) {
        return interaction.reply({
          content: "⏳ You've reached your hourly AI query limit. Try again later.",
          ephemeral: true
        });
      }

      if (db.aiChannelId && interaction.channelId !== db.aiChannelId) {
        return interaction.reply({
          content: `❌ AI chat is restricted. Please use the dedicated AI channel: <#${db.aiChannelId}>`,
          ephemeral: true
        });
      }

      db.userLanguages = db.userLanguages || {};
      const userLang = db.userLanguages[interaction.user.id];

      if (!userLang) {
        const payload = getLanguageSelectorEmbed(interaction.user);
        return interaction.reply({ ...payload, ephemeral: true });
      }

      await interaction.deferReply();

      const prompt = interaction.options.getString('prompt');
      const modelKey = interaction.options.getString('model') || db.aiDefaultModel || 'gemini';
      const result   = await queryAI(interaction.user.id, prompt, modelKey, userLang, {
        applicationId: interaction.client.application?.id || 'default',
        guildId: interaction.guildId || 'dm',
        channelId: interaction.channelId || 'none',
        threadId: interaction.channel?.isThread() ? interaction.channelId : 'none',
        shardId: interaction.client.shard?.ids?.[0]?.toString() || '0'
      });

      // Send private analytics log to staff channel
      await logAiAnalytics(interaction.user, prompt, result, interaction.guild);

      if (result.error) {
        return interaction.editReply({ 
          content: '❌ The AI Service is temporarily overloaded. Our team has been notified. Please try again in a few moments!' 
        });
      }

      const aiEmbed = new EmbedBuilder()
        .setAuthor({
          name:    'ZENITSU AI',
          iconURL: interaction.client.user.displayAvatarURL(),
        })
        .addFields(
          { name: '💬 Your Question', value: prompt.slice(0, 1024) },
          { name: '🤖 Answer',        value: `<@${interaction.user.id}>\n\n${result.response.slice(0, 1024)}` },
        )
        .setColor(0x00D4FF)
        .setFooter({ text: 'ZENITSU AI • Click buttons below to interact' })
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai_channel_reset_${interaction.user.id}`).setLabel('💬 Reset Memory').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ai_channel_message_${interaction.user.id}`).setLabel('🤖 Message AI').setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({ embeds: [aiEmbed], components: [actionRow] });
    }

    // /ai-lang
    else if (cmd === 'ai-lang') {
      const selectedLang = interaction.options.getString('language');
      db.userLanguages = db.userLanguages || {};
      db.userLanguages[interaction.user.id] = selectedLang;
      saveDb();

      const names = { english: 'English 🇬🇧', hinglish: 'Hinglish 🇮🇳', tanglish: 'Tanglish 🐯' };
      await interaction.reply({
        content: `✅ Your preferred AI language has been set to **${names[selectedLang]}**! ZENITSU AI will now reply in this dialect.`,
        ephemeral: true
      });
    }

    // /ai-reset
    else if (cmd === 'ai-reset') {
      clearHistory(interaction.user.id);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔄 Memory Cleared')
            .setDescription('Your AI conversation history has been reset. The next message starts a fresh conversation.')
            .setColor(0xF39C12)
            .setTimestamp()
        ],
        ephemeral: true,
      });
    }

    // /ai-channel
    else if (cmd === 'ai-channel') {

      const guild = interaction.guild || await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
      if (!guild) {
        return interaction.reply({
          content: 'This command can only be used inside a server where the bot is present.',
          ephemeral: true,
        });
      }

      const selectedChannel = interaction.options.getChannel('channel');
      const ch = selectedChannel
        ? (guild.channels.cache.get(selectedChannel.id) ||
           await guild.channels.fetch(selectedChannel.id).catch(() => null))
        : null;

      if (!ch) {
        db.aiChannelId = null;
        saveDb();
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('🤖 AI Channel Disabled')
            .setDescription('AI auto-reply channel has been removed. Use `/ai` command to chat with AI.')
            .setColor(0xE74C3C).setTimestamp()],
          ephemeral: true,
        });
      }

      if (!ch || typeof ch.isTextBased !== 'function' || !ch.isTextBased() || typeof ch.send !== 'function') {
        return interaction.reply({
          content: 'Please select a normal text or announcement channel for AI auto-replies.',
          ephemeral: true,
        });
      }

      db.aiChannelId = ch.id;
      saveDb();

      // Post an intro message in the newly set AI channel
      const introEmbed = new EmbedBuilder()
        .setTitle('🤖 ZENITSU AI ACTIVE')
        .setDescription(
          '**Type any question directly in this channel to get an instant response!**\n\n' +
          '🔹 **Memory Recall:** I remember the last 10 messages of our conversation.\n\n' +
          '🔹 **Reset Memory:** Use the `/ai-reset` command to clear your conversation history.\n\n' +
          '*Feel free to ask me anything about gaming, coding, the server, or general knowledge!*'
        )
        .setColor(0x00D4FF)
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'ZENITSU LIVE • Premium AI Assistant' })
        .setTimestamp();

      await ch.send({ embeds: [introEmbed] }).catch(err => {
        console.error(`Failed to post AI channel intro in ${ch.id}:`, err.message);
      });

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ AI Channel Set')
          .setDescription(`${ch} is now the dedicated AI chat channel.\nMembers can type directly to chat with **ZENITSU AI**.`)
          .setColor(0x2ECC71).setTimestamp()],
        ephemeral: true,
      });
    }

    // /ai-model
    else if (cmd === 'ai-model') {
      if (!isOwner(interaction.user.id) && !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Only **Administrators** can change the default AI model.', ephemeral: true });
      }

      const selectedModel = interaction.options.getString('model');
      db.aiDefaultModel = selectedModel;
      saveDb();

      const modelNames = {
        gemini: '🔷 Gemini 2.0 Flash (Free)',
        gpt4o:  '🟢 GPT-4o (Best)',
        gpt35:  '🟡 GPT-3.5 Turbo (Fast & Cheap)',
        groq:   '⚡ Groq Llama-3.3-70b (Free+Fast)'
      };

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Default AI Model Updated')
          .setDescription(`The server's default AI model has been set to **${modelNames[selectedModel]}**.\nAuto-replies in the AI channel will now use this model by default.`)
          .setColor(0x2ECC71)
          .setTimestamp()],
        ephemeral: true
      });
    }

    // /whitelist-server
    else if (cmd === 'whitelist-server') {
      if (!isOwner(interaction.user.id) && !interaction.member?.roles?.cache?.has(ID.OWNER_ROLE))
        return interaction.reply({ content: '❌ Only the **bot owner** can manage the server whitelist.', ephemeral: true });

      const sub = interaction.options.getSubcommand();
      if (!db.serverWhitelist) db.serverWhitelist = [];

      if (sub === 'add') {
        const serverId = interaction.options.getString('server_id').trim();
        if (db.serverWhitelist.includes(serverId))
          return interaction.reply({ content: `⚠️ Server \`${serverId}\` is already whitelisted.`, ephemeral: true });
        db.serverWhitelist.push(serverId);
        saveDb();
        const guild = client.guilds.cache.get(serverId);
        const name  = guild ? `**${guild.name}**` : `\`${serverId}\``;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('✅ Server Whitelisted').setDescription(`${name} can now use **ZENITSU BOT**.`).setColor(0x2ECC71).setTimestamp()], ephemeral: true });

      } else if (sub === 'remove') {
        const serverId = interaction.options.getString('server_id').trim();
        const idx = db.serverWhitelist.indexOf(serverId);
        if (idx === -1) return interaction.reply({ content: `⚠️ Server \`${serverId}\` is not in the whitelist.`, ephemeral: true });
        db.serverWhitelist.splice(idx, 1);
        saveDb();
        await interaction.reply({ content: `🗑️ Removed \`${serverId}\` from whitelist.`, ephemeral: true });

      } else if (sub === 'list') {
        const list = db.serverWhitelist;
        if (list.length === 0) return interaction.reply({ content: '📋 No extra servers whitelisted. Only your main server can use this bot.', ephemeral: true });
        
        const lines = list.map((id, i) => { const g = client.guilds.cache.get(id); return `\`${i+1}.\` ${g ? `**${g.name}**` : 'Unknown'} — \`${id}\``; }).join('\n');
        
        const selectOptions = list.map(id => {
          const g = client.guilds.cache.get(id);
          const label = g ? g.name : `Server: ${id}`;
          return {
            label: label.slice(0, 100),
            description: `Remove ${label.slice(0, 50)} from server whitelist`,
            value: id
          };
        });

        const embed = new EmbedBuilder()
          .setTitle('🔒 Whitelisted Servers')
          .setDescription(lines)
          .setColor(0x00D4FF)
          .setFooter({ text: `${list.length} server(s)` })
          .setTimestamp();

        const components = [];
        if (selectOptions.length > 0) {
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('remove_whitelist_server_select')
            .setPlaceholder('🛑 Select a server to remove from whitelist')
            .addOptions(selectOptions.slice(0, 25));

          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await interaction.reply({ embeds: [embed], components, ephemeral: true });
      }
    }

    // /ai-embed
    else if (cmd === 'ai-embed') {
      await handleAiEmbed(interaction, db, saveDb, logToChannel, ID);
    }

    // /draw
    else if (cmd === 'draw') {
      const dbService = runtime.getService('DatabaseManager');
      const allowed = dbService.checkAndRecordQuery(interaction.guildId, interaction.user.id);
      if (!allowed) {
        return interaction.reply({
          content: "⏳ You've reached your hourly AI query limit. Try again later.",
          ephemeral: true
        });
      }
      await handleAiDraw(interaction);
    }

    // /lockdown
    else if (cmd === 'lockdown') {
      const action = interaction.options.getString('action');
      const isLock = action === 'on';

      db.emergencyLock = isLock;
      saveDb();

      invalidatePermCache();

      const auditId = generateAuditId();

      const auditLogEmbed = new EmbedBuilder()
        .setTitle('🔐 Emergency Lockdown Status Changed')
        .addFields(
          { name: 'Audit ID', value: `\`${auditId}\`` },
          { name: 'Status', value: isLock ? '🛑 ACTIVE (Emergency Lockdown Enabled)' : '🟢 INACTIVE (Lockdown Lifted)' },
          { name: 'Triggered By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
          { name: 'Time', value: new Date().toUTCString() }
        )
        .setColor(isLock ? 0xE74C3C : 0x2ECC71)
        .setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(isLock ? '🛑 Emergency Lockdown Active' : '🟢 Lockdown Lifted')
            .setDescription(isLock 
              ? 'Emergency Lockdown has been **enabled**. All non-developer management and configuration commands are temporarily suspended.'
              : 'Lockdown has been **lifted**. Standard command access lists and permission checks are fully restored.'
            )
            .setColor(isLock ? 0xE74C3C : 0x2ECC71)
            .setTimestamp()
        ],
        ephemeral: true
      });
    }

    // /whoami
    else if (cmd === 'whoami') {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      let isDevUser = isDeveloper(userId);
      let isGuildOwner = interaction.member && userId === interaction.guild?.ownerId;

      db.guildWhitelists = db.guildWhitelists || {};
      const guildWhitelist = db.guildWhitelists[guildId] || { users: {}, roles: {} };

      let isWhitelistedUser = false;
      let userCaps = [];

      if (guildWhitelist.users && guildWhitelist.users[userId]) {
        isWhitelistedUser = true;
        userCaps = guildWhitelist.users[userId];
      } else if (db.roleWhitelist && db.roleWhitelist.includes(userId)) {
        isWhitelistedUser = true;
        userCaps = ['AI_CONFIG', 'SECURITY_CONFIG', 'MODERATION_EXECUTE', 'ROLE_ASSIGN', 'EMBED_MANAGE', 'TICKET_CONFIG'];
      }

      db.commandRoleWhitelist = db.commandRoleWhitelist || { admin: [], staff: [], member: [] };
      const roleWhitelist = db.commandRoleWhitelist;
      
      const whitelistedRolesList = [];
      if (interaction.member) {
        if (roleWhitelist.admin && roleWhitelist.admin.some(id => interaction.member.roles.cache.has(id))) whitelistedRolesList.push('Admin commands tier');
        if (roleWhitelist.staff && roleWhitelist.staff.some(id => interaction.member.roles.cache.has(id))) whitelistedRolesList.push('Staff commands tier');
        if (roleWhitelist.member && roleWhitelist.member.some(id => interaction.member.roles.cache.has(id))) whitelistedRolesList.push('Normal member commands tier');
      }

      let primaryTier = 'Normal User';
      if (isDevUser) primaryTier = 'Bot Developer';
      else if (isGuildOwner) primaryTier = 'Server Owner';
      else if (isWhitelistedUser) primaryTier = 'Whitelisted User';
      else if (whitelistedRolesList.length > 0) primaryTier = `Whitelisted Role User (${whitelistedRolesList.join(', ')})`;

      const isDiscordAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ? '✅ Yes' : '❌ No';

      const capLabels = {
        AI_CONFIG: 'AI Configuration & Model Management',
        SECURITY_CONFIG: 'Security & Anti-Raid Settings',
        MODERATION_EXECUTE: 'Moderation Execution (Kick/Ban/Purge)',
        ROLE_ASSIGN: 'Whitelisted Role Management',
        EMBED_MANAGE: 'Embed & Say Announcement Management',
        TICKET_CONFIG: 'Ticket System Setup & Config'
      };

      const capListStr = userCaps.length > 0
        ? userCaps.map(c => `✅ \`${c}\` (${capLabels[c] || c})`).join('\n')
        : '❌ None';

      const inspectorEmbed = new EmbedBuilder()
        .setTitle('🔍 Your Permission Profile')
        .setDescription(`Current permissions and access authorization on **${interaction.guild.name}**:`)
        .addFields(
          { name: '👑 Primary Tier', value: `\`${primaryTier}\``, inline: true },
          { name: '🛠️ Discord Administrator', value: `\`${isDiscordAdmin}\``, inline: true },
          { name: '🔑 Granted Capabilities', value: capListStr }
        )
        .setColor(0x00D4FF)
        .setTimestamp();

      await interaction.reply({ embeds: [inspectorEmbed], ephemeral: true });
    }

    // /owner-help
    else if (cmd === 'owner-help') {
      const pages = [
        new EmbedBuilder()
          .setTitle('🚀 Owner Help Center — Getting Started')
          .setDescription(
            'Welcome to **ZENITSU LIVE**! This guide helps server owners and administrators configure the bot for optimal performance.\n\n' +
            '🔹 **1. Inviting the Bot**\n' +
            'Ensure the bot has `Administrator` permissions when inviting it to allow full configuration access.\n\n' +
            '🔹 **2. Initial Setup**\n' +
            '• Run `/setup-panel` to setup ticket systems.\n' +
            '• Run `/ai-channel` to bind a public AI chatting channel.\n' +
            '• Run `/security` to configure anti-spam and anti-raid parameters.'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('🔐 Owner Help Center — Permission Hierarchy')
          .setDescription(
            'ZENITSU LIVE implements a secure 5-tier hierarchical permission system:\n\n' +
            '👑 **1. Bot Developer:** Dynamic resolution. Bypasses all locks and limits.\n' +
            '👑 **2. Server Owner:** Full control of all server and configuration commands.\n' +
            '🛡️ **3. Whitelisted User:** Granular capabilities granted via `/whitelist add`.\n' +
            '👮 **4. Whitelisted Role:** Tier-based command access with optional capabilities via `/whitelist-role add`.\n' +
            '👥 **5. Public Users:** Access to public `/ai` and music commands only.\n\n' +
            '**Whitelist commands:**\n' +
            '• `/whitelist add user:@User capabilities:AI_CONFIG,SECURITY_CONFIG`\n' +
            '• `/whitelist-role add role:@Role tier:staff capabilities:MODERATION_EXECUTE`\n' +
            '• Use `/whitelist list`, `/whitelist-role list`, or `/whitelist-server list` to view and manage entries interactively!'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('🤖 Owner Help Center — AI Features')
          .setDescription(
            'Configuring and interacting with Zenitsu AI:\n\n' +
            '🔹 **AI Channel Chatting:**\n' +
            'Use `/ai-channel` to link a channel. Auto-replies are disabled by default. Users can query AI using `/ai` with memory context preserved.\n\n' +
            '🔹 **Preferred Languages:**\n' +
            'Use `/ai-lang` to set your dialect (English, Hinglish, Tanglish).\n\n' +
            '🔹 **Model Selection:**\n' +
            'Use `/ai-model` to configure the default model (Gemini 2.0, GPT-4o, Llama 3.3).'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('⚔️ Owner Help Center — Moderation Commands')
          .setDescription(
            'Zenitsu provides full-suite moderation utility commands:\n\n' +
            '• `/warn user reason` — Warn a member and increment their case count.\n' +
            '• `/kick user reason` — Kick a member from the server.\n' +
            '• `/ban user reason` — Ban a member (perm/temp).\n' +
            '• `/purge count` — Delete messages in bulk.\n' +
            '• `/lock /unlock` — Lock down channels.\n' +
            '• `/cases user` — List moderation history cases.'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('🎫 Owner Help Center — Support Tickets')
          .setDescription(
            'Setup a ticket support center:\n\n' +
            '• `/setup-panel` — Creates an interactive panel for users to open support tickets.\n' +
            '• **AI Support:** Auto-translation and automated AI response helper in tickets.\n' +
            '• **Transcripts:** Auto-saved transcript history uploaded to moderation log on close.'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('🛡️ Owner Help Center — Server Protection')
          .setDescription(
            'Keep your server safe using `/security` options:\n\n' +
            '• **Anti-Raid:** Automated gate checks for new accounts.\n' +
            '• **Anti-Spam:** Mute/warn members who spam messages.\n' +
            '• **Anti-Scam:** Scan links and messages for phishing scams.\n' +
            '• **Anti-Invite:** Blocks unauthorized discord invite links.'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('🎵 Owner Help Center — Music Player')
          .setDescription(
            'Listen to music with high quality audio:\n\n' +
            '• `/request-song` — Search and queue audio links.\n' +
            '• `/queue` — View current playlist.\n' +
            '• Future updates include 24/7 audio connection and audio filters.'
          )
          .setColor(0xEDC231),

        new EmbedBuilder()
          .setTitle('📜 Owner Help Center — Capability Reference')
          .setDescription(
            'Capabilities to assign using `/whitelist add` or `/whitelist-role add`:\n\n' +
            '• `AI_CONFIG` — 🤖 AI Configuration & Models\n' +
            '• `SECURITY_CONFIG` — 🛡️ Security & Anti-Raid Settings\n' +
            '• `MODERATION_EXECUTE` — 👮 Moderation Execution\n' +
            '• `ROLE_ASSIGN` — 🔑 Whitelisted Role Management\n' +
            '• `EMBED_MANAGE` — 📢 Custom Embeds & Announcements\n' +
            '• `TICKET_CONFIG` — 🎫 Support Ticket Panel Setup\n\n' +
            '*Note: When you appoint a user, the bot will automatically send them a direct message detailing their granted permissions.*'
          )
          .setColor(0xEDC231)
      ];

      pages.forEach((page, i) => {
        page.setFooter({ text: `Page ${i + 1} of ${pages.length} • ZENITSU LIVE Support` });
      });

      let currentPageIndex = 0;

      const getRow = (index) => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('owner_help_prev')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0),
          new ButtonBuilder()
            .setCustomId('owner_help_next')
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(index === pages.length - 1)
        );
      };

      const response = await interaction.reply({
        embeds: [pages[currentPageIndex]],
        components: [getRow(currentPageIndex)],
        ephemeral: true
      });

      const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 120000
      });

      collector.on('collect', async i => {
        if (i.customId === 'owner_help_prev') {
          currentPageIndex--;
        } else if (i.customId === 'owner_help_next') {
          currentPageIndex++;
        }
        await i.update({
          embeds: [pages[currentPageIndex]],
          components: [getRow(currentPageIndex)]
        });
      });
    }
  }



  // ── STRING SELECT MENUS ────────────────────────────────────────────────────
  else if (interaction.isStringSelectMenu()) {
    const { customId, guildId } = interaction;
    if (customId === 'remove_whitelist_select') {
      const isExecOwner = interaction.user.id === interaction.guild?.ownerId || isDeveloper(interaction.user.id);
      if (!isExecOwner) {
        return interaction.reply({ content: '❌ Only the **Server Owner** can modify the bot whitelist.', ephemeral: true });
      }

      await interaction.deferUpdate();

      const targetUserId = interaction.values[0];
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);

      if (db.guildWhitelists?.[guildId]?.users) {
        delete db.guildWhitelists[guildId].users[targetUserId];
      }
      if (db.roleWhitelist) {
        db.roleWhitelist = db.roleWhitelist.filter(id => id !== targetUserId);
      }

      saveDb();
      invalidatePermCache(guildId, targetUserId);

      const auditId = generateAuditId();

      const auditLogEmbed = new EmbedBuilder()
        .setTitle('🔐 Permission Audit Log')
        .addFields(
          { name: 'Audit ID', value: `\`${auditId}\`` },
          { name: 'Action', value: 'Removed Whitelisted User (Interactive)' },
          { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
          { name: 'Target User', value: targetUser ? `${targetUser} (ID: \`${targetUserId}\`)` : `\`${targetUserId}\`` },
          { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
        )
        .setColor(0xE74C3C)
        .setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

      const guildUsers = db.guildWhitelists[guildId]?.users || {};
      const legacyUsers = db.roleWhitelist || [];
      const allUserIds = Array.from(new Set([...Object.keys(guildUsers), ...legacyUsers]));

      const listLines = [];
      const selectOptions = [];

      for (const id of allUserIds) {
        const caps = guildUsers[id] || [];
        const capsFormatted = caps.length > 0
          ? caps.map(c => CAPABILITY_LABELS[c] || c).join(', ')
          : 'Legacy (All capabilities)';
        listLines.push(`• <@${id}> (\`${id}\`)\n  **Capabilities**: ${capsFormatted}`);

        const cachedUser = interaction.client.users.cache.get(id);
        const label = cachedUser ? cachedUser.tag : `User ID: ${id}`;
        selectOptions.push({
          label: label.slice(0, 100),
          description: `Remove ${label.slice(0, 50)} from whitelist`,
          value: id
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Whitelisted Users Directory')
        .setDescription(
          `✅ Successfully removed <@${targetUserId}> from the whitelist.\n` +
          `🛡️ **Audit ID**: \`${auditId}\`\n\n` +
          `Below are the trusted users whitelisted on this server:\n\n` +
          (listLines.length > 0 ? listLines.join('\n\n') : '*No whitelisted users left.*')
        )
        .setColor(0x00D4FF)
        .setTimestamp();

      const components = [];
      if (selectOptions.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('remove_whitelist_select')
          .setPlaceholder('🛑 Select a user to remove from whitelist')
          .addOptions(selectOptions.slice(0, 25));

        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      await interaction.editReply({ embeds: [embed], components });
    }
    
    else if (customId === 'remove_whitelist_role_select') {
      const isExecAdmin = interaction.member && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) || isDeveloper(interaction.user.id));
      if (!isExecAdmin) {
        return interaction.reply({ content: '❌ Only administrators can modify whitelisted roles.', ephemeral: true });
      }

      await interaction.deferUpdate();

      const val = interaction.values[0];
      const parts = val.split('_');
      const tier = parts[0];
      const roleId = parts[1];

      if (db.commandRoleWhitelist[tier]) {
        db.commandRoleWhitelist[tier] = db.commandRoleWhitelist[tier].filter(id => id !== roleId);
      }
      if (db.roleCapabilities) {
        delete db.roleCapabilities[roleId];
      }

      saveDb();
      invalidatePermCache(guildId);

      const auditId = generateAuditId();

      const auditLogEmbed = new EmbedBuilder()
        .setTitle('🔐 Permission Audit Log')
        .addFields(
          { name: 'Audit ID', value: `\`${auditId}\`` },
          { name: 'Action', value: 'Removed Whitelisted Role (Interactive)' },
          { name: 'By', value: `${interaction.user} (ID: \`${interaction.user.id}\`)` },
          { name: 'Target Role ID', value: `\`${roleId}\`` },
          { name: 'Revoked Tier', value: `\`${tier.toUpperCase()}\`` },
          { name: 'Server', value: `\`${interaction.guild.name}\` (ID: \`${guildId}\`)` }
        )
        .setColor(0xE74C3C)
        .setTimestamp();
      await logToChannel(interaction.guild, ID.MOD_LOG, auditLogEmbed);

      const adminRoles = db.commandRoleWhitelist.admin || [];
      const staffRoles = db.commandRoleWhitelist.staff || [];
      const memberRoles = db.commandRoleWhitelist.member || [];

      const selectOptions = [];

      adminRoles.forEach(id => {
        const role = interaction.guild.roles.cache.get(id);
        const label = role ? role.name : `Role ID: ${id}`;
        selectOptions.push({
          label: `Remove ${label.slice(0, 50)} (Admin Tier)`,
          description: `Remove this role from Admin Whitelist`,
          value: `admin_${id}`
        });
      });

      staffRoles.forEach(id => {
        const role = interaction.guild.roles.cache.get(id);
        const label = role ? role.name : `Role ID: ${id}`;
        selectOptions.push({
          label: `Remove ${label.slice(0, 50)} (Staff Tier)`,
          description: `Remove this role from Staff Whitelist`,
          value: `staff_${id}`
        });
      });

      memberRoles.forEach(id => {
        const role = interaction.guild.roles.cache.get(id);
        const label = role ? role.name : `Role ID: ${id}`;
        selectOptions.push({
          label: `Remove ${label.slice(0, 50)} (Member Tier)`,
          description: `Remove this role from Member Whitelist`,
          value: `member_${id}`
        });
      });

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Bot Command Role Whitelist')
        .setDescription(
          `✅ Successfully removed role \`${roleId}\` from the whitelist.\n` +
          `🛡️ **Audit ID**: \`${auditId}\`\n\n` +
          `Custom roles authorized to run Zenitsu bot commands:`
        )
        .addFields(
          { name: '🛠️ Admin Commands Whitelist', value: adminRoles.map(id => `• <@&${id}>`).join('\n') || 'None' },
          { name: '👮 Staff Commands Whitelist', value: staffRoles.map(id => `• <@&${id}>`).join('\n') || 'None' },
          { name: '👥 Normal Member Commands Whitelist', value: memberRoles.map(id => `• <@&${id}>`).join('\n') || 'None' }
        )
        .setColor(0x00D4FF)
        .setTimestamp();

      const components = [];
      if (selectOptions.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('remove_whitelist_role_select')
          .setPlaceholder('🛑 Select a role to remove from whitelist')
          .addOptions(selectOptions.slice(0, 25));

        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      await interaction.editReply({ embeds: [embed], components });
    }

    else if (customId === 'remove_whitelist_server_select') {
      const isExecOwner = isOwner(interaction.user.id);
      if (!isExecOwner) {
        return interaction.reply({ content: '❌ Only the **Bot Owner** can modify whitelisted servers.', ephemeral: true });
      }

      await interaction.deferUpdate();

      const serverId = interaction.values[0];
      if (db.serverWhitelist) {
        db.serverWhitelist = db.serverWhitelist.filter(id => id !== serverId);
      }

      saveDb();

      const list = db.serverWhitelist || [];
      const lines = list.map((id, i) => { const g = client.guilds.cache.get(id); return `\`${i+1}.\` ${g ? `**${g.name}**` : 'Unknown'} — \`${id}\``; }).join('\n');

      const selectOptions = list.map(id => {
        const g = client.guilds.cache.get(id);
        const label = g ? g.name : `Server: ${id}`;
        return {
          label: label.slice(0, 100),
          description: `Remove ${label.slice(0, 50)} from server whitelist`,
          value: id
        };
      });

      const embed = new EmbedBuilder()
        .setTitle('🔒 Whitelisted Servers')
        .setDescription(
          `✅ Successfully removed server \`${serverId}\` from the whitelist.\n\n` +
          (lines.length > 0 ? lines : '*No extra servers whitelisted.*')
        )
        .setColor(0x00D4FF)
        .setFooter({ text: `${list.length} server(s)` })
        .setTimestamp();

      const components = [];
      if (selectOptions.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('remove_whitelist_server_select')
          .setPlaceholder('🛑 Select a server to remove from whitelist')
          .addOptions(selectOptions.slice(0, 25));

        components.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      await interaction.editReply({ embeds: [embed], components });
    }
  }

  // ── BUTTONS ────────────────────────────────────────────────────────────────
  else if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId.startsWith('approve_action_') || customId.startsWith('reject_action_')) {
      const parts = customId.split('_');
      const action = parts[0];
      const auditId = parts[2];

      const isExecOwner = interaction.user.id === interaction.guild?.ownerId || isDeveloper(interaction.user.id);
      if (!isExecOwner) {
        return interaction.reply({ content: '❌ Only the **Server Owner** can authorize this action.', ephemeral: true });
      }

      await interaction.deferUpdate();

      db.pendingApprovals = db.pendingApprovals || {};
      const pending = db.pendingApprovals[auditId];

      if (!pending) {
        return interaction.editReply({
          content: '⚠️ This approval request is expired or invalid.',
          embeds: [],
          components: []
        });
      }

      const color = action === 'approve' ? 0x2ECC71 : 0xE74C3C;
      const statusText = action === 'approve' ? '✅ Approved & Executed' : '❌ Rejected';

      if (action === 'approve') {
        const executionEngine = runtime.getService('CognitionEngine').executionEngine;
        await executionEngine.executePlan(pending.plan, pending.tools, {
          userId: pending.userId,
          guildId: pending.guildId,
          guild: interaction.guild,
          requiresApproval: false
        });
      }

      delete db.pendingApprovals[auditId];
      saveDb();

      const embed = new EmbedBuilder()
        .setTitle('🔒 Security Action Approval')
        .setDescription(`This proposed action has been processed.`)
        .addFields(
          { name: 'Proposed Action', value: `\`${pending.plan.actionsProposed.join(', ')}\`` },
          { name: 'Audit ID', value: `\`${auditId}\`` },
          { name: 'Status', value: `**${statusText}** by ${interaction.user}` }
        )
        .setColor(color)
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: []
      });
      return;
    }

    if (customId.startsWith('setlang_')) {
      const parts = customId.split('_');
      const lang = parts[1];
      const targetUserId = parts[2];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({ content: '❌ Only the user who sent the prompt can choose the language!', ephemeral: true });
      }

      db.userLanguages = db.userLanguages || {};
      db.userLanguages[targetUserId] = lang;
      saveDb();

      const names = { english: 'English 🇬🇧', hinglish: 'Hinglish 🇮🇳', tanglish: 'Tanglish 🐯' };
      
      await interaction.update({
        content: `✅ Preferred language has been set to **${names[lang]}**!\nZENITSU AI will now reply in this dialect. Please type your message/question again!`,
        embeds: [],
        components: []
      });
      return;
    }

    // [7] JOIN GATE — Verify button
    if (customId === 'verify_member') {
      await interaction.deferReply({ ephemeral: true });
      const role = interaction.guild.roles.cache.get(ID.MEMBER_ROLE);
      if (!role) return interaction.editReply({ content: 'MEMBER role not found. Contact an admin.' });

      if (interaction.member.roles.cache.has(ID.MEMBER_ROLE)) {
        return interaction.editReply({ content: '✅ You are already verified and have the **MEMBER** role!' });
      }

      await interaction.member.roles.add(role).catch(() => {});

      // Log to server-logs
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Member Verified')
        .setDescription(`${interaction.user} (${interaction.user.tag}) clicked Verify and received **MEMBER** role.`)
        .setColor(0x2ECC71).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, logEmbed);

      await interaction.editReply({
        content: '🎉 **Verified!** You now have access to:\n💬 `general-chat`\n📸 `feedback`\n🎶 `song-requests`\n🎧 All voice channels!'
      });
    }

    // [1] GET MEMBER ROLE — panel button (same as verify)
    else if (customId === 'get_member_role') {
      await interaction.deferReply({ ephemeral: true });
      const role = interaction.guild.roles.cache.get(ID.MEMBER_ROLE);
      if (!role) return interaction.editReply({ content: 'MEMBER role not found.' });
      if (interaction.member.roles.cache.has(ID.MEMBER_ROLE))
        return interaction.editReply({ content: '✅ You already have the **MEMBER** role!' });
      await interaction.member.roles.add(role).catch(() => {});
      await interaction.editReply({ content: '✅ You have been given the **MEMBER** role! Welcome to **ZENITSU LIVE**!' });
    }

    // ── [21] TICKET CATEGORIES ─────────────────────────────────────────────────
    else if (['ticket_purchase', 'ticket_support', 'ticket_bug', 'ticket_ai'].includes(customId)) {
      await interaction.deferReply({ ephemeral: true });

      const existing = db.activeTickets[interaction.user.id];
      if (existing && interaction.guild.channels.cache.get(existing))
        return interaction.editReply({ content: `You already have an open ticket: <#${existing}>` });

      const typeMap = {
        ticket_purchase: {
          prefix: 'purchase', emoji: '🛒', color: 0x2ECC71,
          title: '🛒 Purchase Ticket',
          desc:  `Hello ${interaction.user}! Please provide:\n\n**1.** Which product do you want?\n**2.** Preferred payment method\n\n> Staff will respond with price and payment details.`,
          ping:  `${interaction.user} | <@&${ID.SUPPORT_ROLE}> | <@&${ID.ADMIN_ROLE}>`,
        },
        ticket_support: {
          prefix: 'support', emoji: '🔧', color: 0x3498DB,
          title: '🔧 Support Ticket',
          desc:  `Hello ${interaction.user}! Please describe:\n\n**1.** Which product has the issue?\n**2.** What is the problem? (detail)\n**3.** When did it start?\n**4.** Provide screenshots if any\n\n> Support team will help you shortly.`,
          ping:  `${interaction.user} | <@&${ID.SUPPORT_ROLE}>`,
        },
        ticket_bug: {
          prefix: 'bug', emoji: '🐛', color: 0xE74C3C,
          title: '🐛 Bug Report',
          desc:  `Hello ${interaction.user}! Please describe the bug:\n\n**1.** Which product/feature?\n**2.** What is happening? (step by step)\n**3.** Does it happen every time?\n**4.** Screenshot or video if possible\n\n> Our team will investigate and fix this.`,
          ping:  `${interaction.user} | <@&${ID.ADMIN_ROLE}>`,
        },
        ticket_ai: {
          prefix: 'ai-support', emoji: '🤖', color: 0x00D4FF,
          title: '🤖 Dedicated AI Support Room',
          desc:  `Hello ${interaction.user}! Welcome to your private AI Support room.\n\n` +
                 `Type any question directly in this channel to converse with **ZENITSU AI**.\n\n` +
                 `> **Staff visibility**: Server administrators can view this channel to assist you if needed.`,
          ping:  `${interaction.user}`,
          isAi:  true
        }
      };

      const t = typeMap[customId];

      // Find the SUPPORT category dynamically or fallback to the correct ID
      let parentCategory = interaction.guild.channels.cache.get(config.categoryTickets);
      if (!parentCategory || parentCategory.type !== ChannelType.GuildCategory) {
        parentCategory = interaction.guild.channels.cache.find(c => c.name.includes('SUPPORT') && c.type === ChannelType.GuildCategory)
          || interaction.guild.channels.cache.get('1444538003824447621');
      }

      const ticketCh = await interaction.guild.channels.create({
        name: `${t.prefix}-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: parentCategory ? parentCategory.id : null,
        topic: `${t.emoji} ${t.prefix.toUpperCase()} ticket for ${interaction.user.tag}`,
        permissionOverwrites: [
          { id: interaction.guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
          { id: ID.ADMIN_ROLE,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
          { id: ID.MOD_ROLE,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
          { id: ID.SUPPORT_ROLE,       allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
        reason: `${t.emoji} Ticket by ${interaction.user.tag}`
      }).catch((e) => {
        console.error('Failed to create ticket channel:', e.message);
        return null;
      });

      if (!ticketCh) return interaction.editReply({ content: 'Could not create ticket. Check bot permissions.' });

      db.activeTickets[interaction.user.id] = ticketCh.id; 
      if (t.isAi) {
        db.aiTickets = db.aiTickets || {};
        db.aiTickets[ticketCh.id] = {
          userId: interaction.user.id,
          createdAt: new Date().toISOString()
        };
      }
      saveDb();

      const ticketEmbed = new EmbedBuilder()
        .setTitle(t.title)
        .setDescription(t.desc)
        .setColor(t.color)
        .setFooter({ text: `Ticket: ${ticketCh.name}` })
        .setTimestamp();
      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
      );
      await ticketCh.send({ content: t.ping, embeds: [ticketEmbed], components: [closeRow] });

      // Language selection buttons
      const langEmbed = new EmbedBuilder()
        .setTitle('🌐 Select Your Language / भाषा चुनें')
        .setDescription(
          'Please select your preferred language for the AI Support Assistant:\n' +
          'AI सहायता के लिए अपनी भाषा चुनें:\n\n' +
          '• **English** — standard English response\n' +
          '• **Tamil (Tunglish)** — Tamil written in English letters (e.g. *Vanakkam*)\n' +
          '• **Hindi (Hinglish)** — Hindi written in English letters (e.g. *Namaste*)\n' +
          '• **Auto-Detect** — automatically detect and match prompt language'
        )
        .setColor(0x00D4FF);

      const langRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_lang_english').setLabel('🇬🇧 English').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_lang_tunglish').setLabel('🌴 Tamil (Tunglish)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_lang_hinglish').setLabel('🇮🇳 Hindi (Hinglish)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_lang_auto').setLabel('🌐 Auto-Detect').setStyle(ButtonStyle.Secondary)
      );

      await ticketCh.send({ embeds: [langEmbed], components: [langRow] });


      const logEmbed = new EmbedBuilder()
        .setTitle(`${t.emoji} Ticket Opened — ${t.prefix.toUpperCase()}`)
        .setDescription(`**User:** ${interaction.user} (${interaction.user.tag})\n**Channel:** ${ticketCh}\n**Type:** ${t.title}`)
        .setColor(t.color).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, logEmbed);

      await interaction.editReply({ content: `${t.emoji} Ticket created: <#${ticketCh.id}>` });
    }

    // Close Ticket
    else if (customId === 'ticket_close') {
      await interaction.reply({ content: '🔒 Closing ticket in 5 seconds...', ephemeral: false });
      for (const [uid, chanId] of Object.entries(db.activeTickets)) {
        if (chanId === interaction.channel.id) { delete db.activeTickets[uid]; saveDb(); break; }
      }
      const closeLog = new EmbedBuilder()
        .setTitle('🔒 Ticket Closed')
        .setDescription(`**Channel:** ${interaction.channel.name}\n**Closed by:** ${interaction.user}`)
        .setColor(0x95A5A6).setTimestamp();
      await logToChannel(interaction.guild, ID.SERVER_LOGS, closeLog);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // Need Staff Button Interaction
    else if (customId === 'ticket_staff_need') {
      await interaction.deferUpdate();

      // Disable AI replies for this ticket
      if (!db.aiAnsweredTickets) db.aiAnsweredTickets = {};
      db.aiAnsweredTickets[interaction.channel.id] = true;
      saveDb();

      // Notify staff in the channel
      await interaction.channel.send({
        content: `🔔 **Staff assistance requested!** Staff will respond shortly.\nIf you want to re-enable AI chat in the meantime, click the button below.`,
        allowedMentions: { parse: ['everyone', 'roles'] }
      }).catch(() => {});

      // Switch to AI Enable button
      const aiRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_ai_enable')
          .setLabel('🤖 Chat with AI')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        components: [aiRow]
      }).catch(() => {});
    }

    // Enable AI Button Interaction
    else if (customId === 'ticket_ai_enable') {
      await interaction.deferUpdate();

      // Re-enable AI replies
      if (db.aiAnsweredTickets) {
        delete db.aiAnsweredTickets[interaction.channel.id];
        saveDb();
      }

      await interaction.channel.send({
        content: `🤖 **AI chat has been re-enabled!** Ask your question, and the assistant will reply.`
      }).catch(() => {});

      // Switch back to Need Staff button
      const staffRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_staff_need')
          .setLabel('🙋 Need Staff')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({
        components: [staffRow]
      }).catch(() => {});
    }

    // Ticket Language Selection
    else if (customId.startsWith('ticket_lang_')) {
      await interaction.deferUpdate();

      const langMap = {
        ticket_lang_english:  { key: 'english',  label: '🇬🇧 English', response: 'Preference saved! Tell me how I can help you today.' },
        ticket_lang_tunglish: { key: 'tunglish', label: '🌴 Tamil (Tunglish)', response: 'Unga language Tamil (Tunglish) save aayiduchu! Ungaluku enna help venum nu sollunga.' },
        ticket_lang_hinglish: { key: 'hinglish', label: '🇮🇳 Hindi (Hinglish)', response: 'Aapka language Hindi (Hinglish) save ho gaya hai! Bataiye main aapki kya madad kar sakta hoon?' },
        ticket_lang_auto:     { key: 'auto',     label: '🌐 Auto-Detect', response: 'Language preference set to Auto-Detect. I will automatically match the language you type. How can I help you today?' }
      };

      const choice = langMap[customId];
      if (!choice) return;

      if (!db.ticketLanguages) db.ticketLanguages = {};
      db.ticketLanguages[interaction.channel.id] = choice.key;
      saveDb();

      // Edit the buttons message to confirm selection
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🌐 Preferred Language Selected / भाषा चुनी गई')
        .setDescription(
          `**Selected:** ${choice.label}\n\n` +
          `💬 *${choice.response}*`
        )
        .setColor(0x2ECC71);

      await interaction.editReply({ embeds: [updatedEmbed], components: [] });
    }

    // AI Channel Buttons
    else if (customId.startsWith('ai_channel_reset_')) {
      const originalUserId = customId.split('_').pop();
      if (interaction.user.id !== originalUserId) {
        return interaction.reply({
          content: '❌ Only the person who initiated this conversation can use this button.',
          ephemeral: true
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const { clearHistory } = require('./modules/ai-handler');
      clearHistory(interaction.user.id, {
        applicationId: interaction.client.application?.id || 'default',
        guildId: interaction.guildId || 'dm',
        channelId: interaction.channelId || 'none'
      });
      await interaction.editReply({ content: '🧹 **Your conversation memory in this channel has been cleared!**' });
    }

    else if (customId === 'ai_chat_dm') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle('🤖 ZENITSU AI PRIVATE CHAT')
          .setDescription('Hello! I am **ZENITSU AI**. Feel free to ask me any questions privately here!')
          .setColor(0x00D4FF)
          .setTimestamp();
        await interaction.user.send({ embeds: [dmEmbed] });
        await interaction.editReply({ content: '📬 **I have sent you a DM!** You can start a private chat with me there.' });
      } catch (err) {
        await interaction.editReply({ content: '❌ **Failed to send DM.** Please check if you have allowed direct messages from server members.' });
      }
    }

    else if (customId.startsWith('ai_channel_message_')) {
      const originalUserId = customId.split('_').pop();
      if (interaction.user.id !== originalUserId) {
        return interaction.reply({
          content: '❌ Only the person who initiated this conversation can use this button.',
          ephemeral: true
        });
      }
      const modal = new ModalBuilder()
        .setCustomId(`ai_followup_modal_${originalUserId}`)
        .setTitle('Message ZENITSU AI');

      const promptInput = new TextInputBuilder()
        .setCustomId('ai_followup_input')
        .setLabel('Type your question below:')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('What is on your mind?')
        .setRequired(true)
        .setMaxLength(1000);

      const row = new ActionRowBuilder().addComponents(promptInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    }

    // Report button
    else if (customId === 'report_submit_btn') {
      const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Submit a Report');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('report_target').setLabel('Who / What are you reporting?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('report_details').setLabel('Describe the issue').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
      await interaction.showModal(modal);
    }

    // Song queue button
    else if (customId === 'view_song_queue') {
      if (!db.songQueue.length) return interaction.reply({ content: 'Queue is empty!', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('🎶 Song Queue')
        .setColor(0xEDC231)
        .setDescription(db.songQueue.slice(0, 15).map((s, i) => `**${i + 1}.** ${s.name} *(${s.requester})*`).join('\n'))
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ── MODALS ─────────────────────────────────────────────────────────────────
  else if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'report_modal') {
      const target  = interaction.fields.getTextInputValue('report_target');
      const details = interaction.fields.getTextInputValue('report_details');
      const embed   = new EmbedBuilder()
        .setTitle('🚨 Report Submitted')
        .setDescription(`**Reporter:** ${interaction.user}\n**Target:** ${target}\n**Details:** ${details}`)
        .setColor(0xFF0000).setTimestamp();
      await logToReports(interaction.guild, embed);
      await interaction.reply({ content: '✅ Report submitted to staff.', ephemeral: true });
    }
    if (interaction.customId === 'uid_modal') {
      const uid = interaction.fields.getTextInputValue('uid_value');
      if (!db.bypasses[uid]) {
        db.bypasses[uid] = { status: 'Bypassed', registeredAt: new Date().toISOString(), userId: interaction.user.id };
        saveDb();
      }
      await interaction.reply({ content: `✅ UID **${uid}** registered as Bypassed.`, ephemeral: true });
    }
    if (interaction.customId.startsWith('ai_followup_modal_')) {
      const originalUserId = interaction.customId.split('_').pop();
      if (interaction.user.id !== originalUserId) {
        return interaction.reply({
          content: '❌ Only the person who initiated this conversation can submit this modal.',
          ephemeral: true
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const prompt = interaction.fields.getTextInputValue('ai_followup_input');

      db.userLanguages = db.userLanguages || {};
      let userLang = db.userLanguages[interaction.user.id] || 'english';

      const modelKey = db.aiDefaultModel || 'gemini';
      const result = await queryAI(interaction.user.id, prompt, modelKey, userLang, {
        applicationId: interaction.client.application?.id || 'default',
        guildId: interaction.guildId || 'dm',
        channelId: interaction.channelId || 'none',
        threadId: interaction.channel?.isThread() ? interaction.channelId : 'none',
        shardId: interaction.client.shard?.ids?.[0]?.toString() || '0'
      });

      // Send analytics
      await logAiAnalytics(interaction.user, prompt, result, interaction.guild);

      if (result.error) {
        return interaction.editReply({ 
          content: '❌ The AI Service is temporarily overloaded. Our team has been notified. Please try again in a few moments!' 
        });
      }

      const aiEmbed = new EmbedBuilder()
        .setAuthor({ name: 'ZENITSU AI', iconURL: interaction.client.user.displayAvatarURL() })
        .setDescription(result.response)
        .setColor(0x00D4FF)
        .setFooter({ text: 'ZENITSU AI • Click buttons below to interact' })
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai_channel_reset_${originalUserId}`).setLabel('💬 Reset Memory').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ai_channel_message_${originalUserId}`).setLabel('🤖 Message AI').setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({ embeds: [aiEmbed], components: [actionRow] });
    }
  }
}

module.exports = { handleInteraction };
