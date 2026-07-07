/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ANIMATIONS — frame-by-frame message effects                 ║
 * ║   modules/animations.js                                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Discord has no native animation, so we simulate it by editing a single
 * message through a sequence of "frames" with short delays. Used for a
 * flashy welcome reveal and a ticket-creation effect.
 *
 * Kept deliberately short (a handful of edits) to respect Discord rate limits.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Reusable: play a set of embed frames on one message ─────────────────────
async function playFrames(channelOrMessage, frames, { delay = 750, isMessage = false } = {}) {
  let msg = isMessage ? channelOrMessage : null;
  for (let i = 0; i < frames.length; i++) {
    const payload = { embeds: [frames[i]] };
    if (!msg) {
      msg = await channelOrMessage.send(payload).catch(() => null);
      if (!msg) return null;
    } else {
      await msg.edit(payload).catch(() => {});
    }
    if (i < frames.length - 1) await sleep(delay);
  }
  return msg;
}

// ── WELCOME ANIMATION ────────────────────────────────────────────────────────
// A portal "opening" reveal that lands on a polished welcome card.
function welcomeFrames(member, { rulesId } = {}) {
  const guild = member.guild;
  const name = member.user.username;
  const count = guild.memberCount;
  const avatar = member.user.displayAvatarURL({ size: 128 });
  const base = () => new EmbedBuilder().setColor(0xEDC231).setThumbnail(avatar);

  const bars = [
    '⬛⬛⬛⬛⬛⬛⬛⬛',
    '🟨⬛⬛⬛⬛⬛⬛⬛',
    '🟨🟨🟨⬛⬛⬛⬛⬛',
    '🟨🟨🟨🟨🟨⬛⬛⬛',
    '🟨🟨🟨🟨🟨🟨🟨🟨',
  ];

  const frames = [
    base().setTitle('🌌 A portal is opening...').setDescription(`${bars[0]}`),
    base().setTitle('✨ Energy gathering...').setDescription(`${bars[2]}`),
    base().setTitle('⚡ Materializing a new member...').setDescription(`${bars[4]}`),
    base()
      .setTitle(`🎉 Welcome to ${guild.name}!`)
      .setDescription(
        `### ⚡ ${member} just landed!\n` +
        `Everyone give a warm welcome to **${name}** 👋\n\n` +
        (rulesId ? `> 📜 Start here → <#${rulesId}>\n` : '') +
        `> 🧑‍🤝‍🧑 You're member **#${count}**`
      )
      .setImage('https://media.tenor.com/8kQx0mZ0m6oAAAAC/welcome.gif')
      .setFooter({ text: `${guild.name} • Member #${count}` })
      .setTimestamp(),
  ];
  return frames;
}

async function playWelcome(channel, member, opts = {}) {
  try {
    return await playFrames(channel, welcomeFrames(member, opts), { delay: 850 });
  } catch { return null; }
}

// ── TICKET CREATION ANIMATION ────────────────────────────────────────────────
// Plays a short "spinning up your ticket" sequence inside the new ticket
// channel before the real ticket embed is posted.
function ticketFrames(user, typeLabel) {
  const base = () => new EmbedBuilder().setColor(0x00D4FF);
  const spin = ['◐', '◓', '◑', '◒'];
  return [
    base().setTitle(`${spin[0]} Creating your ${typeLabel}...`).setDescription('```\n[■□□□□□□□□□] 10%\n```'),
    base().setTitle(`${spin[1]} Securing a private room...`).setDescription('```\n[■■■■□□□□□□] 40%\n```'),
    base().setTitle(`${spin[2]} Notifying the staff team...`).setDescription('```\n[■■■■■■■■□□] 80%\n```'),
    base().setTitle('✅ Ticket ready!').setDescription(`\`\`\`\n[■■■■■■■■■■] 100%\n\`\`\`\nHi ${user} — a staff member will be with you shortly. 🎫`),
  ];
}

async function playTicketCreation(channel, user, typeLabel) {
  try {
    const msg = await playFrames(channel, ticketFrames(user, typeLabel), { delay: 650 });
    // Auto-remove the animation after a moment so the real embed shines.
    if (msg) setTimeout(() => msg.delete().catch(() => {}), 4000);
    return msg;
  } catch { return null; }
}

module.exports = { playFrames, playWelcome, playTicketCreation, welcomeFrames, ticketFrames, sleep };
