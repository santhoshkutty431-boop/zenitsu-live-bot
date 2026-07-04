/**
 * Chunker
 * Splits raw message content into overlapping token-bounded chunks.
 *
 * Strategy:
 *   - Approximate token count: 1 token ≈ 4 characters (GPT/Claude rough average)
 *   - Chunk size:    400 tokens  (~1600 chars)
 *   - Overlap:        50 tokens  (~200 chars)  — preserves sentence context across boundaries
 *
 * Each chunk carries the metadata needed for permission filtering and attribution.
 */

const CHUNK_SIZE_CHARS   = 1600; // ~400 tokens
const OVERLAP_CHARS      = 200;  // ~50 tokens

class Chunker {
  /**
   * @param {object} message
   * @param {string} message.id           Discord message snowflake
   * @param {string} message.content      Raw text content
   * @param {string} message.channelId    Source channel ID
   * @param {string} message.channelName  Human-readable channel name
   * @param {string} message.authorId     Author snowflake
   * @param {string[]} message.authorRoles Role IDs of the author at time of indexing
   * @param {number} message.timestamp    Unix ms timestamp
   * @returns {object[]} Array of chunk objects
   */
  chunk(message) {
    const text = (message.content ?? '').trim();
    if (!text) return [];

    const segments = this._splitIntoSegments(text);
    return segments.map((segment, idx) => ({
      chunkId:     `${message.id}_${idx}`,
      messageId:   message.id,
      text:        segment,
      sourceChannel:   message.channelId,
      channelName:     message.channelName,
      authorId:        message.authorId,
      authorRoles:     message.authorRoles ?? [],
      timestamp:       message.timestamp,
      vector:          null, // populated by VectorStore after embedding
    }));
  }

  /**
   * Remove all chunks associated with a message ID.
   * @param {object[]} existingChunks
   * @param {string}   messageId
   * @returns {object[]}
   */
  removeByMessageId(existingChunks, messageId) {
    return existingChunks.filter(c => c.messageId !== messageId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _splitIntoSegments(text) {
    if (text.length <= CHUNK_SIZE_CHARS) return [text];

    const segments = [];
    let start = 0;

    while (start < text.length) {
      // Hard end of this chunk
      const hardEnd = Math.min(start + CHUNK_SIZE_CHARS, text.length);

      // Try to find a sentence boundary in the last 20% of the chunk window
      let end = hardEnd;
      if (hardEnd < text.length) {
        const searchFrom = start + Math.floor(CHUNK_SIZE_CHARS * 0.8);
        const boundary   = this._findSentenceBoundary(text, searchFrom, hardEnd);
        if (boundary > searchFrom) end = boundary;
      }

      segments.push(text.slice(start, end).trim());

      // Next window starts OVERLAP_CHARS before current end
      // But must always advance by at least 1 character to guarantee termination
      const nextStart = end - OVERLAP_CHARS;
      start = nextStart > start ? nextStart : end;
    }

    return segments.filter(s => s.length > 0);
  }

  _findSentenceBoundary(text, from, to) {
    // Search backwards from to → from for a sentence-ending character
    for (let i = Math.min(to, text.length - 1); i >= from; i--) {
      const c = text[i];
      if (c === '.' || c === '!' || c === '?' || c === '\n') {
        return i + 1;
      }
    }
    return -1;
  }
}

module.exports = new Chunker();
