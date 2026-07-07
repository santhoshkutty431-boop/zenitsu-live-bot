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
    this.router.registerCommand('setup-ticket-channel', (i) => this.handleSetupPanel(i));
    this.router.registerCommand('setup-welcome-channel', (i) => this.handleSetupVerify(i));
  }

  async onUnload() {
    this.logger.info('Unloading Tickets Plugin...');
  }

  async handleSetupPanel(interaction) {
    const isExecAdmin = interaction.member && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === '1444538003824447621');
    if (!isExecAdmin) {
      return interaction.reply({ content: '❌ Only administrators can construct the Control Panel.', ephemeral: true });
    }

    const db = this.dbService.db || {};
    const customTicketImg = db.ticketImage || 'https://media1.tenor.com/m/V8G4820rM01C8AAAAd/zenitsu-demon-slayer.gif';

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
      .setTitle('🛡️ ZENITSU SECURITY SYSTEM')
      .setDescription(
        `**Admin:** ${interaction.guild.members.cache.get(interaction.guild.ownerId)?.user.username || 'Server Owner'} • <t:${Math.floor(Date.now() / 1000)}:t>\n` +
        `**${interaction.guild.name} - Official Tickets System**\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Welcome to the official ticket system of **${interaction.guild.name}**.\n` +
        `Open a ticket for purchases, support, or any product-related inquiries.\n\n` +
        `💛 **Rules:-**\n` +
        `• Tickets are only for purchases and support.\n` +
        `• Any unrelated requests - instant ban.\n` +
        `• Maintain respect with staff at all times.\n\n` +
        `Interact with the below buttons to proceed!`
      )
      .setColor(0x2F3136)
      .setImage(customTicketImg)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setFooter({ text: `Secure Core v2 - Powered by Zenitsu Security` })
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

    const db = this.dbService.db || {};
    const customWelcomeImg = db.welcomeImage || 'https://media1.tenor.com/m/V_zC24-B97cAAAAC/zenitsu-demon-slayer.gif';

    const verifyEmbed = new EmbedBuilder()
      .setTitle('🛡️ WELCOME GATE SYSTEM')
      .setDescription(
        `**Admin:** ${interaction.guild.members.cache.get(interaction.guild.ownerId)?.user.username || 'Server Owner'} • <t:${Math.floor(Date.now() / 1000)}:t>\n` +
        `**${interaction.guild.name} - Verification Portal**\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Welcome to **${interaction.guild.name}**! To prevent automated bot accounts and gain full access, please read the rules and click the verification button below.\n\n` +
        `💛 **Quick Rules:-**\n` +
        `• Make sure to read the server rules before verifying.\n` +
        `• Clicking the button will assign you the **Member** role.\n` +
        `• Maintain a friendly environment at all times.\n\n` +
        `Click the ✅ **Verify & Get Access** button to join!`
      )
      .setColor(0x2F3136)
      .setImage(customWelcomeImg)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setFooter({ text: `Secure Core v2 - Powered by Zenitsu Security` })
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
