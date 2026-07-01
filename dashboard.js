const express = require('express');
const cookieParser = require('cookie-parser');
const { ChannelType, EmbedBuilder } = require('discord.js');
const path = require('path');

function startDashboardServer(client, db, saveDb) {
  const app = express();
  const PORT = process.env.PORT || 8080;

  // Use the last 8 characters of the bot token as the default passcode if not specified
  const botToken = process.env.DISCORD_TOKEN || '';
  const defaultPasscode = botToken.substring(botToken.length - 8) || 'admin123';
  const PASSCODE = process.env.DASHBOARD_PASSCODE || defaultPasscode;

  console.log(`🔑 Dashboard Admin Passcode: "${PASSCODE}"`);

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser('zenitsu-secret-key'));

  // Middleware to check authentication
  function checkAuth(req, res, next) {
    if (req.signedCookies.authenticated === 'true') {
      next();
    } else {
      res.redirect('/login');
    }
  }

  // ── ROUTES ──────────────────────────────────────────────────────────────────

  // Login page
  app.get('/login', (req, res) => {
    if (req.signedCookies.authenticated === 'true') {
      return res.redirect('/');
    }
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Zenitsu Live — Dashboard Login</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            background: radial-gradient(circle at center, #1b2035, #080a10);
            color: #ffffff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
          }
          .login-container {
            background: rgba(13, 16, 27, 0.75);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(0, 212, 255, 0.2);
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(0, 212, 255, 0.1);
            width: 100%;
            max-width: 380px;
            text-align: center;
          }
          .logo {
            font-size: 24px;
            font-weight: bold;
            letter-spacing: 2px;
            margin-bottom: 20px;
            background: linear-gradient(45deg, #00D4FF, #FFB7C5);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-transform: uppercase;
          }
          p {
            color: #8c9ba5;
            font-size: 14px;
            margin-bottom: 30px;
          }
          input[type="password"] {
            width: 100%;
            padding: 12px 16px;
            margin-bottom: 20px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #ffffff;
            font-size: 16px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s, box-shadow 0.3s;
          }
          input[type="password"]:focus {
            border-color: #00D4FF;
            box-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
          }
          button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(45deg, #00D4FF, #0088cc);
            border: none;
            border-radius: 8px;
            color: #ffffff;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: opacity 0.3s, transform 0.2s;
          }
          button:hover {
            opacity: 0.9;
          }
          button:active {
            transform: scale(0.98);
          }
          .error-msg {
            color: #ff4a4a;
            margin-bottom: 15px;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="logo">Zenitsu Live</div>
          <p>Enter the Administrator Passcode to access the control panel</p>
          <form method="POST" action="/login">
            ${req.query.error ? '<div class="error-msg">Incorrect passcode. Try again.</div>' : ''}
            <input type="password" name="passcode" placeholder="••••••••" required autofocus />
            <button type="submit">Verify & Access</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  // Handle Login Post
  app.post('/login', (req, res) => {
    const { passcode } = req.body;
    if (passcode === PASSCODE) {
      res.cookie('authenticated', 'true', { signed: true, maxAge: 24 * 60 * 60 * 1000 }); // 24 hours
      res.redirect('/');
    } else {
      res.redirect('/login?error=1');
    }
  });

  // Logout
  app.get('/logout', (req, res) => {
    res.clearCookie('authenticated');
    res.redirect('/login');
  });

  // Main Dashboard
  app.get('/', checkAuth, (req, res) => {
    const guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      icon: g.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
      ownerId: g.ownerId
    }));

    const totalMembers = guilds.reduce((acc, g) => acc + g.memberCount, 0);
    const uptime = Math.floor(client.uptime / 1000); // seconds
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    const guildRows = guilds.map(g => `
      <tr>
        <td>
          <div class="guild-info">
            <img src="${g.icon}" class="guild-icon" alt="" />
            <div>
              <div class="guild-name">${g.name}</div>
              <div class="guild-id">ID: ${g.id}</div>
            </div>
          </div>
        </td>
        <td>${g.memberCount} Members</td>
        <td><a href="/manage/${g.id}" class="btn-manage">Manage Server</a></td>
      </tr>
    `).join('');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Zenitsu Live — Control Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root {
            --bg: #080a10;
            --container-bg: rgba(13, 16, 27, 0.7);
            --border: rgba(0, 212, 255, 0.15);
            --cyan: #00D4FF;
            --pink: #FFB7C5;
            --text: #ffffff;
            --muted: #8c9ba5;
          }
          body {
            background-color: var(--bg);
            color: var(--text);
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px;
          }
          .dashboard {
            max-width: 1000px;
            margin: 0 auto;
          }
          header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
          }
          h1 {
            margin: 0;
            font-size: 28px;
            background: linear-gradient(45deg, var(--cyan), var(--pink));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          .btn-logout {
            padding: 8px 16px;
            background: rgba(255, 74, 74, 0.1);
            border: 1px solid #ff4a4a;
            border-radius: 6px;
            color: #ff4a4a;
            text-decoration: none;
            font-size: 14px;
            transition: background 0.3s;
          }
          .btn-logout:hover {
            background: #ff4a4a;
            color: white;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
          }
          .stat-card {
            background: var(--container-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          }
          .stat-val {
            font-size: 32px;
            font-weight: bold;
            color: var(--cyan);
            margin-bottom: 8px;
          }
          .stat-lbl {
            color: var(--muted);
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .section-title {
            font-size: 20px;
            margin-bottom: 20px;
            color: var(--pink);
            letter-spacing: 1px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            background: var(--container-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          }
          th, td {
            padding: 16px 20px;
            text-align: left;
          }
          th {
            background: rgba(255, 255, 255, 0.02);
            color: var(--muted);
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-bottom: 1px solid var(--border);
          }
          tr {
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
          }
          tr:last-child {
            border-bottom: none;
          }
          .guild-info {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          .guild-icon {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: 1px solid var(--border);
          }
          .guild-name {
            font-weight: bold;
            font-size: 16px;
          }
          .guild-id {
            font-size: 12px;
            color: var(--muted);
            margin-top: 2px;
          }
          .btn-manage {
            display: inline-block;
            padding: 8px 16px;
            background: var(--cyan);
            color: #000000;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            font-size: 13px;
            transition: opacity 0.3s, transform 0.1s;
          }
          .btn-manage:hover {
            opacity: 0.9;
          }
          .btn-manage:active {
            transform: scale(0.97);
          }
        </style>
      </head>
      <body>
        <div class="dashboard">
          <header>
            <h1>Zenitsu Live Control</h1>
            <a href="/logout" class="btn-logout">Logout</a>
          </header>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-val">${guilds.length}</div>
              <div class="stat-lbl">Active Servers</div>
            </div>
            <div class="stat-card">
              <div class="stat-val">${totalMembers}</div>
              <div class="stat-lbl">Total Members Served</div>
            </div>
            <div class="stat-card">
              <div class="stat-val">${hrs}h ${mins}m</div>
              <div class="stat-lbl">Bot Uptime</div>
            </div>
          </div>

          <div class="section-title">Active Server Connections</div>
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Users</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${guildRows || '<tr><td colspan="3" style="text-align: center; color: var(--muted);">The bot is not currently in any servers.</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `);
  });

  // Manage Guild Page
  app.get('/manage/:guildId', checkAuth, async (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).send('<h1>Server not found.</h1><a href="/">Back to Home</a>');
    }

    // Fetch channels & roles
    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});

    const textChannels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText)
      .map(c => ({ id: c.id, name: c.name }));

    const textChannelOptions = textChannels.map(c => `
      <option value="${c.id}"># ${c.name}</option>
    `).join('');

    const rolesList = guild.roles.cache
      .sort((a,b) => b.position - a.position)
      .map(r => `
        <span class="tag-role" style="border: 1px solid ${r.hexColor}; color: ${r.hexColor === '#000000' ? '#ffffff' : r.hexColor}">
          ${r.name}
        </span>
      `).join('');

    const guildIcon = guild.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png';

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Manage: ${guild.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root {
            --bg: #080a10;
            --container-bg: rgba(13, 16, 27, 0.7);
            --border: rgba(0, 212, 255, 0.15);
            --cyan: #00D4FF;
            --pink: #FFB7C5;
            --text: #ffffff;
            --muted: #8c9ba5;
            --green: #2ecc71;
          }
          body {
            background-color: var(--bg);
            color: var(--text);
            font-family: 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
          }
          header {
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 30px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
          }
          .back-link {
            text-decoration: none;
            color: var(--cyan);
            font-weight: bold;
            font-size: 15px;
          }
          .server-title-group {
            display: flex;
            align-items: center;
            gap: 15px;
            flex-grow: 1;
          }
          .server-icon {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            border: 1px solid var(--border);
          }
          h2 {
            margin: 0;
            font-size: 24px;
          }
          .server-meta {
            font-size: 13px;
            color: var(--muted);
            margin-top: 4px;
          }
          .grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 30px;
          }
          @media (min-width: 768px) {
            .grid {
              grid-template-columns: 1fr 1fr;
            }
          }
          .card {
            background: var(--container-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          }
          .card-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            color: var(--pink);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 10px;
          }
          .form-group {
            margin-bottom: 18px;
          }
          label {
            display: block;
            margin-bottom: 8px;
            font-size: 13px;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          input[type="text"], select, textarea {
            width: 100%;
            padding: 10px 14px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #ffffff;
            font-size: 15px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s;
          }
          input[type="text"]:focus, select:focus, textarea:focus {
            border-color: var(--cyan);
          }
          textarea {
            resize: vertical;
            min-height: 100px;
          }
          .btn-submit {
            padding: 10px 20px;
            background: var(--cyan);
            color: #000000;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            transition: opacity 0.3s;
          }
          .btn-submit:hover {
            opacity: 0.9;
          }
          .tag-role {
            display: inline-block;
            padding: 4px 10px;
            margin: 4px 3px;
            border-radius: 20px;
            font-size: 12px;
            background: rgba(255, 255, 255, 0.03);
          }
          .success-banner {
            background: rgba(46, 204, 113, 0.15);
            border: 1px solid var(--green);
            color: var(--green);
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 25px;
            font-size: 14px;
            text-align: center;
          }
          .config-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255,255,255,0.03);
          }
          .config-row:last-child {
            border-bottom: none;
          }
          .config-label {
            font-weight: bold;
            font-size: 14px;
          }
          .config-desc {
            font-size: 12px;
            color: var(--muted);
            margin-top: 2px;
          }
          .toggle-btn {
            padding: 6px 14px;
            background: rgba(0, 212, 255, 0.1);
            border: 1px solid var(--cyan);
            border-radius: 6px;
            color: var(--cyan);
            font-weight: bold;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.3s;
          }
          .toggle-btn.active {
            background: var(--cyan);
            color: #000000;
          }
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
            
            <!-- BROADCAST MODULE -->
            <div class="card">
              <div class="card-title">📣 Bot Broadcast Console</div>
              <form method="POST" action="/manage/${guild.id}/broadcast">
                <div class="form-group">
                  <label>Target Channel</label>
                  <select name="channelId" required>
                    ${textChannelOptions || '<option disabled>No text channels found</option>'}
                  </select>
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

            <!-- SECURITY / CONFIG CARD -->
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
            </div>

            <!-- ROLES VISUALIZER -->
            <div class="card" style="grid-column: span 1; @media(min-width: 768px) { grid-column: span 2; }">
              <div class="card-title">🎭 Server Role Hierarchy</div>
              <div>
                ${rolesList || '<span style="color: var(--muted)">No roles found.</span>'}
              </div>
            </div>

          </div>
        </div>
      </body>
      </html>
    `);
  });

  // Handle Broadcast Submission
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

  // Handle AutoMod Toggle
  app.post('/manage/:guildId/toggle-automod', checkAuth, (req, res) => {
    const { guildId } = req.params;
    db.protectmeActive = !db.protectmeActive;
    saveDb();
    res.redirect(`/manage/${guildId}?updated=1`);
  });

  // ── START THE WEB APP ────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`🌐 Dashboard running on port ${PORT}`);
  });
}

module.exports = { startDashboardServer };
