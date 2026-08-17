const express = require('express');
const { decrypt } = require('../crypto/cipher');

const LOG_PATHS = [
  '/var/log/nginx/error.log',
  '/var/log/nginx/access.log',
  '/var/log/mysql/error.log',
  '/var/log/php-fpm/error.log',
  '/var/log/messages',
  '/var/log/secure',
  '/var/log/auth.log',
  '/var/log/syslog',
];

// 只允许 /var/log 下与 linuxmgr 临时目录的日志路径
const LOG_PATH_RE = /^(\/var\/log\/[a-zA-Z0-9_/.-]+|\/tmp\/linuxmgr-[a-zA-Z0-9_/.-]+)$/;

const SCAN_CMD = `for f in ${LOG_PATHS.join(' ')}; do if [ -f "$f" ]; then echo "$f|1|$(stat -c%s "$f" 2>/dev/null)"; else echo "$f|0|0"; fi; done`;

function createLogsRouter({ config, pool, store }) {
  const router = express.Router();

  const findServer = (id) => store.read().find((s) => s.id === id);
  const sshCfg = (server, res) => {
    try {
      return {
        host: server.host, port: server.port, username: server.username,
        password: decrypt(server.passwordEnc, config.masterKey),
      };
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return null;
    }
  };

  router.get('/servers/:id/logs/files', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, SCAN_CMD);
      const files = LOG_PATHS.map((path) => {
        const match = r.stdout.split('\n').find((l) => l.startsWith(`${path}|`));
        if (match) {
          const [, exists, size] = match.split('|');
          return { path, exists: exists === '1', size: parseInt(size, 10) || 0 };
        }
        return { path, exists: false, size: 0 };
      });
      res.json({ code: 0, data: files });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取日志文件列表失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/logs/read', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const logPath = String(req.query.path || '');
    if (!LOG_PATH_RE.test(logPath)) return res.status(400).json({ code: 400, message: '日志路径不合法（仅允许 /var/log 下）' });
    const lines = Math.min(1000, Math.max(1, parseInt(req.query.lines || '200', 10) || 200));
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `tail -n ${lines} ${logPath}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      res.json({ code: 0, data: r.stdout });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取日志失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createLogsRouter;
