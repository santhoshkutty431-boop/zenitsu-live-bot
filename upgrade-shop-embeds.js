/**
 * upgrade-shop-embeds.js
 * 
 * Recreates all shop channels in Zenitsu Live
 * with clean, spacious, premium embeds using the 🔹 and 🔸 colored diamond bullets.
 */

'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ─── SHOP DATA WITH PREMIUM COLORED DIAMOND LAYOUTS ──────────────────────────

const SHOP_DATA = {
  // 💻 BASIC PANEL
  '1460152526463832097': {
    name: 'basic-panel',
    title: 'ZENITSU LIVE — BASIC PANEL 💻',
    color: 0x7F8C8D, // Gray
    bullet: '🔹',
    headerEmoji: '🎸',
    desc: `**Aimbot Features**

🔹 AIMBOT
🔹 AIMFOV 180°
🔹 AWM SCOPE
🔹 AWM SWITCH
🔹 M82B SWITCH
🔹 PC BYPASS
🔹 TEMP CLEANER
🔹 NO RECOIL
🔹 GLITCH FIRE
🔹 CHAMS LOCATION
🔹 HIDE FROM SCREEN CAPTURE`,
    pricing: `• 200 INR | 15 DAY VALIDITY
• 500 INR | 30 DAY VALIDITY
• 2000 INR | PERMANENT LIFETIME`
  },

  // 🎯 AIMSILENT
  '1453191409141158093': {
    name: 'aim-silent',
    title: 'ZENITSU LIVE — AIM-SILENT MAX 🎯',
    color: 0xFFB700, // Gold
    bullet: '🔸',
    headerEmoji: '⚡',
    desc: `**EXE Functions**

🔸 AIM SILENT 360°
🔸 AIMBOT INTERNAL ( RANGE / HEX )
🔸 AIM SILENT 360°
🔸 AIM SILENT LITE
🔸 AIMFOV 999°
🔸 IGNORE KNOCK
🔸 NO RECOIL
🔸 UP PLAYER WHILE FIRING
🔸 GHOST HACK
🔸 SHAKE KILL
🔸 FREEZE KILL
🔸 UNDER KILL
🔸 TELE KILL 10 M
🔸 DOUBLE GUN
🔸 SPEED HACK 7×
🔸 ESP LINE BOX INFO
🔸 ESP SKELETON
🔸 ESP MINI MAP WEAPON
🔸 HOT KEY
🔸 STREAMER MODE
🔸 RANK WORKING`,
    pricing: `• 150 INR | 2$ USD | 1 DAY VALIDITY
• 600 INR | 7$ USD | 10 DAY VALIDITY
• 1200 INR | 14$ USD | 30 DAY VALIDITY
• 4500 INR | 50$ USD | LIFETIME PERMANENT`
  },

  // 🔍 UID BYPASS
  '1460152325267128520': {
    name: 'uid-bypass',
    title: 'ZENITSU LIVE — UID BYPASS 🔍',
    color: 0x3498DB, // Blue
    bullet: '🔹',
    headerEmoji: '💎',
    desc: `**Premium Features**

🔹 NO HACKERS IN MATCHMAKING
🔹 PLAY ONLY WITH MOBILE PLAYERS
🔹 NO BOT ENEMIES IN RANKED MATCHES
🔹 FASTER RANK PUSH IN SHORT TIME
🔹 100% SECURE FOR MAIN ACCOUNTS

*If you want to bypass the emulator logo, you'll need to purchase it separately.*`,
    pricing: `• 600 INR | 8$ USD | 10 DAY VALIDITY
• 1300 INR | 15$ USD | 30 DAY VALIDITY
• 5000 INR | 60$ USD | LIFETIME PERMANENT`
  },

  // 🛡️ EMULATOR BYPASS
  '1460152237836730419': {
    name: 'bypass-emulator',
    title: 'ZENITSU LIVE — EMULATOR BYPASS 🛡️',
    color: 0x2ECC71, // Green
    bullet: '🔹',
    headerEmoji: '🚀',
    desc: `**Features**

🔹 NO BOT LOBBIES
🔹 CLEAN & FAIR MATCHMAKING
🔹 MOBILE-ONLY OPPONENTS
🔹 FASTER RANK PROGRESSION
🔹 SAFE FOR ALL RANKED MODES
🔹 WORKS ON ALL SERVERS`,
    pricing: `• 600 INR | 8$ USD | 10 DAY VALIDITY
• 1300 INR | 15$ USD | 30 DAY VALIDITY
• 5000 INR | 60$ USD | LIFETIME PERMANENT`
  },

  // 💀 AIM KILL
  '1460147753576300597': {
    name: 'aim-kill',
    title: 'ZENITSU LIVE — AIMKILL APK 💀',
    color: 0xE74C3C, // Red
    bullet: '🔸',
    headerEmoji: '🎸',
    desc: `**Aim Features**

🔸 AIMKILL MAX
🔸 AIMKILL 360°
🔸 AIMKILL DOWN
🔸 AIMFOV 1200°
🔸 UP PLAYER
🔸 TELE KILL 10M
🔸 TELEPORT HACK CS
🔸 TELEPORT HACK BR
🔸 SHAKE KILL
🔸 MEDKIT RUN
🔸 SPEED HACK JOYSTICK
🔸 CLIMB UP
🔸 NO RECOIL
🔸 AUTO SWITCH
🔸 FAST SWITCH
🔸 ESP LINE LOCATION
🔸 RANK WORKING`,
    pricing: `• 110 INR | 1 DAY VALIDITY
• 750 INR | 10 DAY VALIDITY
• 1400 INR | 30 DAY VALIDITY
• 3000 INR | LIFETIME PERMANENT`
  },

  // 🖥️ PANEL EXTERNAL
  '1460149421177045112': {
    name: 'panel-external',
    title: 'ZENITSU LIVE — PANEL-EXTERNAL 🖥️',
    color: 0xE67E22, // Orange
    bullet: '🔸',
    headerEmoji: '🎯',
    desc: `**Functions**

🔸 SNIPER SWITCH
🔸 SNIPER SCOPE TRACKING
🔸 SNIPER DELAY FIX
🔸 VISION HACK
🔸 GLITCH FIRE
🔸 BLACK SKY
🔸 WALL HACK (On/Off)
🔸 SPEED HACK (On/Off)
🔸 CAMERA RIGHT (On/Off)
🔸 CHAMS MENU
🔸 CHAMS 64BIT
🔸 CHAMS WHITE

*Note: No match limit, no ban/blacklist.*`,
    pricing: `• 800 INR | 30 DAY VALIDITY
• 2000 INR | LIFETIME PERMANENT`
  },

  // ⚙️ PANEL INTERNAL
  '1460149291996676188': {
    name: 'panel-internal',
    title: 'ZENITSU LIVE — PANEL-INTERNAL ⚙️',
    color: 0x34495E, // Navy
    bullet: '🔹',
    headerEmoji: '⚡',
    desc: `**Functions**

🔹 AIMBOT VISIBLE (legit)
🔹 REAL AIMBOT (legit)
🔹 NO RECOIL
🔹 SNIPER SCOPE
🔹 IGNORE KNOCKED
🔹 STREAM MODE
🔹 RIGHT CAMERA
🔹 MAGNET
🔹 SPEED HACK

**ESP Functions**

🔹 ESP TRACKER
🔹 ESP NAME
🔹 ESP LINE
🔹 ESP BOX
🔹 ESP SKELETON
🔹 ESP DISTANCE
🔹 ESP WEAPON
🔹 ESP HEALTH

*Note: No ban/blacklist. Bluestacks 5/4 and MSI 4/5 supported.*`,
    pricing: `• 500 INR | 30 DAY VALIDITY
• 2000 INR | LIFETIME PERMANENT`
  },

  // 🎥 STREAMER PANEL
  '1460151022088491059': {
    name: 'streamer-panel',
    title: 'ZENITSU LIVE — STREAMER PANEL 🎥',
    color: 0x9B59B6, // Purple
    bullet: '🔹',
    headerEmoji: '👁️',
    desc: `**Streamproof Features**

🔹 ESP LINE / ESP BOX / ESP HEALTH / ESP SKELETON
🔹 STREAMER MODE ESP (Invisible on OBS)
🔹 AIMBOT (VISIBLE ONLY) & NO RECOIL
🔹 SNIPER SCOPE LOCK / IGNORE KNOCKED`,
    pricing: `• 500 INR | 15 DAY VALIDITY
• 1000 INR | 30 DAY VALIDITY
• 3500 INR | PERMANENT LIFETIME`
  },

  // 🎁 FREE PANEL
  '1460245030102110402': {
    name: 'free-panel',
    title: 'ZENITSU LIVE — FREE PANEL APK 🎁',
    color: 0x1ABC9C, // Teal
    bullet: '🔹',
    headerEmoji: '📦',
    desc: `**Features**

🔹 AUTO-UPDATED APK
🔹 ZERO COST / NO ADS
🔹 SAFE FOR SECONDARY ACCOUNTS`,
    pricing: `• FREE`
  }
};

