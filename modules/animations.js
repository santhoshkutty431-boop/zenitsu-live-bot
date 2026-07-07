/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   ANIMATIONS — Zenitsu Theme Message Effects                 ║
 * ║   modules/animations.js                                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

'use strict';

const { EmbedBuilder } = require('discord.js');

async function playZenitsuWelcomeAnimation(channel, member, finalEmbed, isVideo, welcomeImg, dbMime) {
  const base = () => new EmbedBuilder().setColor(0xEDC231);
  const frames = [
    base()
      .setTitle('⚡ *Zenitsu goes to sleep...*')
      .setDescription('💤 *Zzz...* Concentrating energy...\n\n```\n[░░░░░░░░░░] 0%\n```')
      .setImage('https://media.tenor.com/m/V8G4820rM01C8AAAAd/zenitsu-demon-slayer.gif'),
    base()
      .setTitle('⚡ *Thunder Breathing, First Form...*')
      .setDescription('⚔️ *Hand on hilt, readying stance...*\n\n```\n[████░░░░░░] 40%\n```')
      .setImage('https://media.tenor.com/m/V8G4820rM01C8AAAAd/zenitsu-demon-slayer.gif'),
    base()
      .setTitle('⚡ *Thunder Clap and Flash!* ⚡')
      .setDescription('✨ *Lightning crackles across the server!*\n\n```\n[████████░░] 80%\n```')
      .setImage('https://media1.tenor.com/m/V_zC24-B97cAAAAC/zenitsu-demon-slayer.gif'),
  ];

  let msg = null;
  for (const frame of frames) {
    if (!msg) {
      msg = await channel.send({ embeds: [frame] }).catch(() => null);
    } else {
      await msg.edit({ embeds: [frame] }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 750));
  }

  const finalPayload = { embeds: [finalEmbed] };
  if (isVideo) {
    if (msg) await msg.edit(finalPayload).catch(() => {});
    await channel.send({ files: [{ attachment: welcomeImg, name: `welcome_video.${dbMime.split('/')[1]}` }] }).catch(() => {});
  } else {
    if (msg) await msg.edit(finalPayload).catch(() => {});
  }
}

async function playZenitsuTicketAnimation(channel, user, finalEmbed, isVideo, ticketImg, dbMime, closeRow, pingContent) {
  const base = () => new EmbedBuilder().setColor(0x00D4FF);
  const frames = [
    base()
      .setTitle('⚡ *Godspeed Charge Initializing...*')
      .setDescription('🌀 *Flashed-step private room setup in progress...*\n\n```\n[■□□□□□□□□□] 10%\n```'),
    base()
      .setTitle('⚡ *Thunder Breathing Active...*')
      .setDescription('🔒 *Encrypting credentials and staff routing...*\n\n```\n[■■■■■■□□□□] 60%\n```'),
    base()
      .setTitle('⚡ *Lightning Flash strike!* ⚡')
      .setDescription('🎉 *Support channel materialized at lightning speed!*\n\n```\n[■■■■■■■■■■] 100%\n```')
  ];

  let msg = null;
  for (const frame of frames) {
    if (!msg) {
      msg = await channel.send({ embeds: [frame] }).catch(() => null);
    } else {
      await msg.edit({ embeds: [frame] }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 650));
  }

  if (msg) {
    await msg.delete().catch(() => {});
  }
  
  const finalPayload = { content: pingContent, embeds: [finalEmbed], components: [closeRow] };
  if (isVideo) {
    finalPayload.files = [{ attachment: ticketImg, name: `ticket_video.${dbMime.split('/')[1]}` }];
  }
  await channel.send(finalPayload).catch(() => {});
}

module.exports = {
  playZenitsuWelcomeAnimation,
  playZenitsuTicketAnimation
};
