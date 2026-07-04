const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ComponentType,
} = require('discord.js');

const WIZARD_TIMEOUT_MS  = 24 * 60 * 60 * 1000; // 24 hours
const REMINDER_DELAY_MS  = 12 * 60 * 60 * 1000; // remind at 12h

/**
 * SetupWizard
 * Guides the server owner through:
 *   Step 1 — Select trusted channels (multi-select)
 *   Step 2 — Toggle optional access (buttons)
 *   Step 3 — Confirm & trigger initial index
 *
 * Delivery order:
 *   1. DM to owner
 *   2. First writable guild text channel (fallback)
 *   3. If no channel found — log and stop (handled by /setup slash command later)
 */
class SetupWizard {
  constructor(runtime) {
    this.runtime = runtime;
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  get knowledgeEngine() {
    return this.runtime.getService('KnowledgeEngine');
  }

  // ─── Public entry points ──────────────────────────────────────────────────

  /**
   * Deliver the wizard to a guild. Called from OnboardingScanner and /setup.
   * @param {import('discord.js').Guild} guild
   */
  async deliver(guild) {
    const target = await this._resolveDeliveryTarget(guild);
    if (!target) {
      console.warn(`[Wizard] No delivery target for guild ${guild.id}. Awaiting /setup.`);
      return;
    }

    await this._runWizard(guild, target);
  }

  // ─── Delivery target resolution ───────────────────────────────────────────

  async _resolveDeliveryTarget(guild) {
    // Try DM to owner
    try {
      const owner = await guild.fetchOwner();
      const dm    = await owner.createDM();
      return dm;
    } catch {
      console.warn(`[Wizard] DM to owner failed for guild ${guild.id}. Trying guild channel.`);
    }

    // Fallback: first text channel the bot can write to
    const fallback = guild.channels.cache
      .filter(ch =>
        ch.type === ChannelType.GuildText &&
        ch.permissionsFor(guild.members.me).has([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      )
      .sort((a, b) => a.position - b.position)
      .first();

    if (fallback) {
      this.dbService.updateGuild(guild.id, gdb => {
        gdb.setupChannelFallback = fallback.id;
      });
      return fallback;
    }

    return null;
  }

  // ─── Wizard flow ──────────────────────────────────────────────────────────

  async _runWizard(guild, target) {
    const state   = {
      selectedChannels: {},   // { rules: id, faq: id, ... }
      ticketHistory:    false,
      moderationLogs:   false,
    };

    // ── Step 1: Channel selection ──────────────────────────────────────────

    const channelChoices = guild.channels.cache
      .filter(ch => ch.type === ChannelType.GuildText)
      .sort((a, b) => a.position - b.position)
      .map(ch => ({ label: `# ${ch.name}`, value: ch.id }))
      .slice(0, 25); // Discord select menu max

    if (!channelChoices.length) {
      console.warn(`[Wizard] No channels available to configure setup for guild ${guild.id}`);
      return;
    }

    const categorySelect = new StringSelectMenuBuilder()
      .setCustomId('wizard_channel_select')
      .setPlaceholder('Choose channels for each knowledge category...')
      .setMinValues(1)
      .setMaxValues(Math.min(channelChoices.length, 4))
      .addOptions(channelChoices);

    const step1Embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🧙 Sentinel Setup Wizard — Step 1 of 3')
      .setDescription(
        `**Welcome to ${guild.name}!**\n\n` +
        'Select the channels I\'m allowed to learn from.\n' +
        'I will only ever read and index content from these channels.\n\n' +
        '**Categories I support:**\n' +
        '`rules` · `faq` · `announcements` · `guides`\n\n' +
        '_Pick up to 4 channels — one will be assigned per category in order._'
      )
      .setFooter({ text: 'This wizard will expire in 24 hours. Use /setup to restart.' });

    const step1Row = new ActionRowBuilder().addComponents(categorySelect);
    const step1Msg = await target.send({ embeds: [step1Embed], components: [step1Row] });

    // Schedule 12h reminder if wizard not completed
    const reminderTimer = setTimeout(() => this._sendReminder(guild, target), REMINDER_DELAY_MS);

    // Collect channel selection
    let channelInteraction;
    try {
      channelInteraction = await step1Msg.awaitMessageComponent({
        filter:      i => i.customId === 'wizard_channel_select',
        componentType: ComponentType.StringSelect,
        time:        WIZARD_TIMEOUT_MS,
      });
    } catch {
      clearTimeout(reminderTimer);
      await step1Msg.edit({
        content: '⏰ Setup wizard expired. Use `/setup` to restart.',
        embeds: [], components: [],
      });
      return;
    }

    // Map selected channel IDs → categories in order
    const categories = ['rules', 'faq', 'announcements', 'guides'];
    channelInteraction.values.forEach((chId, idx) => {
      if (categories[idx]) state.selectedChannels[categories[idx]] = chId;
    });

    // ── Step 2: Optional access toggles ───────────────────────────────────

    const ticketBtn = new ButtonBuilder()
      .setCustomId('toggle_ticket')
      .setLabel('Ticket History: OFF')
      .setStyle(ButtonStyle.Secondary);

    const modBtn = new ButtonBuilder()
      .setCustomId('toggle_modlogs')
      .setLabel('Mod Logs: OFF')
      .setStyle(ButtonStyle.Secondary);

    const nextBtn = new ButtonBuilder()
      .setCustomId('wizard_next')
      .setLabel('Next →')
      .setStyle(ButtonStyle.Primary);

    const step2Row = new ActionRowBuilder().addComponents(ticketBtn, modBtn, nextBtn);

    const step2Embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🧙 Sentinel Setup Wizard — Step 2 of 3')
      .setDescription(
        '**Optional Access**\n\n' +
        'These are OFF by default. Toggle if you want Sentinel to reference them.\n\n' +
        '⚠️ Mod logs are restricted to staff-role queries only.'
      );

    await channelInteraction.update({ embeds: [step2Embed], components: [step2Row] });

    // Collect toggles until "Next" is pressed
    const step2Collector = step1Msg.createMessageComponentCollector({
      filter: i => ['toggle_ticket', 'toggle_modlogs', 'wizard_next'].includes(i.customId),
      time:   WIZARD_TIMEOUT_MS,
    });

    await new Promise(resolve => {
      step2Collector.on('collect', async i => {
        if (i.customId === 'toggle_ticket') {
          state.ticketHistory = !state.ticketHistory;
          ticketBtn
            .setLabel(`Ticket History: ${state.ticketHistory ? 'ON' : 'OFF'}`)
            .setStyle(state.ticketHistory ? ButtonStyle.Success : ButtonStyle.Secondary);
          await i.update({ components: [new ActionRowBuilder().addComponents(ticketBtn, modBtn, nextBtn)] });
        } else if (i.customId === 'toggle_modlogs') {
          state.moderationLogs = !state.moderationLogs;
          modBtn
            .setLabel(`Mod Logs: ${state.moderationLogs ? 'ON' : 'OFF'}`)
            .setStyle(state.moderationLogs ? ButtonStyle.Success : ButtonStyle.Secondary);
          await i.update({ components: [new ActionRowBuilder().addComponents(ticketBtn, modBtn, nextBtn)] });
        } else if (i.customId === 'wizard_next') {
          step2Collector.stop('next');
          resolve(i);
        }
      });

      step2Collector.on('end', (_, reason) => {
        if (reason !== 'next') resolve(null);
      });
    }).then(async nextInteraction => {
      if (!nextInteraction) {
        clearTimeout(reminderTimer);
        await step1Msg.edit({
          content: '⏰ Setup wizard expired. Use `/setup` to restart.',
          embeds: [], components: [],
        });
        return;
      }

      // ── Step 3: Confirm ──────────────────────────────────────────────────

      const channelLines = Object.entries(state.selectedChannels)
        .map(([cat, id]) => `• \`${cat}\` → <#${id}>`)
        .join('\n') || '_None selected_';

      const confirmEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🧙 Sentinel Setup Wizard — Step 3 of 3')
        .setDescription(
          '**Review your configuration:**\n\n' +
          `**Approved Channels:**\n${channelLines}\n\n` +
          `**Ticket History:** ${state.ticketHistory ? '✅ On' : '❌ Off'}\n` +
          `**Mod Logs:** ${state.moderationLogs ? '✅ On' : '❌ Off'}\n\n` +
          '_Click **Confirm** to save and start indexing, or **Go Back** to restart._'
        );

      const confirmBtn = new ButtonBuilder()
        .setCustomId('wizard_confirm')
        .setLabel('✅ Confirm & Start Indexing')
        .setStyle(ButtonStyle.Success);

      const backBtn = new ButtonBuilder()
        .setCustomId('wizard_back')
        .setLabel('← Go Back')
        .setStyle(ButtonStyle.Danger);

      const step3Row = new ActionRowBuilder().addComponents(confirmBtn, backBtn);
      await nextInteraction.update({ embeds: [confirmEmbed], components: [step3Row] });

      // Await confirm or back
      let confirmInteraction;
      try {
        confirmInteraction = await step1Msg.awaitMessageComponent({
          filter: i => ['wizard_confirm', 'wizard_back'].includes(i.customId),
          time:   WIZARD_TIMEOUT_MS,
        });
      } catch {
        clearTimeout(reminderTimer);
        await step1Msg.edit({
          content: '⏰ Setup wizard expired. Use `/setup` to restart.',
          embeds: [], components: [],
        });
        return;
      }

      if (confirmInteraction.customId === 'wizard_back') {
        await confirmInteraction.update({ content: '↩️ Use `/setup` to restart the wizard.', embeds: [], components: [] });
        clearTimeout(reminderTimer);
        return;
      }

      // ── Persist & trigger index ──────────────────────────────────────────

      this.dbService.updateGuild(guild.id, gdb => {
        Object.assign(gdb.approvedChannels, state.selectedChannels);
        gdb.optionalAccess.ticketHistory  = state.ticketHistory;
        gdb.optionalAccess.moderationLogs = state.moderationLogs;
        gdb.setupCompleted = true;
      });

      clearTimeout(reminderTimer);

      await confirmInteraction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Setup Complete!')
            .setDescription(
              'Sentinel is now indexing your approved channels.\n' +
              'This may take a few minutes depending on channel size.\n\n' +
              'Use `/setup` at any time to reconfigure.'
            ),
        ],
        components: [],
      });

      // Kick off initial indexing (non-blocking)
      this.knowledgeEngine.initialIndex(guild).catch(err =>
        console.error(`[Wizard] Initial index failed for ${guild.id}:`, err)
      );
    });
  }

  // ─── Reminder ─────────────────────────────────────────────────────────────

  async _sendReminder(guild, target) {
    const gdb = this.dbService.getGuildDb(guild.id);
    if (gdb.setupCompleted) return;

    try {
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('⏰ Setup Reminder')
            .setDescription(
              `Setup for **${guild.name}** is still incomplete.\n` +
              'Use `/setup` in your server to continue.'
            ),
        ],
      });
    } catch {
      // If reminder fails, nothing we can do — /setup is the recovery path
    }
  }
}

module.exports = SetupWizard;
