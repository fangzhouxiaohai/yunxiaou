require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { loadConfig } = require('./config');
const { requireAuth } = require('./auth/middleware');
const { JsonStore } = require('./store/jsonStore');
const { ConnectionPool } = require('./ssh/connectionPool');
const createAuthRouter = require('./routes/auth');
const createServersRouter = require('./routes/servers');
const createMonitorRouter = require('./routes/monitor');
const createDatabaseRouter = require('./routes/database');

function createApp({ config, pool, stores }) {
  const app = express();
  app.use(express.json());

  app.use('/api/auth', createAuthRouter({ config }));
  app.use('/api', requireAuth(config), createMonitorRouter({ config, pool, store: stores.servers }));
  app.use('/api', requireAuth(config), createDatabaseRouter({ config, pool, store: stores.servers }));
  app.use('/api/servers', requireAuth(config), createServersRouter({ config, pool, store: stores.servers }));

  const webDist = path.join(__dirname, '..', '..', 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', (req, res) => res.status(404).json({ code: 404, message: '接口不存在' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
  });

  return app;
}

function start() {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.warn('[warn]', w);
  const pool = new ConnectionPool({});
  const stores = {
    servers: new JsonStore(config.dataDir, 'servers.json', []),
  };
  const app = createApp({ config, pool, stores });
  app.listen(config.port, () => console.log(`linuxmgr server listening on http://localhost:${config.port}`));
  return app;
}

if (require.main === module) start();

module.exports = { createApp, start };
