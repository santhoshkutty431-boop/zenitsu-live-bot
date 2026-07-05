// Dashboard entrypoint. Delegates to per-concern modules under ./dashboard/.
//   auth.js   → /login, /logout, /api/auth/callback, checkAuth middleware
//   health.js → /health JSON status endpoint
//   home.js   → / server list + health scorecard
//   manage.js → /manage/:guildId page + POST actions (broadcast, kick, ban, etc)

const express = require('express');
const cookieParser = require('cookie-parser');
const { setupAuth } = require('./dashboard/auth');
const { setupHealth } = require('./dashboard/health');
const { setupHome } = require('./dashboard/home');
const { setupManage } = require('./dashboard/manage');

function startDashboardServer(client, db, saveDb) {
  const app = express();
  const PORT = process.env.PORT || 8080;

  const PASSCODE = process.env.DASHBOARD_PASSCODE;
  const COOKIE_SECRET = process.env.DASHBOARD_COOKIE_SECRET || process.env.DASHBOARD_PASSCODE;
  const isProduction = process.env.NODE_ENV === 'production';
  const dashboardEnabled = Boolean(PASSCODE && COOKIE_SECRET);

  const log = client.runtime?.logger || console;

  if (!PASSCODE) {
    log.warn('Dashboard disabled: DASHBOARD_PASSCODE is not set.');
  }
  if (!COOKIE_SECRET) {
    log.warn('Dashboard disabled: DASHBOARD_COOKIE_SECRET or DASHBOARD_PASSCODE is required.');
  }
  if (PASSCODE && PASSCODE.length < 12) {
    log.warn('DASHBOARD_PASSCODE should be at least 12 characters long.');
  }

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser(COOKIE_SECRET));

  // Middleware to bind guildId in asyncLocalStorage for all /manage/:guildId routes
  app.use((req, res, next) => {
    const match = req.url.match(/^\/manage\/(\d+)/);
    const guildId = match ? match[1] : null;
    if (guildId && global.asyncLocalStorage) {
      return global.asyncLocalStorage.run({ guildId }, () => {
        next();
      });
    }
    next();
  });

  // Auth: registers /login, /logout, /api/auth/callback and returns middleware.
  const { checkAuth } = setupAuth(app, { client, PASSCODE, dashboardEnabled, isProduction });

  // Health probe: always available, unauthenticated.
  setupHealth(app, { client, dashboardEnabled });

  // Home + per-guild management pages: gated behind checkAuth.
  setupHome(app, { client, db, checkAuth, dashboardEnabled });
  setupManage(app, { client, db, saveDb, checkAuth });

  app.listen(PORT, () => {
    log.info(`Dashboard running on port ${PORT}`);
  });
}

module.exports = { startDashboardServer };
