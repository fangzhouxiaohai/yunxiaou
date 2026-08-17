const express = require('express');
const crypto = require('node:crypto');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');
const { assertCommandSafe } = require('../ssh/exec');

// 5 段 cron 表达式校验（分 时 日 月 周）
const CRON_RE = /^(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)$/;
const MARK_RE = /^# linuxmgr-([a-zA-Z0-9-]+)/;
const ID_RE = /^linuxmgr-[a-zA-Z0-9-]{1,40}$/;

function createCrontabRouter({ config, pool, store }) {
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

  router.get('/servers/:id/crontabs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, 'crontab -l 2>/dev/null');
      const entries = [];
      for (const line of (r.stdout || '').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const mark = t.match(MARK_RE);
        entries.push(mark ? { line: t, ours: true, id: `linuxmgr-${mark[1]}` } : { line: t, ours: false });
      }
      res.json({ code: 0, data: entries });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取计划任务失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/crontabs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { expression, command } = req.body || {};
    if (!expression || !CRON_RE.test(expression.trim())) {
      return res.status(400).json({ code: 400, message: 'cron 表达式不合法（5 段：分 时 日 月 周）' });
    }
    if (!command || command.trim().length > 500) return res.status(400).json({ code: 400, message: '命令不合法' });
    try {
      assertCommandSafe(command);
    } catch (err) {
      return res.status(400).json({ code: 400, message: err.message });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    const id = `linuxmgr-${crypto.randomUUID().slice(0, 8)}`;
    const cmd = `( crontab -l 2>/dev/null; echo "# ${id}"; echo "${expression.trim()} ${command.trim()}" ) | crontab -`;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'crontab.create', target: server.host, detail: `${expression} ${command.slice(0, 80)}`, result: 'success' });
      res.json({ code: 0, data: { id } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `新增计划任务失败: ${err.message}` });
    }
  });

  router.delete('/servers/:id/crontabs/:cronId', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const id = req.params.cronId;
    if (!ID_RE.test(id)) return res.status(400).json({ code: 400, message: '只能删除本工具创建的任务（linuxmgr- 标记）' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    // awk：删除标记注释行及其后紧跟的命令行
    const cmd = `crontab -l 2>/dev/null | awk 'BEGIN{skip=0} /^# ${id}/{skip=1; next} skip && !/^#/{skip=0; next} {print}' | crontab -`;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'crontab.delete', target: server.host, detail: id, result: 'success' });
      res.json({ code: 0, data: { deleted: id } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除计划任务失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createCrontabRouter;
