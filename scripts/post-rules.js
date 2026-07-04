const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const RULES_CHANNEL_ID = '1444538272884981882'; // 📜┆rules

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const channel = client.channels.cache.get(RULES_CHANNEL_ID);
  if (!channel) {
    console.error('Rules channel not found!');
    process.exit(1);
  }

  // Clear previous messages first
  try {
    const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (fetched && fetched.size > 0) {
      for (const msg of fetched.values()) {
        await msg.delete().catch(() => {});
      }
      console.log('Cleared old rules messages.');
    }
  } catch (err) {
    console.warn('Error clearing old messages:', err.message);
  }

  const rulesEmbed = new EmbedBuilder()
    .setTitle('📜 ZENITSU LIVE — SERVER RULES')
    .setDescription('Welcome to **ZENITSU LIVE**. To maintain a safe, clean, and professional community, all members are required to read and follow our official rules. Failure to comply will result in warnings, mutes, or permanent bans.')
    .addFields(
      {
        name: '🛡️ 1. Respect & General Conduct',
        value: '• Be respectful to all members and staff. Harassment, racism, hate speech, sexism, or toxic behaviors will not be tolerated.\n• Keep conversations civilized. Drama, arguments, and personal attacks belong in private DMs, not our public chats.'
      },
      {
        name: '🚫 2. No Spamming or Self-Promotion',
        value: '• Do not spam text, emojis, capital letters, or mass pings. Keep chat clean and readable.\n• Self-promotion, DM advertising, or posting other Discord server invites is strictly prohibited. The bot will automatically mute offenders.'
      },
      {
        name: '🔞 3. Appropriate Content Only',
        value: '• No NSFW (Not Safe For Work) text, images, profile pictures, or links are allowed. Keep the server family-friendly.\n• Sharing malicious files, viruses, malware, or illegal downloads is an immediate permanent ban.'
      },
      {
        name: '🛒 4. Trade & Shop Security',
        value: '• All purchases must go through our official support ticket system in <#1444538212583473162>.\n• Do not engage in unofficial trading, selling, or buying with other members. We are not responsible for any scams or transactions outside of our official tickets.'
      },
      {
        name: '👑 5. Staff & Support Guidelines',
        value: '• Follow the instructions of administrators and moderators. Their decisions are final.\n• Do not DM staff members for support. If you need help, open a ticket in <#1444538212583473162> and wait patiently for a response.'
      }
    )
    .setColor(0x00D4FF) // Cyan/blue moderation glow
    .setThumbnail(channel.guild.iconURL({ dynamic: true }))
    .setFooter({ text: 'ZENITSU LIVE • Thank you for keeping our community safe!', iconURL: channel.guild.iconURL() })
    .setTimestamp();

  try {
    await channel.send({ embeds: [rulesEmbed] });
    console.log('Successfully posted rules!');
  } catch (err) {
    console.error('Failed to post rules:', err.message);
  }

  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
