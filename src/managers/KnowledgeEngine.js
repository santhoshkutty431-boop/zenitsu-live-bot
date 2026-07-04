const { ChannelType } = require('discord.js');
const Chunker     = require('../core/knowledge/Chunker');
const VectorStore = require('../core/knowledge/VectorStore');

const MAX_CONTEXT_TOKENS  = 2000;
const CHARS_PER_TOKEN     = 4;
const MAX_CONTEXT_CHARS   = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
const INTERNAL_CHANNEL_PATTERNS = [/mod[-_]?log/i, /security/i, /admin[-_]?log/i];
const STAFF_PERMISSIONS   = ['ManageGuild', 'KickMembers', 'BanMembers'];

class KnowledgeEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = null;
    this.permService = null;
    
    this.guildSnapshots = new Map();
    this.semanticDocuments = new Map(); // Map<guildId, Array<{ title, content, category, citedSource, allowedTier }>>
    
    this.vectorStore = new VectorStore(runtime);
  }

  async onInit() {
    this.logger.info('Initializing Knowledge Engine (v5.2 Semantic Digital Twin)...');
    this.dbService = this.runtime.getService('DatabaseManager');
    this.permService = this.runtime.getService('PermissionEngine');

    // Subscribe to EventBus updates for sync
    this.runtime.eventBus.subscribe('DISCORD_GUILD_UPDATE', async (data) => this.syncGuild(data.guild));
    this.runtime.eventBus.subscribe('DISCORD_CHANNEL_UPDATE', async (data) => this.syncGuild(data.guild));
    this.runtime.eventBus.subscribe('DISCORD_ROLE_UPDATE', async (data) => this.syncGuild(data.guild));

    // Listen to changes to rebuild structured FAQ knowledge
    this.runtime.eventBus.subscribe('PINNED_MESSAGE_CHANGED', async (data) => this.rebuildFAQ(data.guildId));
    this.runtime.eventBus.subscribe('SHOP_PRODUCTS_CHANGED', async (data) => this.rebuildShop(data.guildId));
  }

  async onShutdown() {
    this.logger.info('Shutting down Knowledge Engine...');
    this.guildSnapshots.clear();
    this.semanticDocuments.clear();
  }

  // ─── v5.2 RAG Channel Indexing ─────────────────────────────────────────────

  /**
   * Fetches message history from all approved channels and indexes them.
   * @param {import('discord.js').Guild} guild
   */
  async initialIndex(guild) {
    const gdb             = this.dbService.getGuildDb(guild.id);
    const approvedChannels = Object.values(gdb.approvedChannels).filter(Boolean);

    for (const channelId of approvedChannels) {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        await this._indexChannel(guild.id, channel);
      } catch (err) {
        console.error(`[KnowledgeEngine] Failed to index channel ${channelId}:`, err);
      }
    }

    this.logger.info(`[KnowledgeEngine] Initial index complete for guild ${guild.id}`);
  }

  /**
   * Index a single channel's message history.
   */
  async _indexChannel(guildId, channel) {
    let lastId    = null;
    let batchSize = 100;

    while (true) {
      const options = { limit: batchSize };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options);
      if (!messages.size) break;

      const chunks = [];
      for (const msg of messages.values()) {
        if (!msg.content || msg.author.bot) continue;

        const rawChunks = Chunker.chunk({
          id:          msg.id,
          content:     msg.content,
          channelId:   channel.id,
          channelName: channel.name,
          authorId:    msg.author.id,
          authorRoles: msg.member?.roles.cache.map(r => r.id) ?? [],
          timestamp:   msg.createdTimestamp,
        });

        for (const chunk of rawChunks) {
          const allowed = this.dbService.checkAndRecordEmbedding(guildId);
          if (!allowed) {
            console.warn(`[KnowledgeEngine] Embedding budget exhausted for guild ${guildId}`);
            return;
          }
          chunk.vector = await this._embed(chunk.text);
          chunks.push(chunk);
        }
      }

      if (chunks.length) await this.vectorStore.upsertChunks(guildId, chunks);

      if (messages.size < batchSize) break;
      lastId = messages.last().id;
    }
  }

  // ─── Incremental updates (called from SyncListeners) ─────────────────────

  async indexMessage(guildId, message) {
    if (message.author?.bot || !message.content) return;
    if (!this._isApprovedChannel(guildId, message.channelId)) return;

    const allowed = this.dbService.checkAndRecordEmbedding(guildId);
    if (!allowed) {
      console.warn(`[KnowledgeEngine] Budget exceeded, skipping message ${message.id}`);
      return;
    }

    const rawChunks = Chunker.chunk({
      id:          message.id,
      content:     message.content,
      channelId:   message.channelId,
      channelName: message.channel?.name ?? '',
      authorId:    message.author.id,
      authorRoles: message.member?.roles.cache.map(r => r.id) ?? [],
      timestamp:   message.createdTimestamp,
    });

    const chunks = [];
    for (const chunk of rawChunks) {
      chunk.vector = await this._embed(chunk.text);
      chunks.push(chunk);
    }

    await this.vectorStore.upsertChunks(guildId, chunks);
  }

  async deleteMessage(guildId, messageId, channelId) {
    if (!this._isApprovedChannel(guildId, channelId)) return;
    await this.vectorStore.deleteByMessageId(guildId, messageId);
  }

  // ─── Query (permission-first pipeline) ───────────────────────────────────

  async query(guildId, userId, member, query) {
    const allowed = this.dbService.checkAndRecordQuery(guildId, userId);
    if (!allowed) {
      return "⏳ You've reached your query limit for this hour. Try again later.";
    }

    const allowedChannelIds = this._resolveAllowedChannels(guildId, member);
    if (!allowedChannelIds.length) {
      return "🔒 You don't have permission to access any of my knowledge sources.";
    }

    const queryVector = await this._embed(query);

    const gdb     = this.dbService.getGuildDb(guildId);
    const isStaff = this._isStaff(member);
    const topK    = 5;

    const searchChannels = isStaff
      ? allowedChannelIds
      : allowedChannelIds.filter(id => !this._isInternalChannel(gdb, id));

    const results = await this.vectorStore.search(guildId, queryVector, searchChannels, topK);

    if (!results.length) {
      return "❌ Trusted information is unavailable for that question. Please check with a staff member.";
    }

    const { contextText, sources } = this._buildContext(results);

    const stalenessWarning = gdb.indexPaused
      ? '\n\n⚠️ *Note: The knowledge index is temporarily paused. Some information may be outdated.*'
      : '';

    const response = await this._callAI(userId, query, contextText);

    const attribution = sources.length
      ? `*Sources: ${sources.join(', ')}*\n\n`
      : '';

    return `${attribution}${response}${stalenessWarning}`;
  }

  // ─── Legacy Method Integrations ────────────────────────────────────────────

  addDocument(guildId, title, content, category, citedSource, allowedTier = 'PUBLIC') {
    if (!this.semanticDocuments.has(guildId)) {
      this.semanticDocuments.set(guildId, []);
    }
    this.semanticDocuments.get(guildId).push({
      title,
      content,
      category,
      citedSource,
      allowedTier
    });
    this.logger.debug(`Document added to semantic index: [${title}] (${category})`);
  }

  async syncGuild(guild) {
    if (!guild) return;
    this.logger.debug(`Synchronizing Knowledge Engine Digital Twin for guild: ${guild.name} (${guild.id})`);
    const snapshot = await this.buildGuildSnapshot(guild);
    this.guildSnapshots.set(guild.id, snapshot);

    this.bootstrapStaticKnowledge(guild.id);
  }

  bootstrapStaticKnowledge(guildId) {
    this.semanticDocuments.set(guildId, []);

    this.addDocument(
      guildId,
      'Server Rules',
      '1. Be respectful to all members.\n2. No spamming or advertising in chat channels.\n3. Do not share illegal or malicious links.\n4. Keep usernames and avatars appropriate.',
      'rules',
      'Rules Channel (#rules)'
    );

    this.addDocument(
      guildId,
      'Support Tickets Procedure',
      'To open a ticket, navigate to the #tickets channel and click on the "Create Ticket" panel button. A private channel will be created for you automatically.',
      'tickets',
      'Ticket Configuration Settings'
    );

    this.addDocument(
      guildId,
      'Premium Panel Purchases',
      'You can purchase a premium panel by visiting the #shop channel or running the /buy command. Contact support if you face checkout issues.',
      'shop',
      'Server Shop Registry'
    );
  }

  async rebuildFAQ(guildId) {
    this.logger.info(`Rebuilding FAQ knowledge for guild: ${guildId}`);
    this.addDocument(
      guildId,
      'Frequently Asked Questions',
      'Q: How do I get verified?\nA: Run the /verify command or complete the welcome portal verification.',
      'faq',
      'FAQ Channel Pinned Messages'
    );
  }

  async rebuildShop(guildId) {
    this.logger.info(`Rebuilding Shop knowledge for guild: ${guildId}`);
  }

  async searchKnowledge(query, guildId, userId) {
    const client = this.runtime.getService('HealthMonitor')?.discordClient;
    const member = (client && client.guilds && client.guilds.cache)
      ? client.guilds.cache.get(guildId)?.members.cache.get(userId)
      : null;
    if (member) {
      const allowedChannelIds = this._resolveAllowedChannels(guildId, member);
      if (allowedChannelIds.length > 0) {
        const queryVector = await this._embed(query);
        const gdb = this.dbService.getGuildDb(guildId);
        const isStaff = this._isStaff(member);
        const searchChannels = isStaff
          ? allowedChannelIds
          : allowedChannelIds.filter(id => !this._isInternalChannel(gdb, id));

        const results = await this.vectorStore.search(guildId, queryVector, searchChannels, 5);
        if (results.length > 0) {
          return results.map(r => ({
            title: `Chunk from #${r.channelName}`,
            content: r.text,
            category: 'vector_search',
            citedSource: `Channel #${r.channelName}`,
            allowedTier: 'PUBLIC'
          }));
        }
      }
    }

    // Fallback to legacy static search
    const docs = this.semanticDocuments.get(guildId) || [];
    if (docs.length === 0) return [];

    const lowerQuery = query.toLowerCase();
    const matches = docs.map(doc => {
      let score = 0;
      if (doc.title.toLowerCase().includes(lowerQuery)) score += 5;
      if (doc.category.toLowerCase().includes(lowerQuery)) score += 3;
      
      const words = lowerQuery.split(' ');
      for (const word of words) {
        if (word.length > 2 && doc.content.toLowerCase().includes(word)) {
          score += 1;
        }
      }
      return { doc, score };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);

    const filtered = [];
    for (const match of matches) {
      const allowed = this.permService.resolvePermission(null, 'whoami', userId);
      if (match.doc.allowedTier === 'PUBLIC' || allowed.tier === 'BOT_DEVELOPER' || allowed.tier === 'SERVER_OWNER') {
        filtered.push(match.doc);
      }
    }
    return filtered;
  }

  async buildGuildSnapshot(guild) {
    if (!guild) return null;

    try {
      const channels = guild.channels.cache.map(ch => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        parent: ch.parentId ? guild.channels.cache.get(ch.parentId)?.name : null,
        position: ch.position,
        isViewable: ch.viewable
      }));

      const roles = guild.roles.cache.map(role => ({
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.color,
        hoist: role.hoist,
        managed: role.managed
      }));

      const defaultModel = this.dbService.get('aiDefaultModel', 'gemini');
      const aiChannelId = this.dbService.get('aiChannelId', null);
      const securityConfig = this.dbService.get('securityConfig', {});
      const userLanguages = this.dbService.get('userLanguages', {});

      return {
        guildId: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        boostCount: guild.premiumSubscriptionCount || 0,
        boostTier: guild.premiumTier,
        channels,
        roles,
        botConfig: {
          defaultModel,
          aiChannelId,
          securityConfig,
          userLanguages
        },
        timestamp: Date.now()
      };
    } catch (err) {
      this.logger.error(`Failed to build guild snapshot for ${guild.name}: ${err.message}`);
      return null;
    }
  }

  async getPermissionAwareSnapshot(guild, userId) {
    if (!guild) return null;
    
    let snapshot = this.guildSnapshots.get(guild.id);
    if (!snapshot) {
      await this.syncGuild(guild);
      snapshot = this.guildSnapshots.get(guild.id);
    }

    if (!snapshot) return null;

    const member = guild.members.cache.get(userId);
    if (!member) return snapshot;

    if (this.permService.isDeveloper(userId) || userId === guild.ownerId) {
      return snapshot;
    }

    const filteredChannels = snapshot.channels.filter(ch => {
      const discordCh = guild.channels.cache.get(ch.id);
      return discordCh ? discordCh.permissionsFor(member)?.has('ViewChannel') : false;
    });

    return {
      name: snapshot.name,
      memberCount: snapshot.memberCount,
      boostCount: snapshot.boostCount,
      boostTier: snapshot.boostTier,
      channels: filteredChannels.map(c => ({ name: c.name, type: c.type, parent: c.parent })),
      roles: snapshot.roles.map(r => ({ name: r.name })),
      botConfig: {
        aiChannel: snapshot.botConfig.aiChannelId ? guild.channels.cache.get(snapshot.botConfig.aiChannelId)?.name : 'Not Set'
      }
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _isApprovedChannel(guildId, channelId) {
    const gdb = this.dbService.getGuildDb(guildId);
    return Object.values(gdb.approvedChannels).includes(channelId);
  }

  _resolveAllowedChannels(guildId, member) {
    const gdb      = this.dbService.getGuildDb(guildId);
    const approved = Object.values(gdb.approvedChannels).filter(Boolean);

    return approved.filter(chId => {
      const channel = member.guild.channels.cache.get(chId);
      return channel && channel.permissionsFor(member).has('ViewChannel');
    });
  }

  _isStaff(member) {
    return STAFF_PERMISSIONS.some(perm => member.permissions.has(perm));
  }

  _isInternalChannel(gdb, channelId) {
    const ch = gdb.metadata.channels.find(c => c.id === channelId);
    if (!ch) return false;
    return INTERNAL_CHANNEL_PATTERNS.some(rx => rx.test(ch.name));
  }

  _buildContext(chunks) {
    let contextText = '';
    const sourceSet = new Set();

    for (const chunk of chunks) {
      const addition = `[${chunk.channelName}]: ${chunk.text}\n\n`;
      if ((contextText + addition).length > MAX_CONTEXT_CHARS) break;
      contextText += addition;
      sourceSet.add(`#${chunk.channelName}`);
    }

    return {
      contextText,
      sources: [...sourceSet],
    };
  }

  // ─── Embedding & AI call ──────────────────────────────────────────────────

  async _embed(text) {
    if (process.env.OPENAI_API_KEY) {
      try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text
          })
        });
        const data = await res.json();
        if (data.data && data.data[0] && data.data[0].embedding) {
          return data.data[0].embedding;
        }
      } catch (err) {
        console.error('[Embedding API Error]:', err);
      }
    }

    // Deterministic pseudo-embedding for local fallback
    const dim = 384;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  async _callAI(userId, query, context) {
    const systemPrompt = `You are a helpful server assistant. Answer the user's question ONLY using the provided context. If the context does not cover the question, reply EXACTLY with "Trusted information is unavailable." Do not fabricate any information.`;
    const prompt = `Context:\n${context}\n\nQuestion: ${query}`;

    try {
      const response = await this.aiService.query(userId, prompt, 'gemini', systemPrompt);
      if (response && response.response) {
        return response.response;
      }
    } catch (err) {
      console.error('[KnowledgeEngine AI Query Error]:', err);
    }
    return '❌ Error generating response from AI. Please try again.';
  }
}

module.exports = KnowledgeEngine;
