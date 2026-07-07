// Dashboard /manage/:guildId page and its POST action endpoints.

const { ChannelType, EmbedBuilder } = require('discord.js');

function setupManage(app, ctx) {
  const { client, db, saveDb, checkAuth } = ctx;

  // Public upload serving endpoint (no checkAuth needed so Discord can fetch it)
  app.get('/uploads/:guildId/:type', async (req, res) => {
    const { guildId, type } = req.params;
    
    // Resolve guild-specific database
    let gdb = db;
    try {
      const dbMgr = client.runtime?.getService('DatabaseManager');
      if (dbMgr) gdb = dbMgr.getGuildDb(guildId);
    } catch { /* */ }

    let mimeKey, dataKey;
    if (type === 'welcome') {
      mimeKey = 'welcomeFileMime';
      dataKey = 'welcomeFileData';
    } else if (type === 'ticket') {
      mimeKey = 'ticketFileMime';
      dataKey = 'ticketFileData';
    } else {
      return res.status(404).send('Not found');
    }

    const mime = gdb[mimeKey];
    const base64Data = gdb[dataKey];

    if (!mime || !base64Data) {
      return res.status(404).send('No file uploaded for this type');
    }

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      return res.send(buffer);
    } catch (err) {
      return res.status(500).send('Failed to parse file data');
    }
  });

  // ── PAGE ─────────────────────────────────────────────────────────────────────
  app.get('/manage/:guildId', checkAuth, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).send('<h1>Server not found.</h1><a href="/">Back to Home</a>');
    }

    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const textChannels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText)
      .map(c => ({ id: c.id, name: c.name }));

    const textChannelOptions = textChannels
      .map(c => `<option value="${c.id}"># ${c.name}</option>`)
      .join('');

    const deletedMessagesList = db.deletedMessages && db.deletedMessages.length > 0
      ? db.deletedMessages.slice().reverse().map(m => {
          const time = new Date(m.deletedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const contentStr = String(m.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.02);">
              <td style="padding: 12px 10px; color: var(--muted); font-size: 12px; white-space: nowrap;">${time}</td>
              <td style="padding: 12px 10px; font-weight: bold; color: var(--pink); white-space: nowrap;">${m.authorTag}</td>
              <td style="padding: 12px 10px; color: var(--cyan); white-space: nowrap;"># ${m.channelName}</td>
              <td style="padding: 12px 10px; word-break: break-all;">${contentStr}</td>
            </tr>`;
        }).join('')
      : `<tr style="border-bottom: none;"><td colspan="4" style="text-align: center; color: var(--muted); padding: 20px;">No deleted messages logged yet.</td></tr>`;

    await guild.members.fetch().catch(() => {});
    const memberRows = guild.members.cache
      .filter(m => !m.user.bot)
      .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp)
      .map(m => {
        const topRole = m.roles.highest.name !== '@everyone' ? m.roles.highest.name : 'No Role';
        const joinedAt = m.joinedAt ? m.joinedAt.toLocaleDateString() : 'Unknown';
        const avatar = m.user.displayAvatarURL({ size: 32 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
        return `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.02);">
            <td style="padding: 10px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border);" />
                <div>
                  <div style="font-weight: bold; font-size: 14px;">${m.user.username}</div>
                  <div style="font-size: 11px; color: var(--muted);">${m.user.id}</div>
                </div>
              </div>
            </td>
            <td style="padding: 10px; font-size: 12px; color: var(--cyan);">${topRole}</td>
            <td style="padding: 10px; font-size: 12px; color: var(--muted);">${joinedAt}</td>
            <td style="padding: 10px;">
              <div style="display: flex; gap: 6px;">
                <form method="POST" action="/manage/${guild.id}/kick/${m.id}" onsubmit="return confirm('Kick ${m.user.username}?')">
                  <button type="submit" class="action-btn btn-kick">Kick</button>
                </form>
                <form method="POST" action="/manage/${guild.id}/ban/${m.id}" onsubmit="return confirm('Permanently ban ${m.user.username}?')">
                  <button type="submit" class="action-btn btn-ban">Ban</button>
                </form>
              </div>
            </td>
          </tr>`;
      }).join('');

    const rolesList = guild.roles.cache
      .sort((a, b) => b.position - a.position)
      .map(r => `
        <span class="tag-role" style="border: 1px solid ${r.hexColor}; color: ${r.hexColor === '#000000' ? '#ffffff' : r.hexColor}">
          ${r.name}
        </span>`).join('');

    const guildIcon = guild.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png';

    res.send(renderManagePage({
      guild, guildIcon, req, textChannelOptions,
      deletedMessagesList, memberRows, rolesList, db
    }));
  });

  // ── POST ACTIONS ─────────────────────────────────────────────────────────────
  app.post('/manage/:guildId/broadcast', checkAuth, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, title, description } = req.body;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Server not found.');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).send('Invalid text channel.');
    try {
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0x00D4FF)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      res.redirect(`/manage/${guildId}?sent=1`);
    } catch (err) {
      res.status(500).send(`Failed to send message: ${err.message}`);
    }
  });

  app.post('/manage/:guildId/customizations', checkAuth, (req, res) => {
    const { guildId } = req.params;
    const { welcomeTitle, welcomeDescription, welcomeImage, ticketDescription, ticketImage } = req.body;
    
    db.welcomeTitle = welcomeTitle || '';
    db.welcomeDescription = welcomeDescription || '';
    db.welcomeImage = welcomeImage || '';
    db.ticketDescription = ticketDescription || '';
    db.ticketImage = ticketImage || '';

    // Handle files if uploaded
    if (req.files) {
      if (req.files.welcomeUpload && req.files.welcomeUpload.name) {
        const file = req.files.welcomeUpload;
        db.welcomeFileMime = file.mimetype;
        db.welcomeFileData = file.data.toString('base64');
        db.welcomeImage = `${req.protocol}://${req.get('host')}/uploads/${guildId}/welcome`;
      }
      if (req.files.ticketUpload && req.files.ticketUpload.name) {
        const file = req.files.ticketUpload;
        db.ticketFileMime = file.mimetype;
        db.ticketFileData = file.data.toString('base64');
        db.ticketImage = `${req.protocol}://${req.get('host')}/uploads/${guildId}/ticket`;
      }
    }
    
    saveDb();
    res.redirect(`/manage/${guildId}?updated=1`);
  });

  app.post('/manage/:guildId/toggle-automod', checkAuth, (req, res) => {
    const { guildId } = req.params;
    db.protectmeActive = !db.protectmeActive;
    saveDb();
    res.redirect(`/manage/${guildId}?updated=1`);
  });

  app.post('/manage/:guildId/clear-deleted-logs', checkAuth, (req, res) => {
    const { guildId } = req.params;
    db.deletedMessages = [];
    saveDb();
    res.redirect(`/manage/${guildId}?updated=1`);
  });

  app.post('/manage/:guildId/set-spam-timeout', checkAuth, (req, res) => {
    const { guildId } = req.params;
    const minutes = parseInt(req.body.minutes, 10);
    if (!isNaN(minutes) && minutes > 0) {
      db.spamTimeoutMinutes = minutes;
      saveDb();
    }
    res.redirect(`/manage/${guildId}?updated=1`);
  });

  app.post('/manage/:guildId/kick/:userId', checkAuth, async (req, res) => {
    const { guildId, userId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Server not found.');
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return res.redirect(`/manage/${guildId}?error=Member+not+found`);
      await member.kick('Kicked via Dashboard');
      res.redirect(`/manage/${guildId}?updated=1`);
    } catch (err) {
      res.redirect(`/manage/${guildId}?error=${encodeURIComponent(err.message)}`);
    }
  });

  app.post('/manage/:guildId/ban/:userId', checkAuth, async (req, res) => {
    const { guildId, userId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Server not found.');
    try {
      await guild.members.ban(userId, { reason: 'Banned via Dashboard' });
      res.redirect(`/manage/${guildId}?updated=1`);
    } catch (err) {
      res.redirect(`/manage/${guildId}?error=${encodeURIComponent(err.message)}`);
    }
  });
}

