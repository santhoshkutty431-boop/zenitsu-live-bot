/**
 * VectorStore
 *
 * Local cosine-similarity store. Vectors are persisted inside each guild's
 * isolated JSON file (suitable for small-to-medium servers).
 *
 * Pluggable adapter interface: swap to pgvector or Chroma by implementing:
 *   async upsertChunks(guildId, chunks)
 *   async search(guildId, queryVector, allowedChannelIds, topK)
 *   async deleteByMessageId(guildId, messageId)
 *
 * The KnowledgeEngine only ever calls those three methods — swap the adapter
 * without touching anything else.
 */

const SIMILARITY_THRESHOLD = 0.72;

class VectorStore {
  constructor(runtime) {
    this.runtime = runtime;
  }

  get dbService() {
    return this.runtime.getService('DatabaseManager');
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Upsert chunks into the guild document store.
   * Removes existing chunks for those messageIds first (idempotent).
   * @param {string}   guildId
   * @param {object[]} chunks  — chunks with .vector populated
   */
  async upsertChunks(guildId, chunks) {
    if (!chunks.length) return;

    this.dbService.updateGuild(guildId, gdb => {
      // Remove stale chunks for the same message IDs
      const incomingMessageIds = new Set(chunks.map(c => c.messageId));
      gdb.documents = gdb.documents.filter(
        d => !incomingMessageIds.has(d.messageId)
      );
      // Append new chunks
      gdb.documents.push(...chunks);
      gdb.indexVersion = (gdb.indexVersion ?? 0) + 1;
    });
  }

  /**
   * Remove all chunks belonging to a Discord message.
   */
  async deleteByMessageId(guildId, messageId) {
    this.dbService.updateGuild(guildId, gdb => {
      gdb.documents = gdb.documents.filter(d => d.messageId !== messageId);
    });
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * Cosine similarity search — ONLY over allowed channel IDs.
   * Pre-filters before scoring; never scores documents the user can't see.
   *
   * @param {string}   guildId
   * @param {number[]} queryVector        Embedding of the user's query
   * @param {string[]} allowedChannelIds  Pre-resolved from user's permissions
   * @param {number}   topK               Max results to return
   * @returns {object[]} Ranked chunks above threshold, with .score attached
   */
  async search(guildId, queryVector, allowedChannelIds, topK = 5) {
    const gdb        = this.dbService.getGuildDb(guildId);
    const allowed    = new Set(allowedChannelIds);

    // Pre-filter: only chunks from channels the user can view
    const candidates = gdb.documents.filter(
      chunk => chunk.vector && allowed.has(chunk.sourceChannel)
    );

    if (!candidates.length) return [];

    // Score
    const scored = candidates.map(chunk => ({
      ...chunk,
      score: this._cosineSimilarity(queryVector, chunk.vector),
    }));

    // Filter by threshold, sort descending, take topK
    return scored
      .filter(c => c.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ─── Math ──────────────────────────────────────────────────────────────────

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

module.exports = VectorStore;
