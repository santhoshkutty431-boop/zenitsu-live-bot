const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');
const play = require('play-dl');

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
  const dotPos = total > 0 ? Math.min(barLen - 1, Math.round((current / total) * barLen)) : 0;
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
      `**[${trackTitle}](${player.currentSongUrl || 'https://youtube.com'})**\n\n` +
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
    const queueList = player.queue.slice(0, 5).map((q, idx) => `\`${idx + 1}.\` ${q.title}`).join('\n');
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
    this.activePlayers = new Map(); // guildId -> { connection, audioPlayer, disconnectTimeout }
  }

  async onLoad() {
    this.logger.info('Loading Music Plugin...');

    try {
      const ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath) {
        process.env.FFMPEG_PATH = ffmpegPath;
      }
    } catch (e) {
      this.logger.warn(`Failed to set FFMPEG_PATH from music plugin: ${e.message}`);
    }

    try {
      const clientId = await play.getFreeClientID();
      if (clientId) {
        await play.setToken({ soundcloud: { client_id: clientId } });
        this.logger.info('SoundCloud client authorized successfully.');
      }
    } catch (scErr) {
      this.logger.warn(`Failed to authorize SoundCloud client: ${scErr.message}`);
    }

    // Register Slash Commands
    this.router.registerCommand('play', (i) => this.handlePlay(i));
    this.router.registerCommand('nowplaying', (i) => this.handleNowPlaying(i));
    this.router.registerCommand('play-now', (i) => this.handlePlayNow(i));
    this.router.registerCommand('pause', (i) => this.handlePause(i));
    this.router.registerCommand('queue', (i) => this.handleQueue(i));
    this.router.registerCommand('setup-music', (i) => this.handleSetup(i));

    // Register Message Request Listener for Setup Channel
    // NOTE: keep a ref so onUnload can remove it — otherwise /reload music
    // stacks a new listener on top of the old one, firing everything twice.
    if (this.runtime.client) {
      this._messageCreateHandler = async (message) => {
        try {
          if (message.author.bot || !message.guild) return;

          const playerState = this.dbService.getMusicPlayer(message.guild.id);
          if (playerState && playerState.setupChannelId && message.channel.id === playerState.setupChannelId) {
            // Delete request message immediately
            await message.delete().catch(() => {});

            const query = message.content.trim();
            if (query.length === 0) return;

            // Check if user is in voice channel
            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
              const sentErr = await message.channel.send(`❌ **${message.author.username}**, you must be in a voice channel to request music!`);
              setTimeout(() => sentErr.delete().catch(() => {}), 4000);
              return;
            }

            // Search and resolve song
            const track = await this.resolveTrack(query);
            if (!track) {
              const sentErr = await message.channel.send(`❌ No song results found for: **${query}**`);
              setTimeout(() => sentErr.delete().catch(() => {}), 4000);
              return;
            }

            // Join and get player
            const guildPlayer = await this.getOrCreatePlayer(voiceChannel);

            // Add to queue
            playerState.queue.push(track);
            this.dbService.saveMusicPlayer(playerState);

            let isPlaying = guildPlayer.audioPlayer.state.status === 'playing';

            if (!isPlaying && !playerState.currentSong) {
              // Start playing immediately if idle
              await this.playTrack(message.guild.id, track);
            } else {
              await this.updateControllerMessage(playerState);
            }

            // Self-deleting confirmation feedback
            const sent = await message.channel.send(`✅ Added **${track.title}** to queue!`);
            setTimeout(() => sent.delete().catch(() => {}), 3000);
          }
        } catch (err) {
          this.logger.error(`Error in music message request handler: ${err.message}`);
        }
      };
      this.runtime.client.on('messageCreate', this._messageCreateHandler);
    }

    // Start 5-second tick clock for progress bars only
    this.startTickClock();
  }

  async onUnload() {
    this.logger.info('Unloading Music Plugin...');
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    // Detach the messageCreate listener so subsequent /reload music doesn't
    // stack duplicate handlers (each would fire on every message).
    if (this._messageCreateHandler && this.runtime.client) {
      this.runtime.client.off('messageCreate', this._messageCreateHandler);
      this._messageCreateHandler = null;
    }
    // Clean up active connections
    for (const [guildId, player] of this.activePlayers.entries()) {
      try {
        player.audioPlayer.stop();
        player.connection.destroy();
      } catch (e) {}
    }
    this.activePlayers.clear();
  }

  startTickClock() {
    if (this.tickInterval) clearInterval(this.tickInterval);

    this.tickInterval = setInterval(async () => {
      try {
        const players = this.dbService.getAllMusicPlayers();
        for (const player of players) {
          const active = this.activePlayers.get(player.guildId);
          if (active && active.audioPlayer.state.status === 'playing') {
            player.positionSec += 5;
            
            // Safety cap
            if (player.positionSec >= player.durationSec) {
              player.positionSec = player.durationSec;
            }

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

  // ─── CORE VOICE / AUDIO OPERATIONS ─────────────────────────────────────────

  _timeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms))
    ]);
  }

  async resolveTrack(query) {
    const preferSoundCloud = !!process.env.RENDER;
    try {
      // If direct URL
      if (query.startsWith('http')) {
        if (query.includes('youtube.com') || query.includes('youtu.be')) {
          const info = await this._timeout(play.video_basic_info(query), 10000).catch(() => null);
          if (info && info.video_details) {
            return {
              title: info.video_details.title,
              url: info.video_details.url,
              duration: info.video_details.durationInSec,
              source: 'youtube'
            };
          }
        } else if (query.includes('soundcloud.com')) {
          const info = await this._timeout(play.soundcloud(query), 10000).catch(() => null);
          if (info) {
            return {
              title: info.name || info.title,
              url: info.url,
              duration: info.durationInSec || Math.floor((info.duration || info.durationInMs || 0) / 1000),
              source: 'soundcloud'
            };
          }
        }
      }

      if (preferSoundCloud) {
        // Try SoundCloud search first
        try {
          const scSearch = await this._timeout(play.search(query, { limit: 1, source: { soundcloud: 'tracks' } }), 10000);
          if (scSearch && scSearch.length > 0) {
            return {
              title: scSearch[0].name || scSearch[0].title,
              url: scSearch[0].permalink || scSearch[0].url,
              duration: scSearch[0].durationInSec || Math.floor((scSearch[0].duration || scSearch[0].durationInMs || 0) / 1000),
              source: 'soundcloud'
            };
          }
        } catch (scErr) {
          this.logger.warn(`SoundCloud search failed for "${query}": ${scErr.message}. Trying YouTube...`);
        }

        // YouTube fallback
        const search = await this._timeout(play.search(query, { limit: 1 }), 10000).catch(() => null);
        if (search && search.length > 0) {
          return {
            title: search[0].title,
            url: search[0].url,
            duration: search[0].durationInSec,
            source: 'youtube'
          };
        }
      } else {
        // Try YouTube search first
        try {
          const search = await this._timeout(play.search(query, { limit: 1 }), 10000);
          if (search && search.length > 0) {
            return {
              title: search[0].title,
              url: search[0].url,
              duration: search[0].durationInSec,
              source: 'youtube'
            };
          }
        } catch (ytErr) {
          this.logger.warn(`YouTube search failed for "${query}": ${ytErr.message}. Trying SoundCloud...`);
        }

        // SoundCloud fallback
        const scSearch = await this._timeout(play.search(query, { limit: 1, source: { soundcloud: 'tracks' } }), 10000).catch(() => null);
        if (scSearch && scSearch.length > 0) {
          return {
            title: scSearch[0].name || scSearch[0].title,
            url: scSearch[0].permalink || scSearch[0].url,
            duration: scSearch[0].durationInSec || Math.floor((scSearch[0].duration || scSearch[0].durationInMs || 0) / 1000),
            source: 'soundcloud'
          };
        }
      }

      return null;
    } catch (err) {
      this.logger.error(`Failed to resolve track for "${query}": ${err.message}`);
      return null;
    }
  }

  async getOrCreatePlayer(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    let player = this.activePlayers.get(guildId);

    if (!player) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      const audioPlayer = createAudioPlayer();
      connection.subscribe(audioPlayer);

      player = { connection, audioPlayer, disconnectTimeout: null };
      this.activePlayers.set(guildId, player);

      // Register event listeners
      audioPlayer.on(AudioPlayerStatus.Idle, () => {
        this.handleTrackEnd(guildId);
      });

      audioPlayer.on('error', (error) => {
        this.logger.error(`Audio player error in guild ${guildId}: ${error.message}`);
        this.handleTrackEnd(guildId);
      });

      // Discord voice servers hiccup routinely — 5s was too aggressive and
      // was almost certainly the cause of the "bot disconnects mid-song" bug.
      // Give it 20s to recover, and only if the underlying WebSocket has
      // actually closed (code 4014) treat it as a real disconnect.
      connection.on(VoiceConnectionStatus.Disconnected, async (_oldState, newState) => {
        try {
          if (newState.reason === 4014) {
            // Kicked from voice / channel deleted — no point retrying
            this.cleanupPlayer(guildId);
            return;
          }
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 20_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 20_000),
          ]);
          // Reconnected — connection continues playing
        } catch {
          this.logger.warn(`Voice connection permanently lost in guild ${guildId} — cleaning up.`);
          this.cleanupPlayer(guildId);
        }
      });

      // Explicit destroyed handler so orphaned entries don't accumulate.
      connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.activePlayers.delete(guildId);
      });
    }

    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
      player.disconnectTimeout = null;
    }

    return player;
  }

  async playTrack(guildId, track) {
    const player = this.activePlayers.get(guildId);
    if (!player) return;

    try {
      let stream;
      try {
        stream = await this._timeout(play.stream(track.url), 12000);
      } catch (streamErr) {
        this.logger.warn(`Failed to stream ${track.title} from YouTube: ${streamErr.message}. Trying SoundCloud fallback...`);
        // If it was a YouTube track, search SoundCloud for the same title and play that instead!
        if (track.source === 'youtube') {
          const fallbackTrack = await this.resolveTrack(track.title);
          if (fallbackTrack && fallbackTrack.source === 'soundcloud') {
            stream = await this._timeout(play.stream(fallbackTrack.url), 12000);
            track.title = fallbackTrack.title;
            track.url = fallbackTrack.url;
            track.duration = fallbackTrack.duration;
            track.source = 'soundcloud';
          }
        }
        if (!stream) throw streamErr; // Re-throw if fallback failed
      }

      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      player.audioPlayer.play(resource);

      // Save state to DB
      const playerState = this.dbService.getMusicPlayer(guildId) || {
        guildId,
        loopMode: 'off',
        volume: 100,
        queue: []
      };

      playerState.currentSong = track.title;
      playerState.currentSongUrl = track.url;
      playerState.durationSec = track.duration;
      playerState.positionSec = 0;
      playerState.isPaused = false;

      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
    } catch (err) {
      this.logger.error(`Failed to play track ${track.title} in guild ${guildId}: ${err.message}`);
      this.handleTrackEnd(guildId);
    }
  }

  async handleTrackEnd(guildId) {
    const playerState = this.dbService.getMusicPlayer(guildId);
    if (!playerState) return;

    if (playerState.loopMode === 'track' && playerState.currentSong) {
      // Replay
      const track = {
        title: playerState.currentSong,
        url: playerState.currentSongUrl,
        duration: playerState.durationSec
      };
      await this.playTrack(guildId, track);
    } else {
      if (playerState.loopMode === 'queue' && playerState.currentSong) {
        playerState.queue.push({
          title: playerState.currentSong,
          url: playerState.currentSongUrl,
          duration: playerState.durationSec
        });
      }

      if (playerState.queue.length > 0) {
        const nextTrack = playerState.queue.shift();
        this.dbService.saveMusicPlayer(playerState);
        await this.playTrack(guildId, nextTrack);
      } else {
        // Queue finished -> Idle
        playerState.currentSong = null;
        playerState.currentSongUrl = null;
        playerState.durationSec = 0;
        playerState.positionSec = 0;
        playerState.isPaused = false;
        
        this.dbService.saveMusicPlayer(playerState);
        await this.updateControllerMessage(playerState);

        // Schedule auto-disconnect after 60s of idle
        const active = this.activePlayers.get(guildId);
        if (active) {
          active.disconnectTimeout = setTimeout(() => {
            this.cleanupPlayer(guildId);
          }, 60000);
        }
      }
    }
  }

  cleanupPlayer(guildId) {
    const player = this.activePlayers.get(guildId);
    if (player) {
      try {
        player.audioPlayer.stop();
        player.connection.destroy();
      } catch (e) {}
      this.activePlayers.delete(guildId);
    }

    const state = this.dbService.getMusicPlayer(guildId);
    if (state) {
      state.currentSong = null;
      state.currentSongUrl = null;
      state.durationSec = 0;
      state.positionSec = 0;
      state.isPaused = false;
      this.dbService.saveMusicPlayer(state);
      this.updateControllerMessage(state).catch(() => {});
    }
  }

  // ─── COMMAND HANDLERS ──────────────────────────────────────────────────────

  async handlePlay(interaction) {
    const query = interaction.options.getString('song');
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const track = await this.resolveTrack(query);
      if (!track) {
        return interaction.editReply({ content: `❌ No results found for: **${query}**` });
      }

      const guildPlayer = await this.getOrCreatePlayer(voiceChannel);

      const playerState = this.dbService.getMusicPlayer(interaction.guildId) || {
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

      let replyMsg = '';
      const isPlaying = guildPlayer.audioPlayer.state.status === 'playing';

      if (!isPlaying && !playerState.currentSong) {
        await this.playTrack(interaction.guildId, track);
        replyMsg = `💿 Now playing: **${track.title}** (${track.source === 'soundcloud' ? 'SoundCloud' : 'YouTube'})`;
      } else {
        playerState.queue.push(track);
        this.dbService.saveMusicPlayer(playerState);
        await this.updateControllerMessage(playerState);
        replyMsg = `✅ Added **${track.title}** to queue!`;
      }

      await interaction.editReply({ content: replyMsg });
    } catch (err) {
      this.logger.error(`Error in handlePlay command: ${err.message}`);
      await interaction.editReply({ content: `❌ An error occurred: ${err.message}` }).catch(() => {});
    }
  }

  async handlePlayNow(interaction) {
    const query = interaction.options.getString('song');
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const track = await this.resolveTrack(query);
      if (!track) {
        return interaction.editReply({ content: `❌ No results found for: **${query}**` });
      }

      const playerState = this.dbService.getMusicPlayer(interaction.guildId) || {
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

      await this.getOrCreatePlayer(voiceChannel);

      if (playerState.currentSong) {
        // Put currently playing song back to queue start
        playerState.queue.unshift({
          title: playerState.currentSong,
          url: playerState.currentSongUrl,
          duration: playerState.durationSec
        });
      }

      await this.playTrack(interaction.guildId, track);
      await interaction.editReply({ content: `⏭️ Interrupted track. Playing **${track.title}** immediately!` });
    } catch (err) {
      this.logger.error(`Error in handlePlayNow command: ${err.message}`);
      await interaction.editReply({ content: `❌ An error occurred: ${err.message}` }).catch(() => {});
    }
  }

  async handleNowPlaying(interaction) {
    const playerState = this.dbService.getMusicPlayer(interaction.guildId);
    if (!playerState || !playerState.currentSong) {
      return interaction.reply({ content: '🎵 Nothing is currently playing.', ephemeral: true });
    }

    const { embed, components } = makeControllerEmbedAndButtons(playerState);
    await interaction.reply({ embeds: [embed], components, ephemeral: false });
  }

  async handlePause(interaction) {
    const playerState = this.dbService.getMusicPlayer(interaction.guildId);
    const active = this.activePlayers.get(interaction.guildId);
    if (!playerState || !playerState.currentSong || !active) {
      return interaction.reply({ content: '⚠️ Nothing is playing to pause/resume.', ephemeral: true });
    }

    playerState.isPaused = !playerState.isPaused;
    if (playerState.isPaused) {
      active.audioPlayer.pause();
    } else {
      active.audioPlayer.unpause();
    }

    this.dbService.saveMusicPlayer(playerState);
    await this.updateControllerMessage(playerState);

    await interaction.reply({
      content: playerState.isPaused ? '⏸️ Player paused.' : '▶️ Player resumed.',
      ephemeral: true
    });
  }

  async handleQueue(interaction) {
    const playerState = this.dbService.getMusicPlayer(interaction.guildId);
    if (!playerState) {
      return interaction.reply({ content: '🎵 Queue is empty.', ephemeral: true });
    }

    const currentTrack = playerState.currentSong ? `💿 **Now Playing:** ${playerState.currentSong}\n\n` : '';
    if (playerState.queue.length === 0) {
      return interaction.reply({ content: `${currentTrack}📋 Queue is empty.`, ephemeral: true });
    }

    const list = playerState.queue.map((q, idx) => `\`${idx + 1}.\` ${q.title}`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📋 Current Music Queue')
      .setDescription(currentTrack + list)
      .setColor(0xEDC231)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }

  async handleSetup(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permissions to setup the music channel.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Determine category. Prefer the guild's saved "categoryTickets" value
    // if present; otherwise fall back to finding a SUPPORT-named category.
    let parentCategory = null;
    try {
      const gdb = this.dbService.getGuildDb(interaction.guildId);
      const savedCategoryId = gdb?.categoryTickets;
      if (savedCategoryId) {
        parentCategory = interaction.guild.channels.cache.get(savedCategoryId) || null;
      }
    } catch (e) {
      this.logger.warn(`Could not read categoryTickets for guild ${interaction.guildId}: ${e.message}`);
    }
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

    const playerState = this.dbService.getMusicPlayer(interaction.guildId) || {
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

    const { embed, components } = makeControllerEmbedAndButtons(playerState);
    const ctrlMsg = await musicChan.send({ embeds: [embed], components });

    playerState.setupChannelId = musicChan.id;
    playerState.setupMessageId = ctrlMsg.id;
    this.dbService.saveMusicPlayer(playerState);

    await interaction.editReply({ content: `✅ Dedicated music control channel created: ${musicChan}` });
  }

  // ─── BUTTON CONTROLS ────────────────────────────────────────────────────────

  async handleControllerButton(interaction) {
    const guildId = interaction.guildId;
    const playerState = this.dbService.getMusicPlayer(guildId);
    const active = this.activePlayers.get(guildId);
    if (!playerState) {
      return interaction.reply({ content: '⚠️ Player not initialized.', ephemeral: true });
    }

    const customId = interaction.customId;

    if (customId === 'music_ctrl_play_pause') {
      if (!active) return interaction.reply({ content: '⚠️ Bot is not currently in a voice channel.', ephemeral: true });
      playerState.isPaused = !playerState.isPaused;
      if (playerState.isPaused) {
        active.audioPlayer.pause();
      } else {
        active.audioPlayer.unpause();
      }
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: playerState.isPaused ? '⏸️ Paused.' : '▶️ Resumed.', ephemeral: true });
    }
    
    else if (customId === 'music_ctrl_skip') {
      if (!active) return interaction.reply({ content: '⚠️ Bot is not currently in a voice channel.', ephemeral: true });
      this.handleTrackEnd(guildId);
      await interaction.reply({ content: '⏭️ Track skipped.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_back') {
      if (!active) return interaction.reply({ content: '⚠️ Bot is not currently in a voice channel.', ephemeral: true });
      playerState.positionSec = 0;
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      
      const currentTrack = {
        title: playerState.currentSong,
        url: playerState.currentSongUrl,
        duration: playerState.durationSec
      };
      await this.playTrack(guildId, currentTrack);
      await interaction.reply({ content: '⏮️ Restarted current track.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_loop') {
      const modes = ['off', 'track', 'queue'];
      const nextIdx = (modes.indexOf(playerState.loopMode) + 1) % modes.length;
      playerState.loopMode = modes[nextIdx];
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: `🔄 Loop mode set to **${playerState.loopMode.toUpperCase()}**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_shuffle') {
      // Shuffle array in-place
      for (let i = playerState.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerState.queue[i], playerState.queue[j]] = [playerState.queue[j], playerState.queue[i]];
      }
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: '🔀 Queue shuffled.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_vol_down') {
      playerState.volume = Math.max(0, playerState.volume - 10);
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: `🔉 Volume lowered to **${playerState.volume}%**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_vol_up') {
      playerState.volume = Math.min(100, playerState.volume + 10);
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: `🔊 Volume raised to **${playerState.volume}%**.`, ephemeral: true });
    }

    else if (customId === 'music_ctrl_clear') {
      playerState.queue = [];
      this.dbService.saveMusicPlayer(playerState);
      await this.updateControllerMessage(playerState);
      await interaction.reply({ content: '🗑️ Queue cleared.', ephemeral: true });
    }

    else if (customId === 'music_ctrl_stop') {
      this.cleanupPlayer(guildId);
      await interaction.reply({ content: '🛑 Player stopped and bot disconnected.', ephemeral: true });
    }
  }
}

module.exports = MusicPlugin;
