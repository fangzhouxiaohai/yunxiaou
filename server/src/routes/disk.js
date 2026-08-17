const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { parseLsblk, parseDf } = require('../utils/dbParser');
const { audit } = require('../utils/audit');

const DEVICE_RE = /^\/dev\/[a-zA-Z0-9_/.-]{1,100}$/;
const MOUNT_RE = /^\/[a-zA-Z0-9_/.-]{1,200}$/;
// 禁止挂载到系统关键路径
const PROTECTED_MOUNTS = ['/', '/etc', '/var', '/usr', '/boot', '/home', '/root', '/tmp', '/dev', '/proc', '/sys', '/run', '/opt', '/srv'];

function createDiskRouter({ config, pool, store }) {
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

  router.get('/servers/:id/disk', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const [lsblk, df] = await Promise.all([
        pool.run(cfg, 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT'),
        pool.run(cfg, 'df -h -x tmpfs -x devtmpfs'),
      ]);
      res.json({
        code: 0,
        data: {
          disks: lsblk.code === 0 ? parseLsblk(lsblk.stdout) : [],
          mounts: df.code === 0 ? parseDf(df.stdout) : [],
        },
      });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取磁盘信息失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/disk/mount', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { device, mountPoint } = req.body || {};
    if (!device || !DEVICE_RE.test(device)) return res.status(400).json({ code: 400, message: '设备路径不合法' });
    if (!mountPoint || !MOUNT_RE.test(mountPoint)) return res.status(400).json({ code: 400, message: '挂载点路径不合法' });
    if (PROTECTED_MOUNTS.includes(mountPoint) || PROTECTED_MOUNTS.some((p) => mountPoint.startsWith(`${p}/`))) {
      return res.status(400).json({ code: 400, message: '禁止挂载到系统关键路径' });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const cmd = `mkdir -p ${mountPoint} && mount ${device} ${mountPoint}`;
      const r = await pool.run(cfg, cmd, { timeoutMs: 30000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'disk.mount', target: server.host, detail: `${device} -> ${mountPoint}`, result: 'success' });
      res.json({ code: 0, data: { mounted: `${device} -> ${mountPoint}` } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `挂载失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/disk/umount', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const mountPoint = req.body?.mountPoint;
    if (!mountPoint || !MOUNT_RE.test(mountPoint)) return res.status(400).json({ code: 400, message: '挂载点路径不合法' });
    if (PROTECTED_MOUNTS.includes(mountPoint)) return res.status(400).json({ code: 400, message: '禁止卸载系统关键路径' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `umount ${mountPoint}`, { timeoutMs: 30000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'disk.umount', target: server.host, detail: mountPoint, result: 'success' });
      res.json({ code: 0, data: { unmounted: mountPoint } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `卸载失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createDiskRouter;
