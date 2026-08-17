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
      const lines = (r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const entries = [];
      for (let i = 0; i < lines.length; i++) {
        const mark = lines[i].match(MARK_RE);
        if (mark) {
          // 标记注释行与其后紧跟的命令行合并为一条记录
          const cmd = lines[i + 1] || '';
          entries.push({ line: cmd, ours: true, id: `linuxmgr-${mark[1]}` });
          i += 1;
        } else {
          entries.push({ line: lines[i], ours: false });
        }
      }
      res.json({ code: 0, data: entries });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取计划任务失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/crontabs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { expression, command, type, method, url, postData, scriptPath } = req.body || {};
    if (!expression || !CRON_RE.test(expression.trim())) {
      return res.status(400).json({ code: 400, message: 'cron 表达式不合法（5 段：分 时 日 月 周）' });
    }
    const taskType = type || 'shell';

    // 根据任务类型生成实际执行命令
    let execCommand = '';
    if (taskType === 'shell') {
      if (!command || command.trim().length > 500) return res.status(400).json({ code: 400, message: '命令不合法' });
      execCommand = command.trim();
    } else if (taskType === 'url') {
      const reqMethod = (method || 'GET').toUpperCase();
      if (!['GET', 'POST'].includes(reqMethod)) return res.status(400).json({ code: 400, message: '请求方法必须为 GET/POST' });
      if (!url || !/^https?:\/\/[^\s'"]{1,500}$/.test(url)) return res.status(400).json({ code: 400, message: 'URL 不合法（需以 http:// 或 https:// 开头）' });
      if (reqMethod === 'POST' && postData && postData.length > 2000) return res.status(400).json({ code: 400, message: 'POST 数据过长（最大 2KB）' });
      // curl 静默访问，记录 HTTP 状态码；POST 带数据
      const dataPart = reqMethod === 'POST' && postData ? `-d '${postData.replace(/'/g, "'\\''")}'` : '';
      execCommand = `curl -s -o /dev/null -w "%{http_code}" -X ${reqMethod} ${dataPart} '${url.replace(/'/g, "'\\''")}'`;
    } else if (taskType === 'python') {
      if (!scriptPath || !/^\/[a-zA-Z0-9_/.-]+\.py$/.test(scriptPath)) {
        return res.status(400).json({ code: 400, message: 'Python 脚本路径不合法（需为 .py 文件路径）' });
      }
      execCommand = `python3 ${scriptPath}`;
    } else {
      return res.status(400).json({ code: 400, message: '任务类型必须为 shell/url/python' });
    }

    try {
      assertCommandSafe(execCommand);
    } catch (err) {
      return res.status(400).json({ code: 400, message: err.message });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    const id = `linuxmgr-${crypto.randomUUID().slice(0, 8)}`;
    const cmd = `( crontab -l 2>/dev/null; echo "# ${id}"; echo "${expression.trim()} ${execCommand}" ) | crontab -`;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'crontab.create', target: server.host, detail: `${expression} ${execCommand.slice(0, 80)}`, result: 'success' });
      res.json({ code: 0, data: { id, execCommand } });
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
