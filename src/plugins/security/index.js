const { EmbedBuilder } = require('discord.js');
const { DEFAULT_SECURITY_CONFIG } = require('../../../modules/security');

class SecurityPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
    this.dbService = runtime.getService('DatabaseManager');
  }

  async onLoad() {
    this.logger.info('Loading Security Plugin...');
    this.router.registerCommand('security', (i) => this.handleSecurity(i));
  }

  async onUnload() {
    this.logger.info('Unloading Security Plugin...');
  }

  async handleSecurity(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;
      
      const gdb = this.dbService.getGuildDb(guildId);
      if (!gdb.securityConfig) {
        gdb.securityConfig = { ...DEFAULT_SECURITY_CONFIG };
      }
      const cfg = gdb.securityConfig;

      if (sub === 'status') {
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
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'toggle-antinuke') {
        cfg.antiNukeEnabled = !cfg.antiNukeEnabled;
        this.dbService.saveGuildDb(guildId);
        return interaction.reply({ content: `💣 Anti-Nuke is now **${cfg.antiNukeEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });
      }

      if (sub === 'toggle-antiraid') {
        cfg.antiRaidEnabled = !cfg.antiRaidEnabled;
        this.dbService.saveGuildDb(guildId);
        return interaction.reply({ content: `🔒 Anti-Raid is now **${cfg.antiRaidEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });
      }

      if (sub === 'toggle-quarantine') {
        cfg.quarantineEnabled = !cfg.quarantineEnabled;
        this.dbService.saveGuildDb(guildId);
        return interaction.reply({ content: `🔒 Auto-Quarantine is now **${cfg.quarantineEnabled ? 'Enabled ✅' : 'Disabled ❌'}**`, ephemeral: true });
      }
    } catch (err) {
      this.logger.error('Error in handleSecurity command:', err);
      return interaction.reply({ content: `❌ Failed to execute security command: ${err.message}`, ephemeral: true }).catch(() => {});
    }
  }
}

module.exports = SecurityPlugin;
