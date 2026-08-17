const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const ACTIONS = ['start', 'stop', 'restart'];

function createSupervisorRouter({ config, pool, store }) {
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

  async function configDir(cfg) {
    const r = await pool.run(cfg, 'test -d /etc/supervisord.d && echo a || echo b');
    return r.stdout.trim() === 'a' ? '/etc/supervisord.d' : '/etc/supervisor/conf.d';
  }

  function parseStatus(output) {
    return output.split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          name: parts[0],
          status: parts[1] || 'UNKNOWN',
          pid: parts[3] && /^\d+$/.test(parts[3]) ? parts[3] : '',
          uptime: parts.slice(4).join(' '),
        };
      });
  }

  router.get('/servers/:id/supervisor', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const check = await pool.run(cfg, 'command -v supervisorctl >/dev/null 2>&1 && echo yes || echo no');
      if (check.stdout.trim() !== 'yes') {
        return res.json({ code: 0, data: { available: false, programs: [], message: 'Supervisor 未安装，请先在软件商店安装' } });
      }
      const status = await pool.run(cfg, 'supervisorctl status');
      const programs = status.code === 0 ? parseStatus(status.stdout) : [];
      res.json({ code: 0, data: { available: true, programs } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取进程状态失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/supervisor/programs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { name, command, directory, user, autostart, autorestart } = req.body || {};
    if (!name || !NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '进程名不合法（字母/数字/_-，1-32 位）' });
    if (!command || !command.trim()) return res.status(400).json({ code: 400, message: '启动命令不能为空' });
    if (command.trim().length > 500) return res.status(400).json({ code: 400, message: '启动命令过长' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const dir = await configDir(cfg);
      const progName = `linuxmgr-${name}`;
      const content = [
        `[program:${progName}]`,
        `command=${command.trim()}`,
        directory ? `directory=${directory}` : '',
        `user=${user || 'root'}`,
        `autostart=${autostart === false ? 'false' : 'true'}`,
        `autorestart=${autorestart === false ? 'false' : 'true'}`,
        'redirect_stderr=true',
      ].filter(Boolean).join('\n');
      // heredoc 写入（cat 不在黑名单；内容中的命令仍会被 assertCommandSafe 校验）
      const writeCmd = `cat > ${dir}/${progName}.ini <<'LINUXMGR_EOF'\n${content}\nLINUXMGR_EOF`;
      for (const cmd of [writeCmd, 'supervisorctl reread', 'supervisorctl update']) {
        const r = await pool.run(cfg, cmd);
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'supervisor.create', target: server.host, detail: progName, result: 'success' });
      res.json({ code: 0, data: { name: progName } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `创建进程配置失败: ${err.message}` });
    }
  });

  router.delete('/servers/:id/supervisor/programs/:name', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) {
      return res.status(400).json({ code: 400, message: '只能操作本工具创建的进程（linuxmgr- 前缀）' });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const dir = await configDir(cfg);
      for (const cmd of [`rm -f ${dir}/${name}.ini`, 'supervisorctl reread', 'supervisorctl update']) {
        const r = await pool.run(cfg, cmd);
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'supervisor.delete', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { deleted: name } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除进程配置失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/supervisor/programs/:name/:action', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    const action = req.params.action;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) {
      return res.status(400).json({ code: 400, message: '只能操作本工具创建的进程（linuxmgr- 前缀）' });
    }
    if (!ACTIONS.includes(action)) return res.status(400).json({ code: 400, message: `操作必须为 ${ACTIONS.join('/')}` });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `supervisorctl ${action} ${name}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: `supervisor.${action}`, target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { name, action } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `${action} 失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createSupervisorRouter;
