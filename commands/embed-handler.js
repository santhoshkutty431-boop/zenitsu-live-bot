/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║         PROFESSIONAL EMBED ANNOUNCEMENT SYSTEM           ║
 * ║         commands/embed-handler.js                        ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Handles the /embed slash command with full validation,
 * field support, buttons, mentions, and error reporting.
 */

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const MAX_TITLE_LENGTH       = 256;
const MAX_DESC_LENGTH        = 4096;
const MAX_FIELD_NAME_LENGTH  = 256;
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_FOOTER_LENGTH      = 2048;
const MAX_AUTHOR_LENGTH      = 256;
const MAX_FIELDS             = 25;
const MAX_TOTAL_EMBED_CHARS  = 6000;
const MAX_BUTTON_LABEL       = 80;
const MAX_BUTTON_URL         = 512;

// Named color presets (hex without #)
const COLOR_PRESETS = {
  red:     0xE74C3C,
  green:   0x2ECC71,
  blue:    0x3498DB,
  yellow:  0xF1C40F,
  orange:  0xE67E22,
  purple:  0x9B59B6,
  pink:    0xFF69B4,
  cyan:    0x00D4FF,
  white:   0xFFFFFF,
  black:   0x000000,
  gold:    0xFFD700,
  teal:    0x1ABC9C,
  navy:    0x34495E,
  zenitsu: 0xFFB700,
  dark:    0x2F3136,
};

// ─── UTILITIES ──────────────────────────────────────────────────────────────

/**
 * Validate a URL — must be http/https and reachable format.
 * Returns { valid: boolean, reason?: string }
 */
function validateUrl(url) {
  if (!url) return { valid: true }; // optional fields
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { valid: false, reason: `URL must start with http:// or https:// — got: \`${url}\`` };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: `Invalid URL format: \`${url}\`` };
  }
}

/**
 * Parse a color string into a Discord-compatible integer.
 * Accepts: hex (#RRGGBB or RRGGBB), named presets.
 */
function parseColor(colorStr) {
  if (!colorStr) return 0x2F3136; // default dark gray

  const lower = colorStr.trim().toLowerCase();

  // Named preset
  if (COLOR_PRESETS[lower] !== undefined) return COLOR_PRESETS[lower];

  // Hex color
  const hex = lower.replace('#', '');
  if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16);

  return null; // invalid
}

/**
 * Count total characters in an embed to respect Discord's 6000 char limit.
 */
function countEmbedChars(data) {
  return [
    data.title        || '',
    data.description  || '',
    data.footer?.text || '',
    data.author?.name || '',
    ...(data.fields || []).flatMap(f => [f.name, f.value]),
  ].reduce((sum, s) => sum + s.length, 0);
}

/**
 * Truncate a string safely.
 */
function trunc(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

// ─── PERMISSION CHECK ───────────────────────────────────────────────────────

/**
 * Check if a member has permission to use /embed or /say.
 * Allowed if: Administrator, Manage Server, or has a configured staff role.
 */
function hasEmbedPermission(member, db) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild))   return true;

  // Check configurable staff roles stored in db
  const staffRoles = db.embedStaffRoles || [];
  if (staffRoles.length > 0 && member.roles.cache.some(r => staffRoles.includes(r.id))) return true;

  return false;
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────

/**
 * Handle /embed interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} db     - database object
 * @param {function} saveDb - database save function
 * @param {function} logToChannel - log helper function
 * @param {object} ID     - channel/role ID constants
 */
