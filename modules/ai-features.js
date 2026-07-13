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

const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { queryAI } = require('./ai-handler');

// ─── SERVER KNOWLEDGE BASE (For ticket support) ──────────────────────────────

const TICKET_FAQ_PROMPT = `You are a helpful, friendly, premium human support executive (Santhosh's assistant) for the ZENITSU LIVE community.

Your primary goal is to understand the user's real intention and respond naturally like a practical, helpful human store salesperson, not like a robotic chatbot.

STRICT RESPONSE FILTER & PERSONA RULES:
* NEVER use filler phrases or robotic boilerplate preambles such as "It seems you're asking", "I understand", "Thank you for your patience", or "Actively checking" (unless actually true).
* Responses must be: Short, Human, Context aware, and Solution first.
* Keep your messages direct, practical, and highly conversational. Go straight to the answer or solution.
* Keep responses short, direct, and concise (max 3-4 sentences). Use natural, friendly terms like "bro", "machan", "yaar", or "friend" to match the user's vibe.

PRACTICALITY, DIRECTNESS & HUMANITY:
* ALWAYS answer the user's question directly in the very first sentence. Never say "I can check that for you" or other generic chatbot filler words. Go straight to the answer.
* Never sound robotic or formal. Speak like a helpful support executive or a tech-savvy friend. Keep your responses short, concise, and highly practical.
* Address the user by their mention tag (e.g. "@username") naturally in the response.
* Reassure the user that if they need more help, staff are on the way and will help shortly, but do it naturally at the end of your message.
* Do NOT output any blockquotes or markdown code blocks for your entire message. Just output the clean text.

Official Server Knowledge Base:
- ZENITSU VIP BYPASS: Price $15/month. Instant delivery. Safe for main accounts.
- FREE PANEL: Auto-updated APK. Zero cost. Available in #🎁┆free-panel.
- AIM SILENT / SILENT ACCESS: Custom configuration for Android. Direct support included.
- Support Tickets: Open a ticket in #🎫┆ticket-center.
- Inquiries: DM owner Santhosh.`;

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
  const channel = message.channel;
  const isAiTicket = channel.name.startsWith('ai-support-') || (db.aiTickets && db.aiTickets[channel.id]);
  const isStandardTicket = channel.name.startsWith('purchase-') || channel.name.startsWith('support-') || channel.name.startsWith('ticket-');

  if (!isAiTicket && !isStandardTicket) return;

  // Ignore bot messages
  if (message.author.bot) return;

  // Resolve staff status
  const isStaff = message.member && (
    message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator)
  );

  // If staff sends a message in a ticket, ignore it (do not let AI respond to staff comments)
  if (isStaff) return;

  // If it's a standard ticket, only reply to the very first user message
  if (isStandardTicket) {
    const ticketCreatorId = Object.keys(db.activeTickets || {}).find(
      uid => db.activeTickets[uid] === channel.id
    );
    if (ticketCreatorId && message.author.id !== ticketCreatorId) return;

    if (!db.aiAnsweredTickets) db.aiAnsweredTickets = {};
    if (db.aiAnsweredTickets[channel.id]) return;

    db.aiAnsweredTickets[channel.id] = true;
    saveDb();
  }

  // Show typing indicator
  await channel.sendTyping().catch(() => {});

  // Retrieve preferred language
  const userLang = db.ticketLanguages?.[channel.id] || 'english';
  
  let langDirective = `
- You MUST write your entire response in English.
- Address the user as ${message.author} or by their name.
- Greet them casually (e.g. "Hello @user!" or "Yo @user!").
- Reassure them at the end naturally (e.g. "If you still need help, don't worry! Our staff has been notified and will be here shortly.").`;

  if (userLang === 'tunglish') {
    langDirective = `
- You MUST write your entire response in "Tunglish" (Tamil language written using the English/Latin alphabet. For example: "Enna help venum?"). Do not use Tamil script, only Latin alphabet.
- Keep the language casual and friendly, using words like "bro", "machan", "nanba".
- Address the user as ${message.author}.
- Greet them casually (e.g. "Vanakkam @user!").
- Reassure them at the end naturally (e.g. "Unga prachana solve aagalana kavalaipadaadheenga! Enga staff koodiya seekiram ungaluku help pannuvanga.").`;
  } else if (userLang === 'hinglish') {
    langDirective = `
- You MUST write your entire response in "Hinglish" (Hindi language written using the English/Latin alphabet. For example: "Aapko kya help chahiye?"). Do not use Devanagari script, only Latin alphabet.
- Keep the language casual and friendly, using words like "bro", "bhai", "yaar".
- Address the user as ${message.author}.
- Greet them casually (e.g. "Namaste @user!").
- Reassure them at the end naturally (e.g. "Agar aapka problem solve nahi hua toh chinta na karein! Humare staff jald hi aakar aapki madad karenge.").`;
  } else if (userLang === 'auto') {
    langDirective = `
- Detect the language/dialect of the prompt dynamically.
- Respond in the EXACT same language/dialect as the prompt (e.g., if Tamil, use Tamil/Tunglish; if Hindi, use Hindi/Hinglish).
- Maintain the casual and helpful human support persona.`;
  }

  // If dedicated AI ticket, fetch conversational history from SessionManager
  let history = [];
  const runtime = message.client.runtime;
  const sessionService = runtime ? runtime.getService('SessionManager') : null;
  if (isAiTicket && sessionService) {
    history = sessionService.getHistory(message.author.id, {
      guildId: message.guild.id,
      channelId: message.channel.id
    });
  }

  const query = `${TICKET_FAQ_PROMPT}\n\n[CRITICAL DIALECT & FORMATTING DIRECTIVES: ${langDirective}]\n\nUser Question: ${message.content}`;
  const modelKey = db.aiDefaultModel || 'gemini';

  const userRoles = [];
  if (message.author.id === message.guild.ownerId) userRoles.push('Owner');
  const dbService = message.client.runtime.getService('DatabaseManager');
  const globalDb = dbService ? dbService.getGlobal() : {};
  const developerIds = globalDb.developerIds || ['1444538003824447621'];
  const isDev = developerIds.includes(message.author.id);
  if (isDev) userRoles.push('Developer');
  if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) userRoles.push('Administrator');
  const isStaffMember = message.member && (
    message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator)
  );
  if (isStaffMember) userRoles.push('Staff');
  if (userRoles.length === 0) userRoles.push('Member');

  const result = await queryAI(message.author.id, query, modelKey, userLang, {
    applicationId: message.client.application?.id || 'default',
    guildId: message.guild.id,
    channelId: message.channel.id,
    threadId: message.channel.isThread() ? message.channel.id : 'none',
    shardId: message.client.shard?.ids?.[0]?.toString() || '0',
    userName: message.author.username,
    userDisplayName: message.member?.displayName || message.author.globalName || message.author.username,
    userRoles: userRoles,
    isDeveloper: isDev || message.author.id === message.guild.ownerId
  });
  if (result.error) return;

  // Save to conversational history if AI ticket
  if (isAiTicket && sessionService) {
    sessionService.addToHistory(message.author.id, 'user', message.content, {
      guildId: message.guild.id,
      channelId: message.channel.id
    });
    sessionService.addToHistory(message.author.id, 'assistant', result.response, {
      guildId: message.guild.id,
      channelId: message.channel.id
    });
  }

  if (isAiTicket) {
    // Public reply (normal text response, not embedded, not ephemeral!)
    await channel.send({ content: `${message.author}, ${result.response}` });
  } else {
    // Embed reply for standard tickets (keeps them clean)
    const embed = new EmbedBuilder()
      .setAuthor({ name: 'ZENITSU AI Ticket Support', iconURL: message.client.user.displayAvatarURL() })
      .setDescription(result.response)
      .setColor(0x00D4FF)
      .setFooter({ text: 'ZENITSU LIVE Support' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_staff_need')
        .setLabel('🙋 Need Staff')
        .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
  }
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
  const result = await queryAI(message.author.id, query, modelKey, null, {
    applicationId: message.client.application?.id || 'default',
    guildId: message.guild?.id || 'dm',
    channelId: message.channel.id,
    threadId: message.channel.isThread() ? message.channel.id : 'none',
    shardId: message.client.shard?.ids?.[0]?.toString() || '0'
  });
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

  const modelKey = process.env.DEFAULT_AI_MODEL || 'groq'; // Groq: only provider with live quota
  const result   = await queryAI(user.id, prompt, modelKey, null, {
    applicationId: message.client.application?.id || 'default',
    guildId: message.guild?.id || 'dm',
    channelId: message.channel.id,
    threadId: message.channel.isThread() ? message.channel.id : 'none',
    shardId: message.client.shard?.ids?.[0]?.toString() || '0'
  });

  if (result.error) {
    const { sendCleanDm } = require('./dm-manager');
    return sendCleanDm(user, { content: `❌ Translation failed: ${result.message}` }).catch(() => {});
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
    // Failback — never let the failback itself produce an unhandled rejection
    await interaction.editReply({ content: '❌ Image generation failed. Please try a different prompt.' }).catch(() => {});
  });
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  handleAiTicketSupport,
  handleAiModeration,
  handleAiReactionTranslate,
  handleAiDraw,
};
