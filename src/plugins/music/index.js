class MusicPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
  }

  async onLoad() {
    this.logger.info('Loading Music Plugin...');
    this.router.registerCommand('queue', (i) => this.handleQueue(i));
    this.router.registerCommand('request-song', (i) => this.handleRequestSong(i));
  }

  async onUnload() {
    this.logger.info('Unloading Music Plugin...');
  }

  async handleQueue(interaction) {
    await interaction.reply({
      content: '🎵 **Current Playlist Queue** is empty. Run `/request-song` to add music!',
      ephemeral: true
    });
  }

  async handleRequestSong(interaction) {
    const song = interaction.options.getString('song');
    await interaction.reply({
      content: `✅ Song **${song}** added to queue! Joining voice channel...`,
      ephemeral: true
    });
  }
}

module.exports = MusicPlugin;
