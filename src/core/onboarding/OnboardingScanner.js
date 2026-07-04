const { ChannelType } = require('discord.js');

/**
 * OnboardingScanner
 * Triggered on `guildCreate`. Scans guild metadata (no message content),
 * initialises the isolated guild database, then delivers the Setup Wizard.
 */
class OnboardingScanner {
  constructor(runtime) {
    this.runtime = runtime;
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  get setupWizard() {
    return this.runtime.getService('SetupWizard');
  }

  /**
   * @param {import('discord.js').Guild} guild
   */
  async run(guild) {
    try {
      // 1. Scan structural metadata — no message content ever read here
      const metadata = await this._scanMetadata(guild);

      // 2. Initialise (or rehydrate) the isolated guild DB
      this.dbService.updateGuild(guild.id, guildDb => {
        guildDb.metadata = metadata;
      });

      console.log(`[Onboarding] Registered guild ${guild.id} (${metadata.name})`);

      // 3. Deliver the Setup Wizard
      await this.setupWizard.deliver(guild);
    } catch (err) {
      console.error(`[Onboarding] Failed for guild ${guild.id}:`, err);
    }
  }

  /**
   * Gather server structure without reading any message content.
   * @param {import('discord.js').Guild} guild
   * @returns {Promise<object>}
   */
  async _scanMetadata(guild) {
    await guild.fetch().catch(() => {});
    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const textChannels = guild.channels.cache
      .filter(ch => ch.type === ChannelType.GuildText)
      .map(ch => ({
        id:   ch.id,
        name: ch.name,
        parentId: ch.parentId ?? null,
      }));

    const roles = guild.roles.cache
      .filter(r => !r.managed && r.id !== guild.id) // exclude @everyone & bot-managed
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id:       r.id,
        name:     r.name,
        position: r.position,
        permissions: r.permissions.toArray(),
      }));

    return {
      name:        guild.name,
      ownerId:     guild.ownerId,
      memberCount: guild.memberCount,
      channels:    textChannels,
      roles,
    };
  }
}

module.exports = OnboardingScanner;