// ─── MAIN PROCESS ────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('🧹 Formatting shop channels with premium colored diamonds...\n');

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error('❌ Guild not found!');
    process.exit(1);
  }

  for (const [channelId, data] of Object.entries(SHOP_DATA)) {
    const ch = guild.channels.cache.get(channelId);
    if (!ch) {
      console.log(`⚠️ Channel not found: ${data.name} (${channelId})`);
      continue;
    }

    try {
      // 1. Fetch & delete existing messages
      const msgs = await ch.messages.fetch({ limit: 50 });
      if (msgs.size > 0) {
        console.log(`🧹 Clearing old messages in #${data.name}...`);
        for (const [, m] of msgs) {
          await m.delete().catch(() => {});
        }
      }

      // 2. Format description with double lines and colored diamond bullets
      const formattedDesc = 
        `${data.headerEmoji} | **${data.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim()}**\n\n` +
        `${data.desc}\n\n` +
        `💵 | **Price**\n\n` +
        `${data.pricing.split('\n').map(line => `${data.bullet} ${line.replace(/^•\s*/, '')}`).join('\n')}\n\n` +
        `💎 *Create ticket if you want to buy*`;

      const embed = new EmbedBuilder()
        .setDescription(formattedDesc)
        .setColor(data.color)
        .setThumbnail(guild.iconURL({ dynamic: true }));

      // 3. Create ticket row button
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_purchase')
          .setLabel('🎫 Purchase Ticket')
          .setStyle(ButtonStyle.Success)
      );

      // 4. Send embed
      await ch.send({ embeds: [embed], components: [row] });
      console.log(`✅ Posted colored-diamond embed to #${data.name}`);

      // Small delay to avoid rate limit
      await new Promise(r => setTimeout(r, 600));

    } catch (err) {
      console.error(`❌ Error in #${data.name}:`, err.message);
    }
  }

  console.log('\n🛒 All shop channels upgraded with colored diamond layout!');
  process.exit(0);
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
