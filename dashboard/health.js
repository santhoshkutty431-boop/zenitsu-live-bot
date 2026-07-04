// Dashboard health endpoint: returns JSON with WebSocket + DB status.
// Used by Koyeb/Render/Uptime Robot as a liveness probe.

function setupHealth(app, ctx) {
  const { client, dashboardEnabled } = ctx;

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
