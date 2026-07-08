/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                 ZENITSU AI EMBED ASSISTANT                    ║
 * ║                 modules/ai-embed.js                           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Uses Gemini/Groq to parse plain-text descriptions into fully
 * formatted, highly professional Discord embeds, offering a
 * preview & send/cancel flow.
 */

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');
const { queryAI } = require('./ai-handler');

// ─── SYSTEM PROMPT FOR EMBED GENERATION ──────────────────────────────────────

const AI_EMBED_PROMPT = `You are a helper that converts a user's request for an embed message into a raw JSON format representing a Discord embed.
Analyze the user's description and generate the best-fitting, most professional embed.

If the user's request involves creating a poll (e.g. asking a question with multiple options to vote on, prioritizing features, choosing options, etc.), you MUST:
1. Never write "Option 1", "Option 2", or list the options/choices inside the embed description or fields. Keep the embed description as a clean call-to-action/announcement.
2. Set "isPoll" to true in the JSON schema.
3. Provide the poll details in the "poll" object field.

Your output MUST be a valid JSON object only. Do not wrap it in markdown code blocks like \`\`\`json. Output nothing else but the raw JSON.

The JSON schema you must output is:
{
  "title": "String (max 256 chars, optional)",
  "description": "String (max 4096 chars, optional, supports bold, italic, lists, markdown. MUST NOT contain option list or choices if it is a poll)",
  "color": "String (hex color like '#FFB700', or name preset: red, green, blue, yellow, orange, purple, pink, cyan, gold, teal, zenitsu, dark)",
  "thumbnail": "String (valid URL, optional)",
  "image": "String (valid URL, optional)",
  "author": {
    "name": "String (optional)",
    "icon": "String (valid URL, optional)"
  },
  "footer": {
    "text": "String (optional)",
    "icon": "String (valid URL, optional)"
  },
  "fields": [
    {
      "name": "String (max 256)",
      "value": "String (max 1024)",
      "inline": boolean
    }
  ] (max 10 items),
  "isPoll": boolean (true if the user requested a poll/voting, false otherwise),
  "poll": {
    "question": "String (the core question being voted on, required if isPoll is true)",
    "options": ["String" (array of option texts. MUST BE derived from the user request. NEVER use placeholder text. Default to ["Yes", "No"] if the user requests a poll but does not specify options. Max 10 options, required if isPoll is true)],
    "durationMinutes": number (default: 60, number of minutes the poll should run. Carefully calculate this based on the provided Active Time Context and the user's requested expiration time/day. If the user doesn't specify an expiration, default to 60)
  }
}

Design guidelines:
- Use curated colors. Default to 'zenitsu' (#FFB700) or 'dark' (#2F3136) if not specified.
- Format descriptions professionally using lists, bold headers, and clean spacing.
- Only include fields if they structure the information better.
- Ignore invalid image/thumbnail URLs in the description, or use placeholders if requested.
- IMPORTANT CHANNEL MENTIONING RULE: If the user mentions any channel name that matches one in the list of available channels (provided below), you MUST use its exact mention tag (e.g., <#CHANNEL_ID>) in the description or fields instead of writing the plain text channel name. E.g., if "feedback" is listed as "<#123456>", replace "#feedback" or "feedback channel" with "<#123456>".
- CRITICAL POLL RULE: If the user request mentions or implies a poll, but doesn't specify what options/choices to vote on, you MUST default the poll options to ["Yes", "No"]. NEVER copy example values like "UID Bypass" or "Basic Panel" into your JSON response.

User request: 
`;

// ─── PARSE & VALIDATE AI RESPONSE ───────────────────────────────────────────

function parseAiEmbedJson(rawText) {
  // Clean up any potential markdown wrapping
  let clean = rawText.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  }

  try {
    const data = JSON.parse(clean);

    // Basic structural validation
    const embedData = {
      title:       data.title || null,
      description: data.description || null,
      color:       data.color || 'zenitsu',
      thumbnail:   data.thumbnail || null,
      image:       data.image || null,
      author:      data.author || null,
      footer:      data.footer || null,
      fields:      Array.isArray(data.fields) ? data.fields.slice(0, 10) : [],
      isPoll:      !!data.isPoll,
      poll:        data.poll ? {
        question: data.poll.question || data.title || 'Poll',
        options:  Array.isArray(data.poll.options) ? data.poll.options.filter(o => typeof o === 'string' && o.trim().length > 0) : [],
        durationMinutes: typeof data.poll.durationMinutes === 'number' ? data.poll.durationMinutes : 60
      } : null
    };

    if (embedData.isPoll && (!embedData.poll || embedData.poll.options.length < 2)) {
      embedData.isPoll = false;
    }

    if (!embedData.title && !embedData.description && embedData.fields.length === 0) {
      throw new Error('Embed must have at least a title, description, or fields.');
    }

    return { valid: true, data: embedData };
  } catch (err) {
    return { valid: false, error: err.message, raw: rawText };
  }
}

