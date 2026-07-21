const Database = require('better-sqlite3');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const DB_PATH = path.join(__dirname, '../data/zenitsu.db');
const db = new Database(DB_PATH);

// Initialize database schema
db.prepare(`
  CREATE TABLE IF NOT EXISTS pending_dm_deletions (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    delete_after INTEGER NOT NULL
  )
`).run();

/**
 * Send a clean DM to a user.
 * Deletes all previous DM messages sent by the bot to this user.
 * Sends the new message/embed, adds the 48-hour auto-delete notice,
 * and tracks the new message for deletion after 48 hours.
 * 
 * @param {User|GuildMember} user The target Discord user
 * @param {object} payload The message payload (content, embeds, components)
 * @param {boolean} autoDelete Whether this DM should auto-delete after 48 hours (default: true)
 */
async function sendCleanDm(user, payload, autoDelete = true) {
  if (!user) return null;
  
  try {
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return null;

    // 1. Fetch and delete all previous messages sent by the bot in this DM channel
    try {
      const messages = await dmChannel.messages.fetch({ limit: 100 }).catch(() => null);
      if (messages) {
        const botMessages = messages.filter(m => m.author.id === dmChannel.client.user.id);
        for (const msg of botMessages.values()) {
          await msg.delete().catch(() => {});
        }
      }
    } catch (fetchErr) {
      console.error(`[DM Manager] Failed to clean previous DMs for ${user.id || user.user?.id}:`, fetchErr.message);
    }

    // 2. Prepare payload without adding notice text to keep DMs clean
    let updatedPayload = { ...payload };

    // 3. Send the new DM message
    const sentMessage = await dmChannel.send(updatedPayload).catch(() => null);
    if (!sentMessage) return null;

    // 4. Track for deletion after 48 hours if autoDelete is true
    if (autoDelete) {
      const deleteAfter = Date.now() + (48 * 60 * 60 * 1000);
      db.prepare(`
        INSERT OR REPLACE INTO pending_dm_deletions (message_id, channel_id, user_id, delete_after)
        VALUES (?, ?, ?, ?)
      `).run(sentMessage.id, dmChannel.id, user.id || user.user?.id, deleteAfter);
    }

    return sentMessage;
  } catch (err) {
    console.error(`[DM Manager] Error sending clean DM to user ${user.id || user.user?.id}:`, err.message);
    return null;
  }
}

/**
 * Periodically checks for and deletes DMs that have passed their 48-hour expiration.
 * @param {Client} client The Discord client instance
 */
async function processPendingDmDeletions(client) {
  try {
    const now = Date.now();
    const expired = db.prepare('SELECT message_id, channel_id, user_id FROM pending_dm_deletions WHERE delete_after < ?').all(now);
    
    if (expired.length === 0) return;

    console.log(`[DM Manager] Processing ${expired.length} expired DM deletions...`);

    for (const record of expired) {
      try {
        const user = await client.users.fetch(record.user_id).catch(() => null);
        if (user) {
          const dmChannel = await user.createDM().catch(() => null);
          if (dmChannel) {
            const msg = await dmChannel.messages.fetch(record.message_id).catch(() => null);
            if (msg) {
              await msg.delete().catch(() => {});
              console.log(`[DM Manager] Deleted expired DM ${record.message_id} for user ${record.user_id}`);
            }
          }
        }
      } catch (delErr) {
        console.error(`[DM Manager] Error deleting message ${record.message_id}:`, delErr.message);
      } finally {
        db.prepare('DELETE FROM pending_dm_deletions WHERE message_id = ?').run(record.message_id);
      }
    }
  } catch (err) {
    console.error('[DM Manager] Error in processPendingDmDeletions:', err.message);
  }
}

async function pruneAllHistoricalDms(client) {
  console.log('[DM Pruner] Starting historical DM cleanup for all guild members...');
  try {
    let prunedCount = 0;
    let userCount = 0;
    
    for (const guild of client.guilds.cache.values()) {
      // Force fetching all guild members to ensure the cache is fully populated.
      const members = await guild.members.fetch().catch(() => null);
      if (!members) continue;
      
      for (const member of members.values()) {
        if (member.user.bot) continue;
        userCount++;
        
        // Add a 200ms delay between users to be gentle on Discord API rate limits
        await new Promise(r => setTimeout(r, 200));
        
        try {
          const dmChannel = await member.createDM().catch(() => null);
          if (!dmChannel) continue;
          
          const messages = await dmChannel.messages.fetch({ limit: 100 }).catch(() => null);
          if (!messages) continue;
          
          const botMessages = messages.filter(m => m.author.id === client.user.id);
          if (botMessages.size > 0) {
            for (const msg of botMessages.values()) {
              await msg.delete().catch(() => {});
              prunedCount++;
            }
          }
        } catch (err) {
          // Fail silently for individual user errors
        }
      }
    }
    console.log(`[DM Pruner] Historical cleanup completed. Checked ${userCount} users, deleted ${prunedCount} bot messages.`);
  } catch (globalErr) {
    console.error('[DM Pruner] Error during global historical DM pruning:', globalErr.message);
  }
}

module.exports = {
  sendCleanDm,
  processPendingDmDeletions,
  pruneAllHistoricalDms
};
