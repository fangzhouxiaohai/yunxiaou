const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

// 软件清单：name 同时是命令名（统一白名单，杜绝任意命令注入）
const SOFTWARE = [
  { name: 'nginx', display: 'Nginx', desc: 'Web 服务器/反向代理', versionCmd: 'nginx -v 2>&1', pkg: { apt: 'nginx', yum: 'nginx' } },
  { name: 'mysql', display: 'MySQL/MariaDB', desc: '关系型数据库', versionCmd: 'mysql --version', pkg: { apt: 'mysql-server', yum: 'mysql-server' } },
  { name: 'redis', display: 'Redis', desc: '内存键值数据库', versionCmd: 'redis-server --version', pkg: { apt: 'redis-server', yum: 'redis' } },
  { name: 'docker', display: 'Docker', desc: '容器引擎', versionCmd: 'docker --version', pkg: { apt: 'docker.io', yum: 'docker-ce' } },
  { name: 'node', display: 'Node.js', desc: 'JavaScript 运行时', versionCmd: 'node -v', pkg: { apt: 'nodejs', yum: 'nodejs' } },
  { name: 'python3', display: 'Python 3', desc: '脚本语言运行时', versionCmd: 'python3 --version', pkg: { apt: 'python3', yum: 'python3' } },
  { name: 'git', display: 'Git', desc: '版本控制', versionCmd: 'git --version', pkg: { apt: 'git', yum: 'git' } },
  { name: 'fail2ban', display: 'Fail2ban', desc: '暴力破解防护', versionCmd: 'fail2ban-server --version 2>&1', pkg: { apt: 'fail2ban', yum: 'fail2ban' } },
];

function createStoreRouter({ config, pool, store }) {
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

  // 检测包管理器：优先 apt-get（Debian/Ubuntu），否则 yum（RHEL 系）
  async function detectPkgManager(cfg) {
    const r = await pool.run(cfg, 'command -v apt-get >/dev/null 2>&1 && echo apt || echo yum');
    return r.stdout.trim() === 'apt' ? 'apt' : 'yum';
  }

  router.get('/servers/:id/store', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const items = [];
      for (const soft of SOFTWARE) {
        const version = await pool.run(cfg, soft.versionCmd);
        const installed = version.code === 0 && version.stdout.trim() !== '';
        items.push({
          name: soft.name,
          display: soft.display,
          desc: soft.desc,
          installed,
          version: installed ? version.stdout.trim().split('\n')[0] : '',
          package: soft.pkg[pkg],
        });
      }
      res.json({ code: 0, data: items });
    } catch (err) {
      res.status(502).json({ code: 502, message: `软件状态检测失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/store/:name/install', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const soft = SOFTWARE.find((s) => s.name === req.params.name);
    if (!soft) return res.status(400).json({ code: 400, message: '未知软件' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const installCmd = pkg === 'apt'
        ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${soft.pkg.apt}`
        : `yum install -y ${soft.pkg.yum}`;
      const result = await pool.run(cfg, installCmd, { timeoutMs: 600000 });
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 300) || `退出码 ${result.code}`);
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: soft.name, result: 'success' });
      res.json({ code: 0, data: { installed: soft.name, package: soft.pkg[pkg] } });
    } catch (err) {
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: soft.name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `安装失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createStoreRouter;
