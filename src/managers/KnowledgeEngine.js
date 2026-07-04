class KnowledgeEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.dbService = null;
    this.permService = null;
    
    this.guildSnapshots = new Map();
    this.semanticDocuments = new Map(); // Map<guildId, Array<{ title, content, category, citedSource, allowedTier }>>
  }

  async onInit() {
    this.logger.info('Initializing Knowledge Engine (v3.1 Semantic Digital Twin)...');
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

  // Add structured documents to the semantic search index
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

    // Bootstrap default system FAQs & rules
    this.bootstrapStaticKnowledge(guild.id);
  }

  bootstrapStaticKnowledge(guildId) {
    // Empty index and rebuild
    this.semanticDocuments.set(guildId, []);

    // 1. Add Default Rules
    this.addDocument(
      guildId,
      'Server Rules',
      '1. Be respectful to all members.\n2. No spamming or advertising in chat channels.\n3. Do not share illegal or malicious links.\n4. Keep usernames and avatars appropriate.',
      'rules',
      'Rules Channel (#rules)'
    );

    // 2. Add Tickets Procedure
    this.addDocument(
      guildId,
      'Support Tickets Procedure',
      'To open a ticket, navigate to the #tickets channel and click on the "Create Ticket" panel button. A private channel will be created for you automatically.',
      'tickets',
      'Ticket Configuration Settings'
    );

    // 3. Add Shop Info
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
    // Simulated index update on pinned/FAQ updates
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
    const docs = this.semanticDocuments.get(guildId) || [];
    if (docs.length === 0) return [];

    const lowerQuery = query.toLowerCase();

    // Semantic search simulation (keywords mapping & relevance scoring)
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

    // Filter results based on user permissions
    const filtered = [];
    for (const match of matches) {
      const allowed = this.permService.resolvePermission(null, 'whoami', userId);
      // Simplify check: Developer and Server Owner see everything. Public matches get filtered.
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
}

module.exports = KnowledgeEngine;
