'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function makePollComponents(question, options, votes = {}, isClosed = false, expiresAt = null) {
  // Calculate votes
  const totalVotes = Object.keys(votes).length;
  const optionVotes = options.map(() => 0);
  for (const votedOpt of Object.values(votes)) {
    if (votedOpt >= 0 && votedOpt < options.length) {
      optionVotes[votedOpt]++;
    }
  }

  // Build description with progress bars
  const descriptionLines = [];
  options.forEach((opt, idx) => {
    const count = optionVotes[idx];
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    
    // Create progress bar: 12 blocks total
    const filledBlocks = totalVotes > 0 ? Math.round((count / totalVotes) * 12) : 0;
    const bar = '█'.repeat(filledBlocks) + '░'.repeat(12 - filledBlocks);
    
    descriptionLines.push(`**${idx + 1}.** ${opt}\n\`[${bar}]\` **${pct}%** (${count} ${count === 1 ? 'vote' : 'votes'})`);
  });

  const embed = new EmbedBuilder()
    .setTitle(isClosed ? `🗳️ Poll Closed: ${question}` : `🗳️ Active Poll: ${question}`)
    .setDescription(descriptionLines.join('\n\n'))
    .setColor(isClosed ? 0x2F3136 : 0xEDC231)
    .setTimestamp();

  if (!isClosed && expiresAt) {
    const timeHtml = `<t:${Math.floor(expiresAt / 1000)}:R>`;
    embed.addFields({ name: '⏱️ Ends', value: timeHtml, inline: true });
  }
  embed.addFields({ name: '📊 Total Votes', value: `\`${totalVotes}\` votes cast`, inline: true });

  // Create buttons
  const rows = [];
  if (!isClosed) {
    let currentRow = new ActionRowBuilder();
    options.forEach((opt, idx) => {
      // Limit to 4 buttons per row to leave space for retract
      if (idx > 0 && idx % 4 === 0) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
      const label = opt.length > 30 ? opt.slice(0, 30) + '...' : opt;
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_vote_${idx}`)
          .setLabel(`${idx + 1}. ${label}`)
          .setStyle(ButtonStyle.Secondary)
      );
    });

    // Add retract button as the last button
    if (currentRow.components.length >= 4) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId('poll_vote_retract')
        .setLabel('🚫 Retract Vote')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(currentRow);
  }

  return { embed, components: rows };
}

async function closePoll(client, dbService, poll) {
  try {
    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (msg) {
      const { embed } = makePollComponents(poll.question, poll.options, poll.votes, true);
      
      // Update message (keep the first announcement embed, update the second poll embed)
      const embeds = [...msg.embeds];
      if (embeds.length > 1) {
        embeds[1] = embed;
      } else {
        embeds[0] = embed;
      }

      await msg.edit({
        embeds,
        components: [] // Remove buttons
      });
    }
  } catch (err) {
    console.error(`[PollManager] Failed to close poll ${poll.messageId}:`, err.message);
  } finally {
    dbService.deletePoll(poll.messageId);
  }
}

async function initPolls(client, runtime) {
  const dbService = runtime.getService('DatabaseManager');
  const scheduler = runtime.getService('TaskScheduler');
  if (!dbService || !scheduler) return;

  const polls = dbService.getActivePolls();
  const now = Date.now();

  for (const poll of polls) {
    const delay = poll.expiresAt - now;
    if (delay <= 0) {
      console.log(`[PollManager] Closing expired poll ${poll.messageId} on boot.`);
      await closePoll(client, dbService, poll);
    } else {
      console.log(`[PollManager] Scheduling poll closure for ${poll.messageId} in ${delay}ms.`);
      scheduler.schedule(`poll_close_${poll.messageId}`, delay, async () => {
        await closePoll(client, dbService, poll);
      });
    }
  }
}

async function handlePollVote(interaction, dbService) {
  const messageId = interaction.message.id;
  const poll = dbService.getPoll(messageId);
  if (!poll) {
    return interaction.reply({ content: '⚠️ This poll is no longer active.', ephemeral: true });
  }

  const userId = interaction.user.id;
  const customId = interaction.customId;

  // Check if retracting vote
  if (customId === 'poll_vote_retract') {
    if (poll.votes[userId] === undefined) {
      return interaction.reply({ content: '⚠️ You have not cast a vote in this poll yet.', ephemeral: true });
    }
    delete poll.votes[userId];
    dbService.updatePollVotes(messageId, poll.votes);
    
    // Rebuild components & edit message
    const { embed, components } = makePollComponents(poll.question, poll.options, poll.votes, false, poll.expiresAt);
    const embeds = [...interaction.message.embeds];
    if (embeds.length > 1) embeds[1] = embed;
    else embeds[0] = embed;

    await interaction.update({ embeds, components });
    return;
  }

  // Parse option index
  const idx = parseInt(customId.replace('poll_vote_', ''), 10);
  if (isNaN(idx) || idx < 0 || idx >= poll.options.length) {
    return interaction.reply({ content: '❌ Invalid vote option.', ephemeral: true });
  }

  // Check if same vote
  if (poll.votes[userId] === idx) {
    return interaction.reply({ content: '⚠️ You have already voted for this option.', ephemeral: true });
  }

  // Register vote
  poll.votes[userId] = idx;
  dbService.updatePollVotes(messageId, poll.votes);

  // Rebuild components & edit message
  const { embed, components } = makePollComponents(poll.question, poll.options, poll.votes, false, poll.expiresAt);
  const embeds = [...interaction.message.embeds];
  if (embeds.length > 1) embeds[1] = embed;
  else embeds[0] = embed;

  await interaction.update({ embeds, components });
}

module.exports = {
  makePollComponents,
  closePoll,
  initPolls,
  handlePollVote
};
