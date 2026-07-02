/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                  ZENITSU ADVANCED AI FEATURES                 ║
 * ║                  modules/ai-features.js                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Implements:
 *   1. AI Support Agent (Ticket Auto-replies)
 *   2. AI Context Moderation (Toxicity/Scam filters)
 *   3. AI flag-emoji reaction translation
 *   4. /draw image generation wrapper
 */

'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { queryAI } = require('./ai-handler');

// ─── SERVER KNOWLEDGE BASE (For ticket support) ──────────────────────────────

const TICKET_FAQ_PROMPT = `You are the AI Support Agent for ZENITSU LIVE.
Here is the official server knowledge base. Answer the user's question clearly.
If the information is not here, tell them to wait for staff assistance.

Shop & Products:
1. ZENITSU VIP BYPASS: Price $15/month. Instant delivery. Safe for main accounts.
2. FREE PANEL: Auto-updated APK. Zero cost. Available in #🎁┆free-panel.
3. AIM SILENT / SILENT ACCESS: Custom configuration for Android. Direct support included.
4. Support Tickets: Open a ticket in #🎫┆ticket-center.
5. Inquiries: DM owner Santhosh.

User's Ticket Question: `;

// ─── AI TOXICITY CLASSIFICATION PROMPT ───────────────────────────────────────

const MOD_CLASSIFY_PROMPT = `Analyze this message. Determine if it violates safety rules.
Rules to look for:
- Extreme toxicity, slurs, hate speech (including bypassed or obfuscated words).
- Scam links (steam-gift, free nitro, phishing).
- Server invites or self-promotion.

You MUST respond with only one of these three classification words:
- CLEAN (Safe message)
- TOXIC (Hate speech, extreme harassment, bypassed slurs)
- SCAM (Phishing, invites, advertising)

Message to analyze: `;

// ─── AI TRANSLATOR MAP ───────────────────────────────────────────────────────

const FLAG_TO_LANG = {
  '🇺🇸': 'English', '🇬🇧': 'English',
  '🇫🇷': 'French',
  '🇪🇸': 'Spanish',
  '🇩🇪': 'German',
  '🇮🇹': 'Italian',
  '🇯🇵': 'Japanese',
  '🇷🇺': 'Russian',
  '🇨🇳': 'Chinese',
  '🇮🇳': 'Hindi',
  '🇧🇷': 'Portuguese',
  '🇹🇷': 'Turkish',
  '🇸🇦': 'Arabic',
  '🇮🇩': 'Indonesian',
};

// ─── 1. AI TICKET AUTO-REPLY ────────────────────────────────────────────────

