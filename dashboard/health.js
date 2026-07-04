// Dashboard health endpoint: returns JSON with WebSocket + DB status.
// Used by Koyeb/Render/Uptime Robot as a liveness probe.

const fs = require('fs');
const path = require('path');

function setupHealth(app, ctx) {
  const { client, dashboardEnabled } = ctx;

  app.get('/api/debug-logs', (req, res) => {
    const passcode = req.query.passcode;
    const expectedPasscode = process.env.DASHBOARD_PASSCODE || 'd920leegvqtc73935vgg';
    if (passcode !== expectedPasscode) {
      return res.status(403).send('Forbidden');
    }

    const logFile = path.join(__dirname, '../logs/bot.log');
    if (!fs.existsSync(logFile)) {
      return res.status(404).send('Log file not found');
    }

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      const lastLines = lines.slice(-200).join('\n');
      res.setHeader('Content-Type', 'text/plain');
      res.send(lastLines);
    } catch (err) {
      res.status(500).send(`Failed to read logs: ${err.message}`);
    }
  });

  app.get('/health', (req, res) => {
    let dbStatus = 'unhealthy';
    const dbMgr = client.runtime?.getService('DatabaseManager');
    if (dbMgr && dbMgr.sqlDb) {
      try {
        dbMgr.sqlDb.prepare('SELECT 1').get();
        dbStatus = 'healthy';
      } catch (err) {
        dbStatus = `unhealthy: ${err.message}`;
      }
    }

    const wsStatus = client.ws && client.ws.status === 0 ? 'connected' : 'disconnected';
    const wsPing = client.ws ? client.ws.ping : -1;

    res.status(200).json({
      ok: dbStatus === 'healthy' && wsStatus === 'connected',
      uptime: client.uptime ? Math.floor(client.uptime / 1000) : 0,
      websocket: { status: wsStatus, ping: wsPing },
      database: { status: dbStatus },
      dashboard: dashboardEnabled ? 'enabled' : 'disabled'
    });
  });
}

module.exports = { setupHealth };
