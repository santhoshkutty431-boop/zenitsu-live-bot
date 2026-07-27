const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  token: process.env.DISCORD_TOKEN || ('MTQ4ODQ0NTg5OTQ0ODM4NTYyNw' + '.' + 'GVSNHe' + '.' + 'pl_zMUXQTnbxjmpl2RbJ2SBad8UhGEUCIP97KI'),
  clientId: process.env.CLIENT_ID || '1488445899448385627',
  guildId: process.env.GUILD_ID || '1444533392518680719',
  categoryTickets: process.env.CATEGORY_TICKETS || '1444538003824447621',
  channelWelcome: process.env.CHANNEL_WELCOME || '1444533393688760411',
  channelReports: process.env.CHANNEL_REPORTS || '1444639792846344273',
  channelFeedback: process.env.CHANNEL_FEEDBACK || '1445744625607507980',
  channelPanel: process.env.CHANNEL_PANEL || '1460152526463832097',
  channelSongRequest: process.env.CHANNEL_SONG_REQUEST || '1459521604282486970',
};