async function handleAiTicketSupport(message, db, saveDb) {
  // Only reply to the very first user message in a ticket
  const channel = message.channel;
  if (!channel.name.startsWith('purchase-') && !channel.name.startsWith('support-') && !channel.name.startsWith('ticket-')) return;

  // Track if this ticket has already been answered by AI
  if (!db.aiAnsweredTickets) db.aiAnsweredTickets = {};
  if (db.aiAnsweredTickets[channel.id]) return; // already replied

  db.aiAnsweredTickets[channel.id] = true;
  saveDb();

  // Show typing indicator
  await channel.sendTyping().catch(() => {});

  // Retrieve preferred language
  const userLang = db.ticketLanguages?.[channel.id] || 'english';
  
  let langDirective = 'You MUST write your entire response in standard English.';
  if (userLang === 'tunglish') {
    langDirective = 'You MUST write your entire response in "Tunglish" (Tamil language written using the English/Latin alphabet. For example: "Enna help venum?"). Do not use Tamil script, only Latin alphabet.';
  } else if (userLang === 'hinglish') {
    langDirective = 'You MUST write your entire response in "Hinglish" (Hindi language written using the English/Latin alphabet. For example: "Aapko kya madad chahiye?"). Do not use Devanagari script, only Latin alphabet.';
  }

  const query = `${TICKET_FAQ_PROMPT}\n\n[CRITICAL INSTRUCTION: ${langDirective}]\n\nUser Question: ${message.content}`;
  const modelKey = db.aiDefaultModel || 'gemini';

  const result = await queryAI(message.author.id, query, modelKey);
  if (result.error) return;

  // Greeting in target language
  let greeting = `👋 Hello ${message.author}! I am your AI assistant. Here is what I found:`;
  if (userLang === 'tunglish') greeting = `👋 Vanakkam ${message.author}! Naan unga AI assistant. Enaku kedaitha thagaval idhu:`;
  if (userLang === 'hinglish') greeting = `👋 Namaste ${message.author}! Main aapka AI assistant hoon. Mujhe ye jaankari mili hai:`;

  let footerMsg = `If you still need help, don't worry! Our staff has been notified and will be here shortly.`;
  if (userLang === 'tunglish') footerMsg = `Unga prachana solve aagalana kavalaipadaadheenga! Enga staff koodiya seekiram ungaluku help pannuvanga.`;
  if (userLang === 'hinglish') footerMsg = `Agar aapka help nahi hua toh chinta na karein! Humare staff jald hi aakar aapki madad karenge.`;

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'ZENITSU AI Ticket Support', iconURL: message.client.user.displayAvatarURL() })
    .setDescription(
      `${greeting}\n\n` +
      `> ${result.response}\n\n` +
      `*${footerMsg}*`
    )
    .setColor(0x00D4FF)
    .setFooter({ text: 'ZENITSU LIVE Support' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ─── 2. AI CONTEXT MODERATION ────────────────────────────────────────────────

async function handleAiModeration(message, db, saveDb, logToChannel, ID) {
  // Ignore bots, webhook, and staff
  if (message.author.bot || message.webhookId) return false;
  if (message.member && (
    message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    message.member.roles.cache.has(ID.ADMIN_ROLE) ||
    message.member.roles.cache.has(ID.MOD_ROLE)
  )) return false;

  const content = message.content;
  if (!content || content.length < 3) return false;

  const query = MOD_CLASSIFY_PROMPT + content;
  const modelKey = db.aiDefaultModel || 'gemini';

  // Perform quick classification
  const result = await queryAI(message.author.id, query, modelKey);
  if (result.error) return false;

  const classification = result.response.toUpperCase().trim();

  if (classification.includes('TOXIC') || classification.includes('SCAM')) {
    const reason = classification.includes('TOXIC') ? 'AI AutoMod: Extreme Toxicity / Slurs' : 'AI AutoMod: Phishing / Scam / Invite Links';

    // Delete message
    await message.delete().catch(() => {});

    // Timeout member (10 minutes default)
    const timeoutMs = 10 * 60 * 1000;
    await message.member.timeout(timeoutMs, reason).catch(() => {});

    // Create case
    const { createCase, CaseType, formatCaseEmbed } = require('./case-manager');
    const caseData = createCase(db, saveDb, {
      type:    CaseType.TIMEOUT,
      guildId: message.guild.id,
      userId:  message.author.id,
      userTag: message.author.tag,
      modId:   message.client.user.id,
      modTag:  message.client.user.tag,
      reason:  `${reason} (Flagged message: "${content.slice(0, 100)}")`,
      duration: timeoutMs,
    });

    // Alert channel
    const warnEmbed = new EmbedBuilder()
      .setTitle('🚨 Advanced AI AutoMod')
      .setDescription(`${message.author}, your message was removed.\n**Reason:** ${classification.includes('TOXIC') ? 'Toxicity / Slur Detected' : 'Scam or Link Detected'}`)
      .setColor(0xFF0000)
      .setTimestamp();
    
    const warnMsg = await message.channel.send({ embeds: [warnEmbed] }).catch(() => null);
    if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);

    // Mod log
    await logToChannel(message.guild, ID.MOD_LOG, formatCaseEmbed(caseData));
    return true; // violated
  }

  return false;
}

// ─── 3. AI REACTION TRANSLATOR ───────────────────────────────────────────────

async function handleAiReactionTranslate(reaction, user) {
  // Partial check
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const emoji = reaction.emoji.name;
  const lang  = FLAG_TO_LANG[emoji];
  if (!lang) return; // not a supported translation flag

  const message = reaction.message;
  if (!message.content || message.content.length < 2) return;

  // Verify reaction user is not a bot
  if (user.bot) return;

  // React to reaction with typing/thinking
  await reaction.message.channel.sendTyping().catch(() => {});

  const prompt = `Translate this message content into ${lang}. Keep the original formatting and emojis if possible. Only reply with the translated text. Do not add anything else.

Message: "${message.content}"`;

  const modelKey = 'gemini'; // default translation model
  const result   = await queryAI(user.id, prompt, modelKey);

  if (result.error) {
    return user.send(`❌ Translation failed: ${result.message}`).catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: `Translated to ${lang}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/3898/3898082.png' })
    .setDescription(result.response)
    .setColor(0x00D4FF)
    .setFooter({ text: `Requested by ${user.tag} • Original message by ${message.author.tag}` })
    .setTimestamp();

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
}

// ─── 4. AI IMAGE GENERATOR (/DRAW) ───────────────────────────────────────────

async function handleAiDraw(interaction) {
  await interaction.deferReply();

  const prompt = interaction.options.getString('prompt');
  
  // Format the prompt for URL encoding
  const cleanPrompt = encodeURIComponent(prompt.trim());

  // Using Pollinations AI's free open-source image generation CDN
  const imageUrl = `https://image.pollinations.ai/p/${cleanPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

  const embed = new EmbedBuilder()
    .setTitle('🎨 AI Generated Artwork')
    .setDescription(`**Prompt:** ${prompt}`)
    .setImage(imageUrl)
    .setColor(0xFFB700)
    .setFooter({ text: `Requested by ${interaction.user.tag} • Powered by Pollinations AI` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] }).catch(async () => {
    // Failback
    await interaction.editReply({ content: '❌ Image generation failed. Please try a different prompt.' });
  });
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  handleAiTicketSupport,
  handleAiModeration,
  handleAiReactionTranslate,
  handleAiDraw,
};
