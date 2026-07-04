const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeControllerEmbedAndButtons(player) {
  const total = player.durationSec || 0;
  const current = player.positionSec || 0;
  
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const barLen = 12;
  const dotPos = total > 0 ? Math.round((current / total) * barLen) : 0;
  const bar = '▬'.repeat(Math.max(0, dotPos)) + '🔘' + '▬'.repeat(Math.max(0, barLen - dotPos - 1));

  const statusEmoji = player.isPaused ? '⏸️ Paused' : '💿 Now Playing';
  const trackTitle = player.currentSong || 'Nothing playing';
  const volumeEmoji = player.volume > 50 ? '🔊' : (player.volume > 0 ? '🔉' : '🔇');

  const embed = new EmbedBuilder()
    .setTitle('🎵 Zenitsu Live Music System')
    .setColor(player.isPaused ? 0x2F3136 : 0xEDC231)
    .setTimestamp();

  if (player.currentSong) {
    embed.setDescription(
      `### ${statusEmoji}\n` +
      `**[${trackTitle}](https://youtube.com)**\n\n` +
      `\`${formatTime(current)}\` ${bar} \`${formatTime(total)}\`\n\n` +
      `• **Volume:** ${volumeEmoji} \`${player.volume}%\`  |  • **Loop Mode:** \`${player.loopMode.toUpperCase()}\``
    );
  } else {
    embed.setDescription(
      `### 💤 Player Idle\n` +
      `Type a song name or YouTube link directly in this channel to start playing!`
    );
  }

  if (player.queue && player.queue.length > 0) {
    const queueList = player.queue.slice(0, 5).map((q, idx) => `\`${idx + 1}.\` ${q}`).join('\n');
    const remaining = player.queue.length > 5 ? `\n*...and ${player.queue.length - 5} more track(s)*` : '';
    embed.addFields({ name: '📋 Upcoming Queue', value: queueList + remaining });
  }

  const rows = [];
  
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_ctrl_back')
      .setLabel('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_play_pause')
      .setLabel(player.isPaused ? '▶️' : '⏸️')
      .setStyle(player.isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_skip')
      .setLabel('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_loop')
      .setLabel(`🔄 ${player.loopMode === 'off' ? 'Off' : (player.loopMode === 'track' ? 'Track' : 'Queue')}`)
      .setStyle(player.loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_shuffle')
      .setLabel('🔀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(player.queue.length < 2)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_ctrl_vol_down')
      .setLabel('🔉')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_vol_up')
      .setLabel('🔊')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.currentSong),
    new ButtonBuilder()
      .setCustomId('music_ctrl_clear')
      .setLabel('🗑️ Clear Queue')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(player.queue.length === 0),
    new ButtonBuilder()
      .setCustomId('music_ctrl_stop')
      .setLabel('🛑 Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!player.currentSong)
  );

  rows.push(row1, row2);
  return { embed, components: rows };
}

class MusicPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = runtime.getService('DatabaseManager');
    this.router = runtime.getService('CommandRouter');
    this.tickInterval = null;
  }

  async onLoad() {
    this.logger.info('Loading Music Plugin...');

    // Register Slash Commands
    this.router.registerCommand('play', (i) => this.handlePlay(i));
    this.router.registerCommand('nowplaying', (i) => this.handleNowPlaying(i));
    this.router.registerCommand('play-now', (i) => this.handlePlayNow(i));
    this.router.registerCommand('pause', (i) => this.handlePause(i));
    this.router.registerCommand('queue', (i) => this.handleQueue(i));
    this.router.registerCommand('setup-music', (i) => this.handleSetup(i));

    // Register Message Request Listener for Setup Channel
    if (this.runtime.client) {
      this.runtime.client.on('messageCreate', async (message) => {
        try {
          if (message.author.bot || !message.guild) return;

          const player = this.dbService.getMusicPlayer(message.guild.id);
          if (player && player.setupChannelId && message.channel.id === player.setupChannelId) {
            // Delete request message immediately
            await message.delete().catch(() => {});

            const query = message.content.trim();
            if (query.length === 0) return;

            // Add to queue
            player.queue.push(query);

            if (!player.currentSong) {
              // Start playing immediately if idle
              player.currentSong = player.queue.shift();
              player.positionSec = 0;
              player.durationSec = Math.floor(Math.random() * 120) + 120; // 2-4 minutes
              player.isPaused = false;
            }

            this.dbService.saveMusicPlayer(player);
            await this.updateControllerMessage(player);

            // Self-deleting confirmation feedback
            const sent = await message.channel.send(`✅ Added **${query}** to queue!`);
            setTimeout(() => sent.delete().catch(() => {}), 3000);
          }
        } catch (err) {
          this.logger.error(`Error in music message request handler: ${err.message}`);
        }
      });
    }

    // Start 5-second tick clock for progress bars and track transitions
    this.startTickClock();
  }

  async onUnload() {
    this.logger.info('Unloading Music Plugin...');
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
  }

  startTickClock() {
    if (this.tickInterval) clearInterval(this.tickInterval);

    this.tickInterval = setInterval(async () => {
      try {
        const players = this.dbService.getAllMusicPlayers();
        for (const player of players) {
          let stateChanged = false;

          if (player.currentSong && !player.isPaused) {
            player.positionSec += 5;
            stateChanged = true;

            // Track finished -> Skip to next
            if (player.positionSec >= player.durationSec) {
              if (player.loopMode === 'track') {
                player.positionSec = 0;
              } else {
                if (player.loopMode === 'queue') {
                  player.queue.push(player.currentSong);
                }
                
                if (player.queue.length > 0) {
                  player.currentSong = player.queue.shift();
                  player.positionSec = 0;
                  player.durationSec = Math.floor(Math.random() * 120) + 120; // 2-4 minutes
                } else {
                  player.currentSong = null;
                  player.positionSec = 0;
                  player.durationSec = 0;
                }
              }
            }
          }

          // Save state & update controller message if anything changed (or periodically to keep bar moving)
          if (stateChanged || (player.currentSong && player.positionSec % 10 === 0)) {
            this.dbService.saveMusicPlayer(player);
            await this.updateControllerMessage(player);
          }
        }
      } catch (err) {
        this.logger.error(`Error in music tick interval: ${err.message}`);
      }
    }, 5000);
  }

  async updateControllerMessage(player) {
    if (!player.setupChannelId || !player.setupMessageId) return;

    try {
      const channel = await this.runtime.client.channels.fetch(player.setupChannelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(player.setupMessageId).catch(() => null);
        if (msg) {
          const { embed, components } = makeControllerEmbedAndButtons(player);
          await msg.edit({ embeds: [embed], components }).catch(() => null);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to update music controller message: ${err.message}`);
    }
  }

  // ─── COMMAND HANDLERS ──────────────────────────────────────────────────────

  async handlePlay(interaction) {
    const query = interaction.options.getString('song');
    const guildId = interaction.guildId;

    let player = this.dbService.getMusicPlayer(guildId) || {
      guildId,
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

    player.queue.push(query);
    let startMsg = '';

    if (!player.currentSong) {
      player.currentSong = player.queue.shift();
      player.positionSec = 0;
      player.durationSec = Math.floor(Math.random() * 120) + 120;
      player.isPaused = false;
      startMsg = `💿 Now playing: **${player.currentSong}**`;
    } else {
      startMsg = `✅ Added **${query}** to queue!`;
    }

    this.dbService.saveMusicPlayer(player);
    await this.updateControllerMessage(player);

    await interaction.reply({ content: startMsg, ephemeral: true });
  }

  async handlePlayNow(interaction) {
    const query = interaction.options.getString('song');
    const guildId = interaction.guildId;

    let player = this.dbService.getMusicPlayer(guildId) || {
      guildId,
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

    if (player.currentSong) {
      // Put currently playing song back to start of queue
      player.queue.unshift(player.currentSong);
    }

    player.currentSong = query;
    player.positionSec = 0;
    player.durationSec = Math.floor(Math.random() * 120) + 120;
    player.isPaused = false;

    this.dbService.saveMusicPlayer(player);
    await this.updateControllerMessage(player);

    await interaction.reply({ content: `⏭️ Interrupted current track. Now playing: **${query}** immediately!`, ephemeral: true });
  }

  async handleNowPlaying(interaction) {
    const player = this.dbService.getMusicPlayer(interaction.guildId);
    if (!player || !player.currentSong) {
      return interaction.reply({ content: '🎵 Nothing is currently playing.', ephemeral: true });
    }

    const { embed, components } = makeControllerEmbedAndButtons(player);
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  }

  async handlePause(interaction) {
    const player = this.dbService.getMusicPlayer(interaction.guildId);
    if (!player || !player.currentSong) {
      return interaction.reply({ content: '⚠️ Nothing is playing to pause/resume.', ephemeral: true });
    }

    player.isPaused = !player.isPaused;
    this.dbService.saveMusicPlayer(player);
    await this.updateControllerMessage(player);

    await interaction.reply({
      content: player.isPaused ? '⏸️ Player paused.' : '▶️ Player resumed.',
      ephemeral: true
    });
  }

  async handleQueue(interaction) {
    const player = this.dbService.getMusicPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({ content: '🎵 Queue is empty.', ephemeral: true });
    }

    const currentTrack = player.currentSong ? `💿 **Now Playing:** ${player.currentSong}\n\n` : '';
    if (player.queue.length === 0) {
      return interaction.reply({ content: `${currentTrack}📋 Queue is empty.`, ephemeral: true });
    }

    const list = player.queue.map((q, idx) => `\`${idx + 1}.\` ${q}`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📋 Current Music Queue')
      .setDescription(currentTrack + list)
      .setColor(0xEDC231)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async handleSetup(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permissions to setup the music channel.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Determine category
    const config = this.dbService.getGuildKey(interaction.guildId, 'categoryTickets') || {};
    let parentCategory = interaction.guild.channels.cache.get(config.categoryTickets);
    if (!parentCategory) {
      parentCategory = interaction.guild.channels.cache.find(c => c.name.includes('SUPPORT') && c.type === ChannelType.GuildCategory);
    }

    // Create channel
    const musicChan = await interaction.guild.channels.create({
      name: 'zenitsu-music',
      type: ChannelType.GuildText,
      parent: parentCategory ? parentCategory.id : null,
      topic: '🎵 Type song name/link to queue. Use the buttons below to control the player.',
    });

    const player = this.dbService.getMusicPlayer(interaction.guildId) || {
      guildId: interaction.guildId,
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

    const { embed, components } = makeControllerEmbedAndButtons(player);
    const ctrlMsg = await musicChan.send({ embeds: [embed], components });

    player.setupChannelId = musicChan.id;
    player.setupMessageId = ctrlMsg.id;
    this.dbService.saveMusicPlayer(player);

    await interaction.editReply({ content: `✅ Dedicated music control channel created: ${musicChan}` });
  }

  // ─── BUTTON CONTROLS ────────────────────────────────────────────────────────

  async handleControllerButton(interaction) {
    const player = this.dbService.getMusicPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({ content: '⚠️ Player not initialized.', ephemeral: true });
    }

    const customId = interaction.customId;

    if (customId === 'music_ctrl_play_pause') {
      player.isPaused = !player.isPaused;
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: player.isPaused ? '⏸️ Paused.' : '▶️ Resumed.', ephemeral: true });
    }
    
    else if (customId === 'music_ctrl_skip') {
      if (player.queue.length > 0) {
        player.currentSong = player.queue.shift();
        player.positionSec = 0;
        player.durationSec = Math.floor(Math.random() * 120) + 120;
        player.isPaused = false;
      } else {
        player.currentSong = null;
        player.positionSec = 0;
        player.durationSec = 0;
      }
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: '⏭️ Track skipped.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_back') {
      player.positionSec = 0;
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: '⏮️ Restarted current track.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_loop') {
      const modes = ['off', 'track', 'queue'];
      const nextIdx = (modes.indexOf(player.loopMode) + 1) % modes.length;
      player.loopMode = modes[nextIdx];
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: `🔄 Loop mode set to **${player.loopMode.toUpperCase()}**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_shuffle') {
      // Shuffle array in-place
      for (let i = player.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]];
      }
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: '🔀 Queue shuffled.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_vol_down') {
      player.volume = Math.max(0, player.volume - 10);
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: `🔉 Volume lowered to **${player.volume}%**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_vol_up') {
      player.volume = Math.min(100, player.volume + 10);
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: `🔊 Volume raised to **${player.volume}%**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_clear') {
      player.queue = [];
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: '🗑️ Queue cleared.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_stop') {
      player.currentSong = null;
      player.positionSec = 0;
      player.durationSec = 0;
      player.queue = [];
      this.dbService.saveMusicPlayer(player);
      await this.updateControllerMessage(player);
      await interaction.reply({ content: '🛑 Player stopped.', ephemeral: true });
    }
  }
}

module.exports = MusicPlugin;
