const { ChannelType } = require('discord.js');
const Chunker     = require('./Chunker');
const VectorStore = require('./VectorStore');

/**
 * KnowledgeEngine
 *
 * Orchestrates:
 *   - Initial channel indexing after setup wizard completes
 *   - Incremental chunk upserts/deletes triggered by SyncListeners
 *   - Permission-first query resolution
 *   - Prompt construction with attribution + failsafe
 */

const MAX_CONTEXT_TOKENS  = 2000;
const CHARS_PER_TOKEN     = 4;
const MAX_CONTEXT_CHARS   = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
const INTERNAL_CHANNEL_PATTERNS = [/mod[-_]?log/i, /security/i, /admin[-_]?log/i];
const STAFF_PERMISSIONS   = ['ManageGuild', 'KickMembers', 'BanMembers'];

class KnowledgeEngine {
  constructor(runtime) {
    this.runtime = runtime;
    this.vectorStore = new VectorStore(runtime);
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  get aiService() {
    return this.runtime.getService('AIProviderManager');
  }

  // ─── Initial index (called after wizard confirm) ──────────────────────────

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

    console.log(`[KnowledgeEngine] Initial index complete for guild ${guild.id}`);
  }

  /**
   * Index a single channel's message history.
   * @param {string} guildId
   * @param {import('discord.js').TextChannel} channel
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

        // Embed each chunk (budget-gated)
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

      // If fewer messages returned than requested, we've hit the beginning
      if (messages.size < batchSize) break;
      lastId = messages.last().id;
    }
  }

  // ─── Incremental updates (called from SyncListeners) ─────────────────────

  /**
   * Index a single new or updated message.
   * @param {string} guildId
   * @param {import('discord.js').Message} message
   */
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

  /**
   * Remove all chunks for a deleted message.
   */
  async deleteMessage(guildId, messageId, channelId) {
    if (!this._isApprovedChannel(guildId, channelId)) return;
    await this.vectorStore.deleteByMessageId(guildId, messageId);
  }

  // ─── Query (permission-first pipeline) ───────────────────────────────────

  /**
   * Full retrieval pipeline. Filters allowed sources BEFORE similarity search.
   *
   * @param {string} guildId
   * @param {string} userId
   * @param {import('discord.js').GuildMember} member
   * @param {string} query                   Raw user question
   * @returns {Promise<string>}              Final AI response string
   */
  async query(guildId, userId, member, query) {
    // Rate limit check
    const allowed = this.dbService.checkAndRecordQuery(guildId, userId);
    if (!allowed) {
      return "⏳ You've reached your query limit for this hour. Try again later.";
    }

    // Step 1: Resolve allowed channel IDs from Discord permissions
    const allowedChannelIds = this._resolveAllowedChannels(guildId, member);

    if (!allowedChannelIds.length) {
      return "🔒 You don't have permission to access any of my knowledge sources.";
    }

    // Step 2: Embed query
    const queryVector = await this._embed(query);

    // Step 3: Cosine search over ONLY allowed chunks
    const gdb     = this.dbService.getGuildDb(guildId);
    const isStaff = this._isStaff(member);
    const topK    = 5;

    // Staff can access internal channels too
    const searchChannels = isStaff
      ? allowedChannelIds
      : allowedChannelIds.filter(id => !this._isInternalChannel(gdb, id));

    const results = await this.vectorStore.search(guildId, queryVector, searchChannels, topK);

    // Step 4: Failsafe — no confident match
    if (!results.length) {
      return "❌ Trusted information is unavailable for that question. Please check with a staff member.";
    }

    // Step 5: Build prompt with token budget and attribution
    const { contextText, sources } = this._buildContext(results);

    // Step 6: Staleness warning
    const stalenessWarning = gdb.indexPaused
      ? '\n\n⚠️ *Note: The knowledge index is temporarily paused. Some information may be outdated.*'
      : '';

    // Step 7: Call AI
    const response = await this._callAI(userId, query, contextText);

    // Step 8: Prepend attribution
    const attribution = sources.length
      ? `*Sources: ${sources.join(', ')}*\n\n`
      : '';

    return `${attribution}${response}${stalenessWarning}`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _isApprovedChannel(guildId, channelId) {
    const gdb = this.dbService.getGuildDb(guildId);
    return Object.values(gdb.approvedChannels).includes(channelId);
  }

  /**
   * Returns the list of approved channel IDs the member can actually view.
   */
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

  /**
   * Builds the context string for the AI prompt, respecting the 2K token cap.
   * Collects unique source channel attributions.
   */
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

  // ─── Embedding ──────────────────────────────────────────────────────────

  /**
   * Embed a string into a vector.
   * Uses OpenAI embedding API if key is available, falls back to local psuedo-embedding.
   */
  async _embed(text) {
    if (process.env.OPENAI_API_KEY) {
      try {
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

  // ─── AI call ─────────────────────────────────────────────────────────────

  /**
   * Call the LLM with the resolved context + user query.
   */
  async _callAI(userId, query, context) {
    const systemPrompt = `You are a helpful server assistant. Answer the user's question ONLY using the provided context. If the context does not cover the question, reply EXACTLY with "Trusted information is unavailable." Do not fabricate any information.`;
    const prompt = `Context:\n${context}\n\nQuestion: ${query}`;

    try {
      const response = await this.aiService.query(userId, prompt, process.env.DEFAULT_AI_MODEL || 'groq', systemPrompt);
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
