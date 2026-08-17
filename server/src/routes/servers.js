const express = require('express');
const crypto = require('node:crypto');
const { encrypt, decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const NAME_RE = /^[\w\u4e00-\u9fa5 ._-]{1,50}$/;
const HOST_RE = /^[a-zA-Z0-9.\-:[\]]{1,255}$/;

function createServersRouter({ config, pool, store }) {
  const router = express.Router();

  const all = () => store.read();
  const find = (id) => all().find((s) => s.id === id);
  const mask = (s) => ({
    id: s.id, name: s.name, host: s.host, port: s.port,
    username: s.username, hasPassword: true, createdAt: s.createdAt,
  });

  function validate(body, { requirePassword }) {
    if (!body.name || !NAME_RE.test(body.name)) return '名称不合法（1-50 位中文/字母/数字/._-空格）';
    if (!body.host || !HOST_RE.test(body.host)) return '主机地址不合法';
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须为 1-65535';
    if (!body.username) return '用户名不能为空';
    if (requirePassword && !body.password) return '密码不能为空';
    return null;
  }

  function decryptPassword(server, res) {
    try {
      return decrypt(server.passwordEnc, config.masterKey);
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return null;
    }
  }

  router.get('/', (req, res) => {
    res.json({ code: 0, data: all().map(mask) });
  });

  router.post('/', (req, res) => {
    const err = validate(req.body || {}, { requirePassword: true });
    if (err) return res.status(400).json({ code: 400, message: err });
    const server = {
      id: crypto.randomUUID(),
      name: req.body.name.trim(),
      host: req.body.host.trim(),
      port: Number(req.body.port),
      username: req.body.username.trim(),
      passwordEnc: encrypt(req.body.password, config.masterKey),
      createdAt: new Date().toISOString(),
    };
    const list = all();
    list.push(server);
    store.write(list);
    audit(config.dataDir, { action: 'server.create', target: server.host, detail: server.name, result: 'success' });
    res.json({ code: 0, data: mask(server) });
  });

  router.put('/:id', (req, res) => {
    const list = all();
    const idx = list.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const err = validate(req.body || {}, { requirePassword: false });
    if (err) return res.status(400).json({ code: 400, message: err });
    const next = {
      ...list[idx],
      name: req.body.name.trim(),
      host: req.body.host.trim(),
      port: Number(req.body.port),
      username: req.body.username.trim(),
    };
    if (req.body.password) next.passwordEnc = encrypt(req.body.password, config.masterKey);
    list[idx] = next;
    store.write(list);
    audit(config.dataDir, { action: 'server.update', target: next.host, detail: next.name, result: 'success' });
    res.json({ code: 0, data: mask(next) });
  });

  router.delete('/:id', (req, res) => {
    const list = all();
    const idx = list.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const [removed] = list.splice(idx, 1);
    store.write(list);
    pool.closeKey(removed);
    audit(config.dataDir, { action: 'server.delete', target: removed.host, detail: removed.name, result: 'success' });
    res.json({ code: 0, data: null });
  });

  router.post('/:id/test', async (req, res) => {
    const server = find(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const password = decryptPassword(server, res);
    if (password === null) return;
    const cfg = { host: server.host, port: server.port, username: server.username, password };
    try {
      const result = await pool.run(cfg, 'echo ok && uname -sr');
      if (result.code !== 0) throw new Error(`命令退出码 ${result.code}: ${result.stderr.slice(0, 200)}`);
      const uname = result.stdout.trim().replace(/^ok\s*\n?/, '');
      audit(config.dataDir, { action: 'server.test', target: server.host, result: 'success' });
      res.json({ code: 0, data: { ok: true, uname } });
    } catch (err) {
      audit(config.dataDir, { action: 'server.test', target: server.host, result: 'fail', detail: err.message });
      res.status(502).json({ code: 502, message: `连接失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createServersRouter;
