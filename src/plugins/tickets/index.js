const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

class TicketPlugin {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.router = runtime.getService('CommandRouter');
    this.dbService = runtime.getService('DatabaseManager');
  }

  async onLoad() {
    this.logger.info('Loading Tickets Plugin...');
    this.router.registerCommand('setup-panel', (i) => this.handleSetupPanel(i));
    this.router.registerCommand('setup-verify', (i) => this.handleSetupVerify(i));
  }

  async onUnload() {
    this.logger.info('Unloading Tickets Plugin...');
  }

  async handleSetupPanel(interaction) {
    const isExecAdmin = interaction.member && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === '1444538003824447621');
    if (!isExecAdmin) {
      return interaction.reply({ content: '❌ Only administrators can construct the Control Panel.', ephemeral: true });
    }

    const config = this.dbService.db.config || {};

    // Row 1 — Ticket Categories
    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_purchase').setLabel('🛒 Purchase').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_support').setLabel('🔧 Support').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_bug').setLabel('🐛 Bug Report').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_ai').setLabel('🤖 AI Support').setStyle(ButtonStyle.Secondary)
    );

    // Row 2 — Other panel buttons
    const utilRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('report_submit_btn').setLabel('🚨 Report User').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('view_song_queue').setLabel('🎶 Song Queue').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('get_member_role').setLabel('✅ Get Member Role').setStyle(ButtonStyle.Primary),
    );

    const embed = new EmbedBuilder()
      .setTitle('🖥️ ZENITSU LIVE — CONTROL PANEL')
      .setDescription(
        '**─── 🎫 OPEN A TICKET ───**\n' +
        '🛒 **Purchase** — Buy a product / place an order\n' +
        '🔧 **Support** — Get help with an existing product\n' +
        '🐛 **Bug Report** — Report a bug or issue\n' +
        '🤖 **AI Support** — Start a private conversation with ZENITSU AI\n\n' +
        '**─── OTHER ───**\n' +
        '🚨 **Report User** — Report a rule-breaking member\n' +
        '🎶 **Song Queue** — View active waifu song requests\n' +
        '✅ **Get Member Role** — Unlock the full community'
      )
      .setColor(0xEDC231)
      .setThumbnail(interaction.guild.iconURL())
      .setFooter({ text: 'ZENITSU LIVE Automation v5.0' })
      .setTimestamp();

    const targetCh = interaction.options.getChannel('channel') || interaction.channel;
    
    await targetCh.send({ embeds: [embed], components: [ticketRow, utilRow] });
    await interaction.reply({ content: `✅ Control Panel posted in <#${targetCh.id}>`, ephemeral: true });
  }

  async handleSetupVerify(interaction) {
    const isExecAdmin = interaction.member && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === '1444538003824447621');
    if (!isExecAdmin) {
      return interaction.reply({ content: '❌ Only administrators can construct the Verification Panel.', ephemeral: true });
    }

    const verifyEmbed = new EmbedBuilder()
      .setTitle('👋 Welcome to ZENITSU LIVE')
      .setDescription(
        '> Thank you for joining! To unlock the community and get full access to the server, please read the rules and click the verification button below.\n\n' +
        '**📜 Server Rules:** Read <#1444538272884981882> before verifying.\n\n' +
        '**Click ✅ Verify below to get started!**'
      )
      .setColor(0xEDC231)
      .setThumbnail(interaction.guild.iconURL())
      .setFooter({ text: 'ZENITSU LIVE Verification' })
      .setTimestamp();

    const verifyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_member')
        .setLabel('✅ Verify & Get Access')
        .setStyle(ButtonStyle.Success)
    );

    const targetCh = interaction.options.getChannel('channel') || interaction.channel;
    await targetCh.send({ embeds: [verifyEmbed], components: [verifyRow] });
    await interaction.reply({ content: `✅ Verification Panel posted in <#${targetCh.id}>`, ephemeral: true });
  }
}

module.exports = TicketPlugin;
