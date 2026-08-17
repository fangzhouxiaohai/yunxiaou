const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');
const { assertCommandSafe } = require('../ssh/exec');
const { applyVhost, REWRITE_PRESETS, PHP_SOCK } = require('../utils/vhost');

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const DIR_RE = /^\/[a-zA-Z0-9_/.-]{1,200}$/;
const DOMAIN_RE = /^[a-zA-Z0-9.-]{1,100}$/;
const TYPES = ['php', 'node', 'python', 'java'];
const ACTIONS = ['start', 'stop', 'restart'];
const PROTECTED_DIRS = ['/', '/etc', '/var', '/usr', '/boot', '/home', '/root', '/tmp', '/dev', '/proc', '/sys', '/run', '/opt', '/srv'];

function createProjectsRouter({ config, pool, store, projectStore }) {
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

  function systemdUnit(name, dir, entry, port) {
    return `[Unit]
Description=linuxmgr ${name} project
After=network.target

[Service]
Type=simple
WorkingDirectory=${dir}
ExecStart=${entry}
Environment=PORT=${port}
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target`;
  }

  router.get('/servers/:id/projects', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const projects = projectStore.read();
      const items = await Promise.all(projects.map(async (p) => {
        const r = await pool.run(cfg, `systemctl is-active ${p.name}`);
        return { ...p, status: r.stdout.trim() || 'unknown' };
      }));
      res.json({ code: 0, data: items });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取项目列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/projects', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { name, type, directory, port, entry, phpVersion, domain } = req.body || {};
    if (!name || !NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '项目名不合法（字母/数字/_-，1-32 位）' });
    if (!TYPES.includes(type)) return res.status(400).json({ code: 400, message: `项目类型必须为 ${TYPES.join('/')}` });
    if (domain && !DOMAIN_RE.test(domain)) return res.status(400).json({ code: 400, message: '域名不合法' });
    if (!directory || !DIR_RE.test(directory)) return res.status(400).json({ code: 400, message: '目录路径不合法' });
    if (PROTECTED_DIRS.some((p) => directory === p || directory.startsWith(`${p}/`))) {
      return res.status(400).json({ code: 400, message: '禁止使用系统关键目录' });
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return res.status(400).json({ code: 400, message: '端口必须为 1-65535' });
    if (type !== 'php' && (!entry || entry.trim().length > 500)) return res.status(400).json({ code: 400, message: '启动命令不合法' });
    if (type === 'php' && !PHP_SOCK[phpVersion]) return res.status(400).json({ code: 400, message: '请选择有效的 PHP 版本' });
    if (type === 'php' && req.body.rewritePreset && !REWRITE_PRESETS[req.body.rewritePreset]) {
      return res.status(400).json({ code: 400, message: '伪静态预设不合法' });
    }
    if (type !== 'php') {
      try {
        assertCommandSafe(entry);
      } catch (err) {
        return res.status(400).json({ code: 400, message: err.message });
      }
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    const fullName = `linuxmgr-${name}`;
    try {
      const mkdir = await pool.run(cfg, `mkdir -p ${directory}`);
      if (mkdir.code !== 0) throw new Error(mkdir.stderr.slice(0, 200));

      if (type === 'php') {
        const project0 = {
          name: fullName, type, directory, port: portNum,
          phpVersion, domain: domain || undefined,
          domains: domain ? [domain] : [],
          rewrite: { preset: req.body.rewritePreset || 'none' },
        };
        await applyVhost({ pool }, cfg, project0);
      } else {
        const unit = systemdUnit(name, directory, entry.trim(), portNum);
        const writeCmd = `cat > /etc/systemd/system/linuxmgr-${name}.service <<'LINUXMGR_EOF'\n${unit}\nLINUXMGR_EOF`;
        const w = await pool.run(cfg, writeCmd);
        if (w.code !== 0) throw new Error(`写入 unit 失败: ${w.stderr.slice(0, 200)}`);
        const d = await pool.run(cfg, 'systemctl daemon-reload');
        if (d.code !== 0) throw new Error(d.stderr.slice(0, 200));
        const e = await pool.run(cfg, `systemctl enable --now ${fullName}`);
        if (e.code !== 0) throw new Error(e.stderr.slice(0, 200));
      }

      const project = {
        name: fullName,
        type,
        directory,
        port: portNum,
        entry: type === 'php' ? '' : entry.trim(),
        phpVersion: type === 'php' ? phpVersion : undefined,
        domain: domain || undefined,
        domains: domain ? [domain] : [],
        rewrite: type === 'php' ? { preset: req.body.rewritePreset || 'none' } : undefined,
        createdAt: new Date().toISOString(),
      };
      const list = projectStore.read();
      if (list.some((p) => p.name === fullName)) {
        return res.status(400).json({ code: 400, message: '项目已存在' });
      }
      list.push(project);
      projectStore.write(list);
      audit(config.dataDir, { action: 'project.create', target: server.host, detail: fullName, result: 'success' });
      res.json({ code: 0, data: project });
    } catch (err) {
      audit(config.dataDir, { action: 'project.create', target: server.host, detail: fullName, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `创建项目失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/projects/:name/:action', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    const action = req.params.action;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    if (!ACTIONS.includes(action)) return res.status(400).json({ code: 400, message: `操作必须为 ${ACTIONS.join('/')}` });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `systemctl ${action} ${name}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: `project.${action}`, target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { name, action } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `${action} 失败: ${err.message}` });
    }
  });

  router.delete('/servers/:id/projects/:name', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const list = projectStore.read();
    const project = list.find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const cmds = [`systemctl stop ${name}`, `systemctl disable ${name}`];
      const vhostName = name.replace('linuxmgr-', '');
      cmds.push(
        `mkdir -p /tmp/linuxmgr-backup && cp /etc/nginx/conf.d/linuxmgr-${vhostName}.conf /tmp/linuxmgr-backup/ 2>/dev/null || true`,
        `rm -f /etc/nginx/conf.d/linuxmgr-${vhostName}.conf`,
        `rm -f /etc/nginx/linuxmgr-htpasswd-${name}`,
        'nginx -s reload'
      );
      if (project.type !== 'php') {
        cmds.push(`rm -f /etc/systemd/system/${name}.service`);
      }
      cmds.push('systemctl daemon-reload');
      for (const cmd of cmds) {
        const r = await pool.run(cfg, cmd);
        if (r.code !== 0) throw new Error(`${cmd.slice(0, 60)}: ${r.stderr.slice(0, 200)}`);
      }
      projectStore.write(list.filter((p) => p.name !== name));
      audit(config.dataDir, { action: 'project.delete', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { deleted: name } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除项目失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/projects/:name/logs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能查看本工具创建的项目' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `journalctl -u ${name} -n 200 --no-pager`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      res.json({ code: 0, data: r.stdout });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取日志失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createProjectsRouter;
