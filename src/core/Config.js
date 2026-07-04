require('dotenv').config();

const SYSTEM_CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  categoryTickets: process.env.CATEGORY_TICKETS,
  channelWelcome: process.env.CHANNEL_WELCOME,
  channelReports: process.env.CHANNEL_REPORTS,
  channelFeedback: process.env.CHANNEL_FEEDBACK,
  channelPanel: process.env.CHANNEL_PANEL,
  channelSongRequest: process.env.CHANNEL_SONG_REQUEST,
  hfToken: process.env.HF_TOKEN,
  hfRepo: 'kutty-35/zenitsu-live-bot',
  developers: (process.env.BOT_DEVELOPERS || process.env.OWNER_ID || '1460908819335876756').split(',').map(s => s.trim())
};

const DEFAULT_GUILD_CONFIG = {
  ai: {
    enabled: true,
    channelId: null,
    defaultModel: 'gemini',
    languages: {} // { [userId]: 'english' | 'hinglish' | 'tunglish' }
  },
  tickets: {
    categoryId: null,
    panelChannelId: null,
    languages: {} // { [channelId]: 'english' }
  },
  security: {
    antiRaid: false,
    antiSpam: true,
    antiMention: true,
    antiInvite: true,
    antiScam: true,
    antiWebhook: true,
    antiNuke: false
  },
  logging: {
    serverLogsId: process.env.SERVER_LOGS_ID || '',
    voiceLogId: process.env.VOICE_LOG_ID || '',
    modLogId: process.env.MOD_LOG_ID || '',
    messageLogId: process.env.MESSAGE_LOG_ID || ''
  },
  theme: {
    primaryColor: 0xEDC231
  }
};

class Config {
  constructor() {
    this.system = SYSTEM_CONFIG;
    this.guilds = new Map();
  }

  getSystemConfig() {
    return this.system;
  }

  getGuildConfig(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, JSON.parse(JSON.stringify(DEFAULT_GUILD_CONFIG)));
    }
    return this.guilds.get(guildId);
  }

  setGuildConfig(guildId, path, value) {
    const config = this.getGuildConfig(guildId);
    const parts = path.split('.');
    let current = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }
}

module.exports = Config;
