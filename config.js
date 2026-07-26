const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  categoryTickets: process.env.CATEGORY_TICKETS,
  channelWelcome: process.env.CHANNEL_WELCOME,
  channelReports: process.env.CHANNEL_REPORTS,
  channelFeedback: process.env.CHANNEL_FEEDBACK,
  channelPanel: process.env.CHANNEL_PANEL,
  channelSongRequest: process.env.CHANNEL_SONG_REQUEST,
};
