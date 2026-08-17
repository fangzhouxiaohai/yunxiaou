const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const DOMAIN_RE = /^[a-zA-Z0-9.-]{1,100}$/;
const SSL_DIR = '/etc/nginx/ssl';

function createSslRouter({ config, pool, store }) {
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

  function parseCertInfo(output) {
    const info = {};
    for (const line of output.split('\n')) {
      const m = line.match(/^(subject|notBefore|notAfter|issuer)=(.*)$/);
      if (m) info[m[1]] = m[2].trim();
    }
    return info;
  }

  router.get('/servers/:id/ssl', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const ls = await pool.run(cfg, `ls ${SSL_DIR}/linuxmgr-*.crt 2>/dev/null`);
      const crts = (ls.stdout || '').split('\n').filter((l) => l.trim());
      const items = [];
      for (const crt of crts) {
        const domain = crt.split('/').pop().replace(/^linuxmgr-/, '').replace(/\.crt$/, '');
        const info = await pool.run(cfg, `openssl x509 -in ${crt} -noout -subject -dates -issuer`);
        items.push({ domain, crt, ...(info.code === 0 ? parseCertInfo(info.stdout) : {}) });
      }
      res.json({ code: 0, data: items });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取证书列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/ssl/upload', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const domain = String(req.body?.domain || '');
    const cert = String(req.body?.cert || '');
    const key = String(req.body?.key || '');
    if (!DOMAIN_RE.test(domain)) return res.status(400).json({ code: 400, message: '域名不合法' });
    if (!/^-----BEGIN CERTIFICATE-----/.test(cert.trim())) return res.status(400).json({ code: 400, message: '证书不是 PEM 格式' });
    if (!/^-----BEGIN (RSA |EC |)PRIVATE KEY-----/.test(key.trim())) return res.status(400).json({ code: 400, message: '私钥不是 PEM 格式' });
    if (cert.length > 64 * 1024 || key.length > 64 * 1024) return res.status(400).json({ code: 400, message: '证书/私钥过大（最大 64KB）' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const cmds = [
        `mkdir -p ${SSL_DIR}`,
        `cat > ${SSL_DIR}/linuxmgr-${domain}.crt <<'LINUXMGR_EOF'\n${cert.trim()}\nLINUXMGR_EOF`,
        `cat > ${SSL_DIR}/linuxmgr-${domain}.key <<'LINUXMGR_EOF'\n${key.trim()}\nLINUXMGR_EOF`,
      ];
      for (const cmd of cmds) {
        const r = await pool.run(cfg, cmd);
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'ssl.upload', target: server.host, detail: domain, result: 'success' });
      res.json({ code: 0, data: { domain } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `上传证书失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/ssl/selfsigned', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const domain = String(req.body?.domain || '');
    if (!DOMAIN_RE.test(domain)) return res.status(400).json({ code: 400, message: '域名不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const cmd = `mkdir -p ${SSL_DIR} && openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout ${SSL_DIR}/linuxmgr-${domain}.key -out ${SSL_DIR}/linuxmgr-${domain}.crt -subj "/CN=${domain}"`;
      const r = await pool.run(cfg, cmd, { timeoutMs: 60000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'ssl.selfsigned', target: server.host, detail: domain, result: 'success' });
      res.json({ code: 0, data: { domain } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `生成自签证书失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createSslRouter;
