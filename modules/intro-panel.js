/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   INTRO PANEL — feature showcase + quick setup on join         ║
 * ║   modules/intro-panel.js                                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * When the bot joins a server, it posts a rich "here's what I can do" panel
 * to the best available channel, with buttons the owner can click to set the
 * bot up their way. Keeps every server's setup tailored to that server.
 */

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildIntroPanel(guild) {
  const embed = new EmbedBuilder()
    .setTitle('⚡ ZENITSU LIVE — Your All-in-One Server Assistant')
    .setDescription(
      `Hey **${guild.name}**! Thanks for adding me. Here's everything I can do — ` +
      `and you can set it all up your way in seconds using the buttons below.`
    )
    .addFields(
      { name: '🛡️ Security & Moderation', value: 'Anti-raid, anti-nuke, semantic anti-scam (AI catches disguised scams), auto-mod, `/ban` `/kick` `/warn` `/timeout` `/purge`, full case history.', inline: false },
      { name: '🎫 Support Tickets', value: 'One-click ticket panel — Purchase / Support / Bug / AI-assisted rooms, with transcripts.', inline: true },
      { name: '🎵 Music', value: 'Play from YouTube/SoundCloud with an interactive control panel.', inline: true },
      { name: '🤖 AI', value: '`/ai` chat for everyone, plus `/dev-ai` — do ANYTHING in the server from a plain-English prompt (owner + whitelisted only).', inline: false },
      { name: '📋 Logging & XP', value: 'Message/voice/mod logs, member join/leave, and an XP level system.', inline: true },
      { name: '🔐 Permissions', value: 'Secure whitelist tiers so only trusted people configure the bot.', inline: true },
    )
    .setColor(0xEDC231)
    .setFooter({ text: 'Tip: click ⚡ Quick Setup to auto-configure everything for this server.' })
    .setTimestamp();

  const avatar = guild.client?.user?.displayAvatarURL?.();
  if (avatar && /^https?:\/\//.test(avatar)) embed.setThumbnail(avatar);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('intro_quicksetup').setLabel('⚡ Quick Setup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('intro_tickets').setLabel('🎫 Setup Tickets').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('intro_logs').setLabel('📋 Setup Logs').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('intro_music').setLabel('🎵 Setup Music').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('intro_commands').setLabel('📖 All Commands').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Find the best channel to post in: system channel, else first text channel
// the bot can send to.
function pickIntroChannel(guild) {
  const me = guild.members.me;
  const canSend = (ch) => ch?.isTextBased?.() && ch.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']);
  if (canSend(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache
    .filter(c => canSend(c))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first() || null;
}

async function postIntro(guild) {
  try {
    const channel = pickIntroChannel(guild);
    const panel = buildIntroPanel(guild);
    if (channel) {
      await channel.send(panel).catch(() => {});
    }
    // Also DM the owner so they never miss it.
    const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
    if (owner) await owner.send(panel).catch(() => {});
  } catch { /* best effort */ }
}

module.exports = { buildIntroPanel, postIntro };
