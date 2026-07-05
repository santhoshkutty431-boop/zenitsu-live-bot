// Dashboard home page: server list, health scores, and live stats.

function setupHome(app, ctx) {
  const { client, db, checkAuth, dashboardEnabled } = ctx;

  // Public gate: unauthenticated / users just get a plain "bot is running" text.
  app.get('/', (req, res, next) => {
    if (!dashboardEnabled) {
      return res.status(200).send('Zenitsu Live Bot is running.');
    }
    next();
  });

  // Main authenticated dashboard.
  app.get('/', checkAuth, (req, res) => {
    let guilds = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      icon: g.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
      ownerId: g.ownerId
    }));

    // OAuth mode: restrict server list to guilds the user actually manages.
    if (process.env.CLIENT_SECRET) {
      const user = req.signedCookies.authenticated_user;
      if (user) {
        const PermissionEngine = client.runtime.getService('PermissionEngine');
        const isDeveloper = PermissionEngine ? PermissionEngine.isDeveloper(user.id) : false;
        if (!isDeveloper) {
          guilds = guilds.filter(g => {
            const userGuild = user.guilds.find(ug => ug.id === g.id);
            if (!userGuild) return false;
            const isOwner = userGuild.owner;
            const hasManageGuild = (BigInt(userGuild.permissions) & 0x20n) === 0x20n;
            const hasAdmin = (BigInt(userGuild.permissions) & 0x8n) === 0x8n;
            return isOwner || hasManageGuild || hasAdmin;
          });
        }
      }
    }

    const totalMembers = guilds.reduce((acc, g) => acc + g.memberCount, 0);
    const uptime = Math.floor(client.uptime / 1000);
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    const analytics = client.runtime.getService('AnalyticsManager');
    const stats = analytics ? analytics.getStats() : { joins: 0, ticketsOpened: 0, spamBlocked: 0, commands: {} };

    // Health scores use GUILD-scoped keys. Express routes run outside the
    // Discord-event AsyncLocalStorage context, so reading them through the
    // `db` proxy here would silently hit global config (always defaults).
    // Resolve the main guild's db explicitly instead.
    const mainGuildId = process.env.GUILD_ID || client.guilds.cache.first()?.id;
    let gdb = {};
    try {
      const dbMgr = client.runtime?.getService('DatabaseManager');
      if (dbMgr && mainGuildId) gdb = dbMgr.getGuildDb(mainGuildId);
    } catch { /* fall back to defaults below */ }

    const securityScore = gdb.protectmeActive ? 95 : 60;
    const configScore = db.serverWhitelist && db.serverWhitelist.length > 0 ? 97 : 70; // global-only key: proxy routes correctly
    const ticketScore = gdb.activeTickets && Object.keys(gdb.activeTickets).length > 0 ? 92 : 80;
    const modScore = gdb.cases && gdb.cases.length > 0 ? 88 : 75;
    const performanceScore = 90;
    const overallScore = Math.round((securityScore + configScore + ticketScore + modScore + performanceScore) / 5);

    const memUsage = process.memoryUsage();
    const ramMb = Math.round(memUsage.heapUsed / 1024 / 1024);

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

    res.send(renderHome({
      guilds, guildRows, totalMembers, hrs, mins, stats,
      overallScore, securityScore, modScore, ticketScore, configScore, ramMb
    }));
  });
}