async function handleEmbed(interaction, db, saveDb, logToChannel, ID) {
  await interaction.deferReply({ ephemeral: true });

  // ── PERMISSION CHECK ────────────────────────────────────────────────────
  if (!hasEmbedPermission(interaction.member, db)) {
    return interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Permission Denied')
        .setDescription('You need **Administrator**, **Manage Server**, or a configured staff role to use `/embed`.')
        .setColor(0xE74C3C)
    ]});
  }

  // ── COLLECT OPTIONS ─────────────────────────────────────────────────────
  const channel     = interaction.options.getChannel('channel');
  const title       = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const colorStr    = interaction.options.getString('color');
  const thumbnailUrl= interaction.options.getString('thumbnail');
  const imageUrl    = interaction.options.getString('image');
  const authorName  = interaction.options.getString('author_name');
  const authorIcon  = interaction.options.getString('author_icon');
  const footerText  = interaction.options.getString('footer_text');
  const footerIcon  = interaction.options.getString('footer_icon');
  const addTimestamp= interaction.options.getBoolean('timestamp') ?? false;
  const mention     = interaction.options.getString('mention');

  // Fields (up to 3 sets)
  const fields = [];
  for (let i = 1; i <= 3; i++) {
    const name   = interaction.options.getString(`field${i}_name`);
    const value  = interaction.options.getString(`field${i}_value`);
    const inline = interaction.options.getBoolean(`field${i}_inline`) ?? false;
    if (name && value) fields.push({ name, value, inline });
  }

  // Buttons (up to 2)
  const buttons = [];
  for (let i = 1; i <= 2; i++) {
    const label = interaction.options.getString(`button${i}_label`);
    const url   = interaction.options.getString(`button${i}_url`);
    if (label && url) buttons.push({ label, url });
  }

  // ── VALIDATION ──────────────────────────────────────────────────────────
  const errors = [];

  // Must have at least one visible element
  if (!title && !description && fields.length === 0) {
    errors.push('Embed must have at least a **title**, **description**, or a **field**.');
  }

  // Length checks
  if (title       && title.length       > MAX_TITLE_LENGTH)      errors.push(`Title is too long (max ${MAX_TITLE_LENGTH} chars).`);
  if (description && description.length > MAX_DESC_LENGTH)       errors.push(`Description is too long (max ${MAX_DESC_LENGTH} chars).`);
  if (footerText  && footerText.length  > MAX_FOOTER_LENGTH)     errors.push(`Footer text is too long (max ${MAX_FOOTER_LENGTH} chars).`);
  if (authorName  && authorName.length  > MAX_AUTHOR_LENGTH)     errors.push(`Author name is too long (max ${MAX_AUTHOR_LENGTH} chars).`);

  for (const f of fields) {
    if (f.name.length  > MAX_FIELD_NAME_LENGTH)  errors.push(`Field name too long: "${f.name.slice(0, 30)}…" (max ${MAX_FIELD_NAME_LENGTH} chars).`);
    if (f.value.length > MAX_FIELD_VALUE_LENGTH) errors.push(`Field value too long for "${f.name.slice(0, 30)}" (max ${MAX_FIELD_VALUE_LENGTH} chars).`);
  }

  // Color validation
  const color = parseColor(colorStr);
  if (colorStr && color === null) {
    errors.push(`Invalid color: \`${colorStr}\`. Use a hex code like \`#FF0000\` or a name like \`red\`, \`gold\`, \`cyan\`, \`zenitsu\`, etc.`);
  }

  // URL validations
  const urlChecks = [
    [thumbnailUrl, 'Thumbnail URL'],
    [imageUrl,     'Image URL'],
    [authorIcon,   'Author Icon URL'],
    [footerIcon,   'Footer Icon URL'],
  ];
  for (const [url, label] of urlChecks) {
    const { valid, reason } = validateUrl(url);
    if (!valid) errors.push(`${label} — ${reason}`);
  }
  for (const btn of buttons) {
    const { valid, reason } = validateUrl(btn.url);
    if (!valid) errors.push(`Button "${btn.label}" URL — ${reason}`);
    if (btn.label.length > MAX_BUTTON_LABEL) errors.push(`Button label "${btn.label.slice(0, 20)}…" exceeds ${MAX_BUTTON_LABEL} chars.`);
  }

  // Channel must be a text channel
  if (!channel.isTextBased()) {
    errors.push('Target channel must be a text channel.');
  }

  // ── RETURN ERRORS ───────────────────────────────────────────────────────
  if (errors.length > 0) {
    return interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Validation Failed')
        .setDescription(errors.map((e, i) => `**${i + 1}.** ${e}`).join('\n\n'))
        .setColor(0xE74C3C)
        .setFooter({ text: 'Fix the issues above and try again.' })
    ]});
  }

  // ── BUILD THE EMBED ─────────────────────────────────────────────────────
  const embed = new EmbedBuilder().setColor(color ?? 0x2F3136);

  if (title)       embed.setTitle(trunc(title, MAX_TITLE_LENGTH));
  if (description) embed.setDescription(trunc(description, MAX_DESC_LENGTH));
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (imageUrl)    embed.setImage(imageUrl);
  if (addTimestamp) embed.setTimestamp();

  if (authorName) {
    embed.setAuthor({
      name:    trunc(authorName, MAX_AUTHOR_LENGTH),
      iconURL: authorIcon || undefined,
    });
  }

  if (footerText) {
    embed.setFooter({
      text:    trunc(footerText, MAX_FOOTER_LENGTH),
      iconURL: footerIcon || undefined,
    });
  }

  if (fields.length > 0) {
    embed.addFields(fields.map(f => ({
      name:   trunc(f.name,  MAX_FIELD_NAME_LENGTH),
      value:  trunc(f.value, MAX_FIELD_VALUE_LENGTH),
      inline: f.inline,
    })));
  }

  // ── TOTAL CHAR LIMIT CHECK ──────────────────────────────────────────────
  const totalChars = countEmbedChars(embed.toJSON());
  if (totalChars > MAX_TOTAL_EMBED_CHARS) {
    return interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Embed Too Large')
        .setDescription(`Total embed content is **${totalChars}** characters. Discord's maximum is **${MAX_TOTAL_EMBED_CHARS}**.\n\nPlease shorten your title, description, or fields.`)
        .setColor(0xE74C3C)
    ]});
  }

  // ── BUILD BUTTONS ───────────────────────────────────────────────────────
  const components = [];
  if (buttons.length > 0) {
    const row = new ActionRowBuilder().addComponents(
      buttons.map(btn =>
        new ButtonBuilder()
          .setLabel(trunc(btn.label, MAX_BUTTON_LABEL))
          .setURL(btn.url)
          .setStyle(ButtonStyle.Link)
      )
    );
    components.push(row);
  }

  // ── MENTION CONTENT ─────────────────────────────────────────────────────
  let content = undefined;
  if (mention) {
    // Allowed: @everyone, @here, or a role mention like <@&ROLE_ID>
    const mentionClean = mention.trim();
    if (mentionClean === '@everyone' || mentionClean === '@here') {
      content = mentionClean;
    } else {
      // Extract role ID if provided as <@&ID> or raw ID
      const roleId = mentionClean.replace(/[^0-9]/g, '');
      if (roleId) content = `<@&${roleId}>`;
    }
  }

  // ── SEND THE EMBED ──────────────────────────────────────────────────────
  try {
    const msg = await channel.send({
      content,
      embeds: [embed],
      components,
      allowedMentions: { parse: ['everyone', 'roles'] },
    });

    // ── SUCCESS REPLY ───────────────────────────────────────────────────
    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Embed Sent!')
        .setDescription(`Your embed was successfully sent to ${channel}.\n\n[Jump to message](${msg.url})`)
        .setColor(0x2ECC71)
        .addFields(
          { name: '📌 Channel', value: `${channel}`,       inline: true },
          { name: '🆔 Message ID', value: msg.id,          inline: true },
          { name: '🎨 Color', value: colorStr || 'Default', inline: true },
        )
        .setTimestamp()
    ]});

    // ── MOD LOG ─────────────────────────────────────────────────────────
    const logEmbed = new EmbedBuilder()
      .setTitle('📢 Embed Announcement Sent')
      .setDescription(`**Sent by:** ${interaction.user} (${interaction.user.tag})\n**Channel:** ${channel}\n**Title:** ${title || '*No title*'}`)
      .setColor(0x3498DB)
      .setTimestamp();
    await logToChannel(interaction.guild, ID.MOD_LOG, logEmbed);

  } catch (err) {
    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Send Failed')
        .setDescription(`Could not send the embed to ${channel}.\n\n**Error:** \`${err.message}\`\n\nMake sure the bot has **Send Messages** and **Embed Links** permissions in that channel.`)
        .setColor(0xE74C3C)
    ]});
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────
module.exports = { handleEmbed, hasEmbedPermission, COLOR_PRESETS };
