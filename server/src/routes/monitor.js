const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { parseMonitorOutput } = require('../utils/sshParser');

// 只读命令集合（硬性约束 8.1：冒烟测试只执行只读命令）
const MONITOR_CMD = [
  "echo '===CPU==='; top -bn1 | head -3",
  "echo '===MEM==='; free -m",
  "echo '===DISK==='; df -h -x tmpfs -x devtmpfs -x overlay",
  "echo '===UPTIME==='; uptime",
  "echo '===NET==='; cat /proc/net/dev",
  "echo '===SYS==='; uname -r; head -2 /etc/os-release",
].join('; ');

function createMonitorRouter({ config, pool, store }) {
  const router = express.Router();
  const lastNet = new Map(); // serverId -> { rxBytes, txBytes, at }

  router.get('/servers/:id/monitor', async (req, res) => {
    const server = store.read().find((s) => s.id === req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    let password;
    try {
      password = decrypt(server.passwordEnc, config.masterKey);
    } catch {
      return res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
    }
    const cfg = { host: server.host, port: server.port, username: server.username, password };
    try {
      const result = await pool.run(cfg, MONITOR_CMD, { timeoutMs: 20000 });
      if (result.code !== 0) throw new Error(`命令退出码 ${result.code}: ${result.stderr.slice(0, 200)}`);
      const raw = parseMonitorOutput(result.stdout);

      const now = Date.now();
      const prev = lastNet.get(server.id);
      let rxRate = 0;
      let txRate = 0;
      if (prev && now > prev.at) {
        rxRate = Math.max(0, Math.round((raw.net.rxBytes - prev.rxBytes) / ((now - prev.at) / 1000)));
        txRate = Math.max(0, Math.round((raw.net.txBytes - prev.txBytes) / ((now - prev.at) / 1000)));
      }
      lastNet.set(server.id, { rxBytes: raw.net.rxBytes, txBytes: raw.net.txBytes, at: now });

      res.json({
        code: 0,
        data: { ...raw, net: { rxBytes: raw.net.rxBytes, txBytes: raw.net.txBytes, rxRate, txRate } },
      });
    } catch (err) {
      res.status(502).json({ code: 502, message: `监控获取失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createMonitorRouter;