function renderHome(vars) {
  const { guilds, guildRows, totalMembers, hrs, mins, stats,
          overallScore, securityScore, modScore, ticketScore, configScore, ramMb } = vars;

  return `<!DOCTYPE html>
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
    body { background-color: var(--bg); color: var(--text); font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; }
    .dashboard { max-width: 1000px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    h1 { margin: 0; font-size: 28px; background: linear-gradient(45deg, var(--cyan), var(--pink)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-transform: uppercase; letter-spacing: 2px; }
    .btn-logout { padding: 8px 16px; background: rgba(255, 74, 74, 0.1); border: 1px solid #ff4a4a; border-radius: 6px; color: #ff4a4a; text-decoration: none; font-size: 14px; transition: background 0.3s; }
    .btn-logout:hover { background: #ff4a4a; color: white; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .stat-card { background: var(--container-bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .stat-val { font-size: 32px; font-weight: bold; color: var(--cyan); margin-bottom: 8px; }
    .stat-lbl { color: var(--muted); font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
    .section-title { font-size: 20px; margin-bottom: 20px; color: var(--pink); letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; background: var(--container-bg); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    th, td { padding: 16px 20px; text-align: left; }
    th { background: rgba(255, 255, 255, 0.02); color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border); }
    tr { border-bottom: 1px solid rgba(255, 255, 255, 0.03); }
    tr:last-child { border-bottom: none; }
    .guild-info { display: flex; align-items: center; gap: 15px; }
    .guild-icon { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border); }
    .guild-name { font-weight: bold; font-size: 16px; }
    .guild-id { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .btn-manage { display: inline-block; padding: 8px 16px; background: var(--cyan); color: #000000; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 13px; transition: opacity 0.3s, transform 0.1s; }
    .btn-manage:hover { opacity: 0.9; }
    .btn-manage:active { transform: scale(0.97); }
  </style>
</head>
<body>
  <div class="dashboard">
    <header>
      <h1>Zenitsu Live Control</h1>
      <a href="/logout" class="btn-logout">Logout</a>
    </header>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val">${guilds.length}</div><div class="stat-lbl">Active Servers</div></div>
      <div class="stat-card"><div class="stat-val">${totalMembers}</div><div class="stat-lbl">Total Members Served</div></div>
      <div class="stat-card"><div class="stat-val">${hrs}h ${mins}m</div><div class="stat-lbl">Bot Uptime</div></div>
    </div>

    <div class="section-title">📊 Server Health Dashboard</div>
    <div class="health-container" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 45px;">
      <div class="health-card-main" style="flex: 1; min-width: 250px; background: rgba(0, 212, 255, 0.05); border: 2px solid var(--cyan); border-radius: 12px; padding: 24px; text-align: center; box-shadow: 0 4px 20px rgba(0,212,255,0.1);">
        <div style="font-size: 64px; font-weight: bold; color: var(--cyan); line-height: 1;">${overallScore}<span style="font-size: 24px; color: var(--muted);">/100</span></div>
        <div style="margin-top: 10px; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: var(--text);">Overall Server Health</div>
      </div>
      <div class="health-breakdown" style="flex: 2; min-width: 300px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
        <div style="background: var(--container-bg); border: 1px solid var(--border); padding: 15px; border-radius: 8px;">
          <div style="font-size: 13px; color: var(--muted); text-transform: uppercase;">🛡️ Security</div>
          <div style="font-size: 20px; font-weight: bold; color: #2ECC71; margin-top: 5px;">${securityScore}%</div>
        </div>
        <div style="background: var(--container-bg); border: 1px solid var(--border); padding: 15px; border-radius: 8px;">
          <div style="font-size: 13px; color: var(--muted); text-transform: uppercase;">👮 Moderation</div>
          <div style="font-size: 20px; font-weight: bold; color: #E67E22; margin-top: 5px;">${modScore}%</div>
        </div>
        <div style="background: var(--container-bg); border: 1px solid var(--border); padding: 15px; border-radius: 8px;">
          <div style="font-size: 13px; color: var(--muted); text-transform: uppercase;">🎫 Tickets</div>
          <div style="font-size: 20px; font-weight: bold; color: #9B59B6; margin-top: 5px;">${ticketScore}%</div>
        </div>
        <div style="background: var(--container-bg); border: 1px solid var(--border); padding: 15px; border-radius: 8px;">
          <div style="font-size: 13px; color: var(--muted); text-transform: uppercase;">⚙️ Configuration</div>
          <div style="font-size: 20px; font-weight: bold; color: var(--cyan); margin-top: 5px;">${configScore}%</div>
        </div>
      </div>
    </div>

    <div class="section-title">⚡ Live Security & AI Metrics</div>
    <div class="stats-grid" style="margin-bottom: 45px;">
      <div class="stat-card"><div class="stat-val">${stats.joins}</div><div class="stat-lbl">Server Joins</div></div>
      <div class="stat-card"><div class="stat-val">${stats.ticketsOpened}</div><div class="stat-lbl">Tickets Opened</div></div>
      <div class="stat-card"><div class="stat-val">${stats.spamBlocked}</div><div class="stat-lbl">Spam Attacks Blocked</div></div>
      <div class="stat-card"><div class="stat-val">${ramMb} MB</div><div class="stat-lbl">RAM Usage</div></div>
    </div>

    <div class="section-title">Active Server Connections</div>
    <table>
      <thead><tr><th>Server</th><th>Users</th><th>Action</th></tr></thead>
      <tbody>
        ${guildRows || '<tr><td colspan="3" style="text-align: center; color: var(--muted);">The bot is not currently in any servers.</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

module.exports = { setupHome };