function renderManagePage(vars) {
  const { guild, guildIcon, req, textChannelOptions,
          deletedMessagesList, memberRows, rolesList, db } = vars;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Manage: ${guild.name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { --bg: #080a10; --container-bg: rgba(13,16,27,0.7); --border: rgba(0,212,255,0.15); --cyan: #00D4FF; --pink: #FFB7C5; --text: #fff; --muted: #8c9ba5; --green: #2ecc71; }
    body { background-color: var(--bg); color: var(--text); font-family: 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    .back-link { text-decoration: none; color: var(--cyan); font-weight: bold; font-size: 15px; }
    .server-title-group { display: flex; align-items: center; gap: 15px; flex-grow: 1; }
    .server-icon { width: 64px; height: 64px; border-radius: 50%; border: 1px solid var(--border); }
    h2 { margin: 0; font-size: 24px; }
    .server-meta { font-size: 13px; color: var(--muted); margin-top: 4px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 30px; }
    @media (min-width: 768px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { background: var(--container-bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .card-title { font-size: 18px; font-weight: bold; margin-bottom: 20px; color: var(--pink); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px; }
    .form-group { margin-bottom: 18px; }
    label { display: block; margin-bottom: 8px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    input[type="text"], select, textarea { width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 15px; box-sizing: border-box; outline: none; transition: border-color .3s; }
    input[type="text"]:focus, select:focus, textarea:focus { border-color: var(--cyan); }
    textarea { resize: vertical; min-height: 100px; }
    .btn-submit { padding: 10px 20px; background: var(--cyan); color: #000; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; cursor: pointer; transition: opacity .3s; }
    .btn-submit:hover { opacity: .9; }
    .tag-role { display: inline-block; padding: 4px 10px; margin: 4px 3px; border-radius: 20px; font-size: 12px; background: rgba(255,255,255,0.03); }
    .success-banner { background: rgba(46,204,113,0.15); border: 1px solid var(--green); color: var(--green); padding: 12px; border-radius: 6px; margin-bottom: 25px; font-size: 14px; text-align: center; }
    .config-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .config-row:last-child { border-bottom: none; }
    .config-label { font-weight: bold; font-size: 14px; }
    .config-desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .toggle-btn { padding: 6px 14px; background: rgba(0,212,255,0.1); border: 1px solid var(--cyan); border-radius: 6px; color: var(--cyan); font-weight: bold; cursor: pointer; font-size: 12px; transition: background .3s; }
    .toggle-btn.active { background: var(--cyan); color: #000; }
    .action-btn { padding: 5px 12px; border: none; border-radius: 5px; font-size: 12px; font-weight: bold; cursor: pointer; transition: opacity .2s, transform .1s; }
    .action-btn:hover { opacity: .85; }
    .action-btn:active { transform: scale(.97); }
    .btn-kick { background: rgba(230,126,34,0.2); border: 1px solid #E67E22; color: #E67E22; }
    .btn-ban { background: rgba(231,76,60,0.2); border: 1px solid #E74C3C; color: #E74C3C; }
    .btn-clear { padding: 5px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: var(--muted); font-size: 12px; font-weight: bold; cursor: pointer; transition: background .2s; }
    .btn-clear:hover { background: rgba(255,74,74,0.15); color: #ff4a4a; border-color: #ff4a4a; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <a href="/" class="back-link">← BACK</a>
      <div class="server-title-group">
        <img src="${guildIcon}" class="server-icon" alt="" />
        <div>
          <h2>${guild.name}</h2>
          <div class="server-meta">ID: ${guild.id} • Owner ID: ${guild.ownerId} • Members: ${guild.memberCount}</div>
        </div>
      </div>
    </header>

    ${req.query.sent ? '<div class="success-banner">✅ Message successfully broadcasted by the bot!</div>' : ''}
    ${req.query.updated ? '<div class="success-banner">⚙️ Server configurations updated!</div>' : ''}

    <div class="grid">
      <div class="card">
        <div class="card-title">📣 Bot Broadcast Console</div>
        <form method="POST" action="/manage/${guild.id}/broadcast">
          <div class="form-group">
            <label>Target Channel</label>
            <select name="channelId" required>${textChannelOptions || '<option disabled>No text channels found</option>'}</select>
          </div>
          <div class="form-group">
            <label>Embed Title</label>
            <input type="text" name="title" placeholder="Important Announcement" required />
          </div>
          <div class="form-group">
            <label>Embed Description</label>
            <textarea name="description" placeholder="Write your announcement details here..." required></textarea>
          </div>
          <button type="submit" class="btn-submit">Send Announcement</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">✨ Welcome & Ticket Customizations</div>
        <form method="POST" action="/manage/${guild.id}/customizations" enctype="multipart/form-data">
          <div class="form-group">
            <label>Welcome Title</label>
            <input type="text" name="welcomeTitle" value="${db.welcomeTitle || ''}" placeholder="e.g. ⚡ Welcome to {guild}, {username}!" />
          </div>
          <div class="form-group">
            <label>Welcome Description</label>
            <textarea name="welcomeDescription" placeholder="e.g. Hello {username}! Welcome to our server...">${db.welcomeDescription || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Welcome Banner URL (GIF/PNG)</label>
            <input type="text" name="welcomeImage" value="${db.welcomeImage || ''}" placeholder="e.g. https://media.giphy.com/media/.../giphy.gif" />
          </div>
          <div class="form-group">
            <label>Or Upload Welcome File (GIF/Video/Image)</label>
            <input type="file" name="welcomeUpload" accept="image/*,video/*" style="font-size: 14px; color: var(--muted);" />
            ${db.welcomeFileMime ? `<div style="font-size: 11px; color: var(--green); margin-top: 4px;">Current upload: ${db.welcomeFileMime}</div>` : ''}
          </div>
          <div class="form-group">
            <label>Ticket Description</label>
            <textarea name="ticketDescription" placeholder="Custom text inside new tickets...">${db.ticketDescription || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Ticket Banner URL (GIF/PNG)</label>
            <input type="text" name="ticketImage" value="${db.ticketImage || ''}" placeholder="e.g. https://media.giphy.com/media/.../giphy.gif" />
          </div>
          <div class="form-group">
            <label>Or Upload Ticket File (GIF/Video/Image)</label>
            <input type="file" name="ticketUpload" accept="image/*,video/*" style="font-size: 14px; color: var(--muted);" />
            ${db.ticketFileMime ? `<div style="font-size: 11px; color: var(--green); margin-top: 4px;">Current upload: ${db.ticketFileMime}</div>` : ''}
          </div>
          <button type="submit" class="btn-submit">Save Customizations</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">⚙️ Bot Operations & Security</div>

        <div class="config-row">
          <div>
            <div class="config-label">Auto-Moderation Filter</div>
            <div class="config-desc">Blocks invite links, scams, and excessive CAPS</div>
          </div>
          <form method="POST" action="/manage/${guild.id}/toggle-automod">
            <button type="submit" class="toggle-btn ${db.protectmeActive ? 'active' : ''}">
              ${db.protectmeActive ? 'ENABLED' : 'DISABLED'}
            </button>
          </form>
        </div>

        <div class="config-row">
          <div>
            <div class="config-label">XP Level System</div>
            <div class="config-desc">Logs milestone roles and member activity rank</div>
          </div>
          <span style="color: var(--green); font-size: 13px; font-weight: bold;">● RUNNING</span>
        </div>

        <div class="config-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
          <div>
            <div class="config-label">Role Whitelist Accounts</div>
            <div class="config-desc">Users allowed to bypass role-giving guard</div>
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
            ${db.roleWhitelist && db.roleWhitelist.length ? db.roleWhitelist.map(id => `<@${id}>`).join(', ') : 'No custom whitelists (Owners only)'}
          </div>
        </div>

        <div class="config-row">
          <div>
            <div class="config-label">Spam Auto-Timeout Duration</div>
            <div class="config-desc">How long to timeout users caught by AutoMod</div>
          </div>
          <form method="POST" action="/manage/${guild.id}/set-spam-timeout" style="display: flex; gap: 6px; align-items: center;">
            <select name="minutes" style="padding: 5px 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 5px; color: #fff; font-size: 13px;">
              ${[1, 5, 10, 30, 60].map(m => `<option value="${m}" ${(db.spamTimeoutMinutes||1) === m ? 'selected' : ''}>${m} min${m > 1 ? 's' : ''}</option>`).join('')}
            </select>
            <button type="submit" class="toggle-btn active" style="font-size: 11px;">Set</button>
          </form>
        </div>
      </div>

      <div class="card" style="grid-column: span 1;">
        <div class="card-title">🎭 Server Role Hierarchy</div>
        <div>${rolesList || '<span style="color: var(--muted)">No roles found.</span>'}</div>
      </div>

      <div class="card" style="grid-column: span 1;">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center;">
          <span>🗑️ Live Deleted Messages History (Last 50)</span>
          <form method="POST" action="/manage/${guild.id}/clear-deleted-logs">
            <button type="submit" class="btn-clear">Clear Log</button>
          </form>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; background: none; border: none; box-shadow: none;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border); text-align: left;">
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Time</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">User</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Channel</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Deleted Content</th>
              </tr>
            </thead>
            <tbody>${deletedMessagesList}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="grid-column: span 1;">
        <div class="card-title">👥 Member Management (${guild.memberCount} Members)</div>
        <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; background: none; border: none; box-shadow: none;">
            <thead style="position: sticky; top: 0; background: var(--bg);">
              <tr style="border-bottom: 1px solid var(--border); text-align: left;">
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Member</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Top Role</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Joined</th>
                <th style="padding: 10px; font-size: 11px; color: var(--muted); text-transform: uppercase;">Actions</th>
              </tr>
            </thead>
            <tbody>${memberRows || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">No members found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { setupManage };
