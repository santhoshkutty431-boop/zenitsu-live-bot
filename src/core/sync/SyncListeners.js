/**
 * SyncListeners
 *
 * Attaches Discord gateway listeners to a client instance.
 * Message events in approved channels are debounced via per-guild queues:
 *   - Flushes after 15 seconds of idle, OR
 *   - Immediately when 50 items accumulate
 *
 * Structural events (channel/role changes) update metadata only — no re-index.
 */

const DEBOUNCE_IDLE_MS = 15_000;  // 15 seconds idle
const QUEUE_MAX        = 50;      // flush immediately at this size

class SyncListeners {
  constructor(runtime) {
    this.runtime = runtime;
    this._queues = new Map();
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  get knowledgeEngine() {
    return this.runtime.getService('KnowledgeEngine');
  }

  /**
   * Register all listeners on the Discord client.
   * @param {import('discord.js').Client} client
   */
  register(client) {
    // ── Structural metadata sync (no re-index needed) ─────────────────────

    client.on('channelCreate', ch  => this._syncChannels(ch.guild));
    client.on('channelDelete', ch  => this._syncChannels(ch.guild));
    client.on('channelUpdate', ch  => this._syncChannels(ch.guild));

    client.on('roleCreate', role   => this._syncRoles(role.guild));
    client.on('roleDelete', role   => this._syncRoles(role.guild));
    client.on('roleUpdate', role   => this._syncRoles(role.guild));

    // ── Guild leave: clean up isolated DB file ────────────────────────────

    client.on('guildDelete', guild => {
      this._clearQueue(guild.id);
      this.dbService.deleteGuildDb(guild.id);
      console.log(`[Sync] Removed guild DB for ${guild.id}`);
    });

    // ── Message events: queue → debounce → batch index ───────────────────

    client.on('messageCreate', msg => {
      if (msg.author?.bot || !msg.guild) return;
      this._enqueue(msg.guild.id, { op: 'upsert', message: msg });
    });

    client.on('messageUpdate', (_, newMsg) => {
      if (newMsg.author?.bot || !newMsg.guild || !newMsg.content) return;
      this._enqueue(newMsg.guild.id, { op: 'upsert', message: newMsg });
    });

    client.on('messageDelete', msg => {
      if (!msg.guild) return;
      this._enqueue(msg.guild.id, {
        op:        'delete',
        messageId: msg.id,
        channelId: msg.channelId,
        guildId:   msg.guild.id,
      });
    });

    console.log('[Sync] Listeners registered.');
  }

  // ─── Queue & debounce ─────────────────────────────────────────────────────

  _enqueue(guildId, item) {
    if (!this._queues.has(guildId)) {
      this._queues.set(guildId, { queue: [], timer: null });
    }

    const state = this._queues.get(guildId);
    state.queue.push(item);

    // Clear existing debounce timer
    if (state.timer) clearTimeout(state.timer);

    // Flush immediately if queue is full
    if (state.queue.length >= QUEUE_MAX) {
      this._flush(guildId);
      return;
    }

    // Otherwise restart idle timer
    state.timer = setTimeout(() => this._flush(guildId), DEBOUNCE_IDLE_MS);
  }

  async _flush(guildId) {
    const state = this._queues.get(guildId);
    if (!state || !state.queue.length) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const batch = state.queue.splice(0);  // drain queue atomically
    console.log(`[Sync] Flushing ${batch.length} queued ops for guild ${guildId}`);

    for (const item of batch) {
      try {
        if (item.op === 'upsert') {
          await this.knowledgeEngine.indexMessage(guildId, item.message);
        } else if (item.op === 'delete') {
          await this.knowledgeEngine.deleteMessage(guildId, item.messageId, item.channelId);
        }
      } catch (err) {
        console.error(`[Sync] Error processing op ${item.op} for guild ${guildId}:`, err);
      }
    }
  }

  _clearQueue(guildId) {
    const state = this._queues.get(guildId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    this._queues.delete(guildId);
  }

  // ─── Structural metadata syncs ────────────────────────────────────────────

  async _syncChannels(guild) {
    if (!guild) return;
    try {
      await guild.channels.fetch().catch(() => {});
      this.dbService.updateGuild(guild.id, gdb => {
        gdb.metadata.channels = guild.channels.cache
          .filter(ch => ch.isTextBased())
          .map(ch => ({ id: ch.id, name: ch.name, parentId: ch.parentId ?? null }));
      });
    } catch (err) {
      console.error(`[Sync] Channel sync failed for ${guild.id}:`, err);
    }
  }

  async _syncRoles(guild) {
    if (!guild) return;
    try {
      await guild.roles.fetch().catch(() => {});
      this.dbService.updateGuild(guild.id, gdb => {
        gdb.metadata.roles = guild.roles.cache
          .filter(r => !r.managed && r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => ({
            id:          r.id,
            name:        r.name,
            position:    r.position,
            permissions: r.permissions.toArray(),
          }));
      });
    } catch (err) {
      console.error(`[Sync] Role sync failed for ${guild.id}:`, err);
    }
  }
}

module.exports = SyncListeners;
