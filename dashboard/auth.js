// Dashboard authentication: OAuth2 + passcode fallback.
// Exports a factory that registers auth routes and returns { checkAuth } middleware.

function setupAuth(app, ctx) {
  const { client, PASSCODE, dashboardEnabled, isProduction } = ctx;

  function checkAuth(req, res, next) {
    if (!dashboardEnabled) {
      return res.status(200).send('Zenitsu Live Bot is running.');
    }

    if (process.env.CLIENT_SECRET) {
      const user = req.signedCookies.authenticated_user;
      if (!user) {
        return res.redirect('/login');
      }

      const PermissionEngine = client.runtime?.getService('PermissionEngine');
      const isDeveloper = PermissionEngine ? PermissionEngine.isDeveloper(user.id) : false;
      if (isDeveloper) {
        return next();
      }

      const guildId = req.params.guildId || req.body.guildId;
      if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          return res.status(404).send('<h1>Server not found.</h1><a href="/">Back to Home</a>');
        }

        const userGuild = user.guilds.find(ug => ug.id === guildId);
        if (!userGuild) {
          return res.status(403).send('<h1>Access Denied: You are not in this server.</h1><a href="/">Back to Home</a>');
        }

        const isOwner = userGuild.owner;
        const hasManageGuild = (BigInt(userGuild.permissions) & 0x20n) === 0x20n;
        const hasAdmin = (BigInt(userGuild.permissions) & 0x8n) === 0x8n;

        if (isOwner || hasManageGuild || hasAdmin) {
          return next();
        }
        return res.status(403).send('<h1>Access Denied: You must have Manage Server or Administrator permissions to manage this server.</h1><a href="/">Back to Home</a>');
      }
      return next();
    }

    // Passcode fallback
    if (req.signedCookies.authenticated === 'true') {
      return next();
    }
    return res.redirect('/login');
  }

  app.get('/login', (req, res) => {
    if (!dashboardEnabled) {
      return res.status(503).send('Dashboard disabled.');
    }
    if (process.env.CLIENT_SECRET) {
      if (req.signedCookies.authenticated_user) {
        return res.redirect('/');
      }
      const redirectUri = process.env.REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/callback`;
      const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;
      return res.redirect(oauthUrl);
    }
    if (req.signedCookies.authenticated === 'true') {
      return res.redirect('/');
    }
    res.send(renderLoginPage(req.query.error));
  });

  app.post('/login', (req, res) => {
    if (!dashboardEnabled) {
      return res.status(503).send('Dashboard disabled.');
    }
    const { passcode } = req.body;
    if (passcode === PASSCODE) {
      res.cookie('authenticated', 'true', {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000,
      });
      res.redirect('/');
    } else {
      res.redirect('/login?error=1');
    }
  });

  app.get('/logout', (req, res) => {
    res.clearCookie('authenticated');
    res.clearCookie('authenticated_user');
    res.redirect('/login');
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.redirect('/login?error=1');
    }

    const redirectUri = process.env.REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/callback`;

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.user.id,
          client_secret: process.env.CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) {
        throw new Error('Failed to retrieve access token.');
      }

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const user = await userRes.json();

      const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const guilds = await guildsRes.json();

      if (!Array.isArray(guilds)) {
        throw new Error('Guilds response is not an array.');
      }

      res.cookie('authenticated_user', {
        id: user.id,
        username: `${user.username}#${user.discriminator || '0'}`,
        guilds: guilds.map(g => ({
          id: g.id,
          owner: g.owner,
          permissions: g.permissions
        }))
      }, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000
      });

      res.redirect('/');
    } catch (err) {
      const log = client.runtime?.logger;
      if (log) log.error('OAuth2 login failed', { error: err.message });
      else console.error('[OAuth2 Login Error]:', err.message);
      res.redirect('/login?error=1');
    }
  });

  return { checkAuth };
}

function renderLoginPage(hasError) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Zenitsu Live — Dashboard Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { background: radial-gradient(circle at center, #1b2035, #080a10); color: #fff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; overflow: hidden; }
    .login-container { background: rgba(13, 16, 27, 0.75); backdrop-filter: blur(15px); border: 1px solid rgba(0, 212, 255, 0.2); padding: 40px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(0, 212, 255, 0.1); width: 100%; max-width: 380px; text-align: center; }
    .logo { font-size: 24px; font-weight: bold; letter-spacing: 2px; margin-bottom: 20px; background: linear-gradient(45deg, #00D4FF, #FFB7C5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-transform: uppercase; }
    p { color: #8c9ba5; font-size: 14px; margin-bottom: 30px; }
    input[type="password"] { width: 100%; padding: 12px 16px; margin-bottom: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 16px; box-sizing: border-box; outline: none; transition: border-color .3s, box-shadow .3s; }
    input[type="password"]:focus { border-color: #00D4FF; box-shadow: 0 0 8px rgba(0,212,255,.3); }
    button { width: 100%; padding: 14px; background: linear-gradient(45deg, #00D4FF, #0088cc); border: none; border-radius: 8px; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; transition: opacity .3s, transform .2s; }
    button:hover { opacity: .9; }
    button:active { transform: scale(.98); }
    .error-msg { color: #ff4a4a; margin-bottom: 15px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">Zenitsu Live</div>
    <p>Enter the Administrator Passcode to access the control panel</p>
    <form method="POST" action="/login">
      ${hasError ? '<div class="error-msg">Incorrect passcode. Try again.</div>' : ''}
      <input type="password" name="passcode" placeholder="••••••••" required autofocus />
      <button type="submit">Verify & Access</button>
    </form>
  </div>
</body>
</html>`;
}

module.exports = { setupAuth };
