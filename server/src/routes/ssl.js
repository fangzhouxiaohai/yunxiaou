const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');
const { applyVhost } = require('../utils/vhost');

const DOMAIN_RE = /^[a-zA-Z0-9.-]{1,100}$/;
const SSL_DIR = '/etc/nginx/ssl';

// 自签证书自动续期脚本模板（单引号 heredoc 写入，$ 保持字面量）
function renewScript(domain) {
  return `#!/bin/bash
# linuxmgr renew ${domain}
CRT=${SSL_DIR}/linuxmgr-${domain}.crt
KEY=${SSL_DIR}/linuxmgr-${domain}.key
[ -f "$CRT" ] || exit 0
END=$(openssl x509 -in "$CRT" -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$END" ] || exit 0
EXP=$(date -d "$END" +%s 2>/dev/null)
[ -n "$EXP" ] || exit 0
DAYS=$(( (EXP - $(date +%s)) / 86400 ))
if [ "$DAYS" -lt 30 ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout "$KEY" -out "$CRT" -subj "/CN=${domain}" 2>/dev/null
  nginx -t >/dev/null 2>&1 && nginx -s reload
fi
`;
}

function createSslRouter({ config, pool, store, projectStore }) {
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

  // 将证书关联到项目：写 sslDomain 字段并重新生成 vhost
  async function linkVhost(cfg, server, domain) {
    if (!projectStore) return { linked: false, reason: '项目存储不可用' };
    const list = projectStore.read();
    const project = list.find((p) => (Array.isArray(p.domains) && p.domains.length ? p.domains : [p.domain].filter(Boolean)).includes(domain));
    if (!project) return { linked: false, reason: '未找到该域名的项目' };
    if (project.type !== 'php' && !project.proxy?.enabled) {
      return { linked: false, reason: '该项目无 Nginx 配置（未启用反向代理）' };
    }
    if (project.sslDomain === domain) return { linked: true, reason: '已关联' };
    const next = { ...project, sslDomain: domain };
    try {
      await applyVhost({ pool }, cfg, next);
    } catch (err) {
      return { linked: false, reason: err.message };
    }
    projectStore.write(list.map((p) => (p.name === project.name ? next : p)));
    return { linked: true, reason: '已关联并 reload' };
  }

  // 设置自动续期：写入续期脚本 + crontab（linuxmgr- 标记，每天 3 点检查）
  async function setupAutoRenew(cfg, server, domain) {
    const scriptPath = `/usr/local/bin/linuxmgr-renew-${domain}.sh`;
    const scriptCmd = `cat > ${scriptPath} <<'LINUXMGR_EOF'\n${renewScript(domain)}\nLINUXMGR_EOF\nchmod +x ${scriptPath}`;
    const s = await pool.run(cfg, scriptCmd);
    if (s.code !== 0) return { ok: false, reason: s.stderr.slice(0, 200) };
    const cronCmd = `( crontab -l 2>/dev/null; echo "# linuxmgr-renew-${domain}"; echo "0 3 * * * ${scriptPath}" ) | crontab -`;
    const c = await pool.run(cfg, cronCmd);
    if (c.code !== 0) return { ok: false, reason: c.stderr.slice(0, 200) };
    return { ok: true };
  }

  // 项目域名列表（仅已创建项目配置的域名）
  router.get('/servers/:id/ssl/domains', (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!projectStore) return res.json({ code: 0, data: [] });
    const domains = projectStore.read()
      .filter((p) => p.domain)
      .map((p) => ({ domain: p.domain, project: p.name, type: p.type }));
    res.json({ code: 0, data: domains });
  });

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
      const linked = await linkVhost(cfg, server, domain);
      audit(config.dataDir, { action: 'ssl.upload', target: server.host, detail: domain, result: 'success', detail2: linked.reason });
      res.json({ code: 0, data: { domain, vhost: linked } });
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
      // 自动续期（每天 3 点检查，剩余 <30 天自动重新生成）
      const renew = await setupAutoRenew(cfg, server, domain);
      if (!renew.ok) throw new Error(`自动续期设置失败: ${renew.reason}`);
      // 关联项目 vhost（自动加 443 ssl 段）
      const linked = await linkVhost(cfg, server, domain);
      audit(config.dataDir, { action: 'ssl.selfsigned', target: server.host, detail: domain, result: 'success', detail2: `renew=${renew.ok} vhost=${linked.reason}` });
      res.json({ code: 0, data: { domain, autoRenew: true, vhost: linked } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `生成自签证书失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createSslRouter;