// ─── COMMAND HANDLER ─────────────────────────────────────────────────────────

async function handleAiEmbed(interaction, db, saveDb, logToChannel, ID) {
  const prompt   = interaction.options.getString('description');
  const targetCh = interaction.options.getChannel('channel') || interaction.channel;
  const mention  = interaction.options.getString('mention') || null;

  // 1. Initial defer
  await interaction.deferReply({ ephemeral: true });

  // Resolve available channels in this guild to provide context to the AI
  let channelsHelp = '';
  if (interaction.guild) {
    const textChannels = interaction.guild.channels.cache
      .filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum);
    if (textChannels.size > 0) {
      channelsHelp = '\nAvailable channels in this server (use the exact mention tags in the description/fields when those channels are mentioned by name):\n' +
        textChannels.map(ch => `- "${ch.name}": <#${ch.id}>`).join('\n') + '\n';
    }
  }

  // 2. Query AI with special system prompt, active time context, and channel lists
  const now = new Date();
  const timeContext = `\nActive Time Context (use this to calculate durationMinutes if the user specifies a relative/absolute expiration date/time):
- Current Time: ${now.toString()}
- UTC Time: ${now.toUTCString()}
- Day of the Week: ${now.toLocaleDateString('en-US', { weekday: 'long' })}
- Date: ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
`;

  const query = AI_EMBED_PROMPT + timeContext + channelsHelp + '\nUser request: ' + prompt;
  const modelKey = db.aiDefaultModel || 'gemini';

  const result = await queryAI(interaction.user.id, query, modelKey, null, {
    applicationId: interaction.client.application?.id || 'default',
    guildId: interaction.guildId || 'dm',
    channelId: interaction.channelId || 'none',
    threadId: interaction.channel?.isThread() ? interaction.channelId : 'none',
    shardId: interaction.client.shard?.ids?.[0]?.toString() || '0'
  });
  if (result.error) {
    return interaction.editReply({ content: `❌ **AI Generation failed:** ${result.message}` });
  }

  // 3. Parse JSON output
  const parsed = parseAiEmbedJson(result.response);
  if (!parsed.valid) {
    console.error('Failed to parse AI Embed JSON:', parsed.raw);
    return interaction.editReply({
      content: `❌ **Failed to generate structured embed.** The AI returned an invalid layout.\n\n*Raw output was:*\n\`\`\`json\n${parsed.raw.slice(0, 1800)}\n\`\`\``
    });
  }

  const embedData = parsed.data;

  // 4. Build preview embed using native EmbedBuilder
  const { COLOR_PRESETS } = require('../commands/embed-handler');
  let colorInt = COLOR_PRESETS.zenitsu;
  if (embedData.color) {
    const c = embedData.color.toLowerCase().replace('#', '');
    if (COLOR_PRESETS[c] !== undefined) colorInt = COLOR_PRESETS[c];
    else if (/^[0-9a-f]{6}$/.test(c))   colorInt = parseInt(c, 16);
  }

  const previewEmbed = new EmbedBuilder()
    .setColor(colorInt);

  if (embedData.title)       previewEmbed.setTitle(embedData.title);
  if (embedData.description) previewEmbed.setDescription(embedData.description);
  
  if (embedData.thumbnail && embedData.thumbnail.startsWith('http')) {
    previewEmbed.setThumbnail(embedData.thumbnail);
  }
  if (embedData.image && embedData.image.startsWith('http')) {
    previewEmbed.setImage(embedData.image);
  }

  if (embedData.author && embedData.author.name) {
    previewEmbed.setAuthor({
      name:    embedData.author.name,
      iconURL: embedData.author.icon?.startsWith('http') ? embedData.author.icon : null,
    });
  }

  if (embedData.footer && embedData.footer.text) {
    previewEmbed.setFooter({
      text:    embedData.footer.text,
      iconURL: embedData.footer.icon?.startsWith('http') ? embedData.footer.icon : null,
    });
  }

  if (embedData.fields.length > 0) {
    for (const f of embedData.fields) {
      if (f.name && f.value) {
        previewEmbed.addFields({ name: f.name, value: f.value, inline: !!f.inline });
      }
    }
  }

  // Calculate duration/expiration for preview
  const expiresAt = Date.now() + (embedData.poll?.durationMinutes || 60) * 60 * 1000;

  // Build preview poll components if applicable
  const { makePollComponents } = require('./poll-manager');
  let pollPreview = null;
  if (embedData.isPoll) {
    pollPreview = makePollComponents(embedData.poll.question, embedData.poll.options, {}, false, expiresAt);
  }

  // 5. Send preview to user with Buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ai_embed_send').setLabel('🚀 Send Embed' + (embedData.isPoll ? ' & Poll' : '')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ai_embed_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
  );

  const previewEmbeds = [previewEmbed];
  if (embedData.isPoll) {
    previewEmbeds.push(pollPreview.embed);
  }

  const previewMsg = await interaction.editReply({
    content: `### 🔍 AI Embed${embedData.isPoll ? ' & Poll' : ''} Preview\nThis is a preview of the generated content. It will be sent to ${targetCh}.`,
    embeds: previewEmbeds,
    components: [row]
  });

  // 6. Wait for button click (Send or Cancel)
  const collector = previewMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time:          60_000,
  });

  collector.on('collect', async btnInteraction => {
    if (btnInteraction.user.id !== interaction.user.id) {
      return btnInteraction.reply({ content: '❌ Only the command executor can make this choice.', ephemeral: true });
    }

    await btnInteraction.deferUpdate();

    if (btnInteraction.customId === 'ai_embed_send') {
      try {
        // Resolve mention string
        let sendContent = undefined;
        if (mention) {
          const mentionClean = mention.trim();
          if (mentionClean === '@everyone' || mentionClean === '@here') {
            sendContent = mentionClean;
          } else {
            const roleId = mentionClean.replace(/[^0-9]/g, '');
            if (roleId) sendContent = `<@&${roleId}>`;
          }
        }

        // Prepare sends
        let sentMsg;
        if (embedData.isPoll) {
          sentMsg = await targetCh.send({
            content:         sendContent,
            embeds:          [previewEmbed, pollPreview.embed],
            components:      pollPreview.components,
            allowedMentions: { parse: ['everyone', 'roles'] }
          });

          // Save poll to database for persistence
          const dbService = interaction.client.runtime.getService('DatabaseManager');
          dbService.createPoll({
            messageId: sentMsg.id,
            guildId:   targetCh.guild.id,
            channelId: targetCh.id,
            question:  embedData.poll.question,
            options:   embedData.poll.options,
            expiresAt: expiresAt
          });

          // Schedule task to auto-close the poll
          const scheduler = interaction.client.runtime.getService('TaskScheduler');
          const delay = expiresAt - Date.now();
          scheduler.schedule(`poll_close_${sentMsg.id}`, delay, async () => {
            const { closePoll } = require('./poll-manager');
            await closePoll(interaction.client, dbService, {
              messageId: sentMsg.id,
              guildId:   targetCh.guild.id,
              channelId: targetCh.id,
              question:  embedData.poll.question,
              options:   embedData.poll.options,
              votes:     {}
            });
          });
        } else {
          sentMsg = await targetCh.send({
            content:         sendContent,
            embeds:          [previewEmbed],
            allowedMentions: { parse: ['everyone', 'roles'] }
          });
        }

        // Update preview response
        await interaction.editReply({
          content:    `✅ **Embed successfully sent!**\n[Jump to message](${sentMsg.url})`,
          embeds:     [],
          components: []
        });

        // Log mod action
        const logEmbed = new EmbedBuilder()
          .setTitle(embedData.isPoll ? '📢 AI Poll Created' : '📢 AI Embed Sent')
          .setDescription(`**Created by:** ${interaction.user} (${interaction.user.tag})\n**Target Channel:** ${targetCh}\n**Title/Question:** ${embedData.isPoll ? embedData.poll.question : (embedData.title || '*No title*')}`)
          .setColor(0x2ECC71)
          .setTimestamp();
        await logToChannel(interaction.guild, ID.MOD_LOG, logEmbed);

      } catch (err) {
        await interaction.editReply({
          content:    `❌ **Failed to send:** ${err.message}`,
          embeds:     [],
          components: []
        });
      }
    } else {
      // Cancelled
      await interaction.editReply({
        content:    '❌ **AI Embed generation cancelled.**',
        embeds:     [],
        components: []
      });
    }
    collector.stop();
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time') {
      interaction.editReply({
        content:    '⏳ **Preview timed out.** No action was taken.',
        embeds:     [],
        components: []
      }).catch(() => {});
    }
  });
}

module.exports = { handleAiEmbed };
