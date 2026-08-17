const express = require('express');
const { encrypt, decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');
const { assertCommandSafe } = require('../ssh/exec');
const { buildVhost, applyVhost, applyBasicAuth, REWRITE_PRESETS, PHP_SOCK } = require('../utils/vhost');

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
    const fullName = `linuxmgr-${name}`;
    // 名称查重前置：在任何 SSH 副作用之前拒绝重名
    const list = projectStore.read();
    if (list.some((p) => p.name === fullName)) {
      return res.status(400).json({ code: 400, message: '项目已存在' });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
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
      const cmds = [];
      const vhostName = name.replace('linuxmgr-', '');
      // PHP 项目没有 systemd unit，跳过 stop/disable
      if (project.type !== 'php') {
        cmds.push(`systemctl stop ${name}`, `systemctl disable ${name}`);
      }
      cmds.push(
        `mkdir -p /tmp/linuxmgr-backup && cp /etc/nginx/conf.d/linuxmgr-${vhostName}.conf /tmp/linuxmgr-backup/ 2>/dev/null || true`,
        `rm -f /etc/nginx/conf.d/linuxmgr-${vhostName}.conf`,
        `rm -f /etc/nginx/linuxmgr-htpasswd-${name}`,
        'nginx -s reload || true'
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

  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  const REDIRECT_URL_RE = /^https?:\/\/[^\s;{}]{1,200}$|^\/[^\s;{}]{0,200}$/;
  const PATH_RE = /^\/[^\s;{}]{0,200}$/;
  const RUNDIR_RE = /^\/[a-zA-Z0-9_\/.-]{0,100}$/;
  const INDEX_RE = /^[a-zA-Z0-9_. ]{1,100}$/;
  const USERNAME_RE = /^[a-zA-Z0-9_]{1,32}$/;
  const PRESETS = ['none', 'thinkphp', 'laravel', 'wordpress', 'typecho', 'emlog', 'discuz', 'custom'];

  function defaultSettings(p) {
    return {
      domains: Array.isArray(p.domains) && p.domains.length ? p.domains : [p.domain].filter(Boolean),
      runDir: p.runDir || '',
      index: p.index || 'index.php index.html',
      rewrite: p.rewrite || { preset: 'none' },
      antiLeech: p.antiLeech || { enabled: false, allowEmpty: true, referers: [] },
      redirects: Array.isArray(p.redirects) ? p.redirects : [],
      proxy: p.proxy || { enabled: false, target: '' },
      access: p.access || { allow: [], deny: [] },
      basicAuth: p.basicAuth ? { enabled: p.basicAuth.enabled, username: p.basicAuth.username } : { enabled: false, username: '' },
      customSnippet: p.customSnippet || '',
      sslDomain: p.sslDomain || '',
      phpVersion: p.phpVersion || '',
    };
  }

  // 校验并规范化输入；返回 { error } 或 { settings }
  function validateSettings(input, project) {
    const s = input || {};
    const out = {};
    if (s.domains !== undefined) {
      if (!Array.isArray(s.domains) || s.domains.length > 10) return { error: '域名列表不合法（最多 10 个）' };
      for (const d of s.domains) if (!DOMAIN_RE.test(d)) return { error: `域名不合法: ${d}` };
      out.domains = s.domains;
    }
    if (s.runDir !== undefined) {
      if (s.runDir !== '' && (!RUNDIR_RE.test(s.runDir) || s.runDir.includes('..'))) return { error: '运行目录不合法' };
      out.runDir = s.runDir;
    }
    if (s.index !== undefined) {
      if (!INDEX_RE.test(s.index)) return { error: '默认文档不合法' };
      out.index = s.index;
    }
    if (s.rewrite !== undefined) {
      const rw = s.rewrite || {};
      if (!PRESETS.includes(rw.preset)) return { error: '伪静态预设不合法' };
      if (rw.preset === 'custom') {
        if (!rw.custom || String(rw.custom).length > 2000) return { error: '自定义伪静态规则不能为空且不超过 2000 字' };
        if (String(rw.custom).includes('}')) return { error: '自定义规则不能包含 } 字符' };
      }
      out.rewrite = { preset: rw.preset, custom: rw.preset === 'custom' ? String(rw.custom) : undefined };
    }
    if (s.antiLeech !== undefined) {
      const a = s.antiLeech || {};
      const referers = Array.isArray(a.referers) ? a.referers : [];
      for (const r of referers) if (!/^(\*\.)?[a-zA-Z0-9.-]{1,100}$/.test(r)) return { error: `防盗链域名不合法: ${r}` };
      out.antiLeech = { enabled: !!a.enabled, allowEmpty: a.allowEmpty !== false, referers };
    }
    if (s.redirects !== undefined) {
      if (!Array.isArray(s.redirects) || s.redirects.length > 20) return { error: '重定向规则不合法（最多 20 条）' };
      for (const r of s.redirects) {
        if (!PATH_RE.test(r.from || '')) return { error: `重定向来源路径不合法: ${r.from}` };
        if (!REDIRECT_URL_RE.test(r.to || '')) return { error: `重定向目标不合法: ${r.to}` };
        if (![301, 302].includes(Number(r.type))) return { error: '重定向类型必须为 301 或 302' };
      }
      out.redirects = s.redirects.map((r) => ({ from: r.from, to: r.to, type: Number(r.type) }));
    }
    if (s.proxy !== undefined) {
      const pr = s.proxy || {};
      if (pr.target && !/^https?:\/\/[a-zA-Z0-9.:-]{1,100}$/.test(pr.target)) return { error: '反向代理目标不合法' };
      out.proxy = { enabled: !!pr.enabled, target: pr.target || '' };
    }
    if (s.access !== undefined) {
      const ac = s.access || {};
      const allow = Array.isArray(ac.allow) ? ac.allow : [];
      const deny = Array.isArray(ac.deny) ? ac.deny : [];
      for (const ip of [...allow, ...deny]) if (!IP_RE.test(ip)) return { error: `IP 不合法: ${ip}` };
      out.access = { allow, deny };
    }
    if (s.basicAuth !== undefined) {
      const b = s.basicAuth || {};
      if (b.enabled) {
        if (!USERNAME_RE.test(b.username || '')) return { error: '密码访问用户名不合法' };
        const had = project.basicAuth?.enabled && project.basicAuth?.username === b.username;
        if (!b.password && !had) return { error: '启用密码访问必须设置密码' };
        out.basicAuth = {
          enabled: true,
          username: b.username,
          passwordEnc: b.password ? encrypt(String(b.password), config.masterKey) : project.basicAuth.passwordEnc,
        };
      } else {
        out.basicAuth = { enabled: false, username: b.username || '' };
      }
    }
    if (s.customSnippet !== undefined) {
      if (String(s.customSnippet).length > 2000) return { error: '自定义片段不超过 2000 字' };
      if (String(s.customSnippet).includes('}')) return { error: '自定义片段不能包含 } 字符' };
      out.customSnippet = String(s.customSnippet);
    }
    if (s.phpVersion !== undefined) {
      if (project.type === 'php' && s.phpVersion && !PHP_SOCK[s.phpVersion]) return { error: 'PHP 版本不合法' };
      if (project.type === 'php' && s.phpVersion) out.phpVersion = s.phpVersion;
    }
    return { settings: out };
  }

  router.get('/servers/:id/projects/:name/settings', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    let phpVersions = [];
    if (project.type === 'php') {
      // 探测失败不阻塞设置读取，返回空版本列表
      try {
        const r = await pool.run(cfg, 'ls /var/run/php*-php-fpm.sock 2>/dev/null');
        phpVersions = (r.stdout || '').split('\n')
          .map((l) => l.trim().match(/php(\d+)-php-fpm\.sock/))
          .filter(Boolean).map((m) => `php${m[1]}`);
      } catch {
        phpVersions = [];
      }
    }
    res.json({ code: 0, data: { settings: defaultSettings(project), phpVersions, sslDomain: project.sslDomain || '' } });
  });

  router.put('/servers/:id/projects/:name/settings', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const list = projectStore.read();
    const project = list.find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const { error, settings } = validateSettings(req.body?.settings, project);
    if (error) return res.status(400).json({ code: 400, message: error });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const next = { ...project, ...settings };
      const needsVhost = next.type === 'php' || next.proxy?.enabled;
      if (needsVhost) {
        // 旧版 linkVhost 曾追加 # linuxmgr-ssl-<domain> 标记但项目记录无 sslDomain 字段，
        // 声明式再生成前探测旧 vhost，检出 marker 则回填域名以保留 443 段
        if (!next.sslDomain) {
          const probe = await pool.run(cfg, `grep -o 'linuxmgr-ssl-\\S*' /etc/nginx/conf.d/${name}.conf || true`);
          const m = (probe.stdout || '').match(/linuxmgr-ssl-(\S+)/);
          if (m) next.sslDomain = m[1];
        }
        await applyVhost({ pool }, cfg, next);
        await applyBasicAuth({ pool, config }, cfg, next);
      } else if (project.type !== 'php' && project.proxy?.enabled && !next.proxy?.enabled) {
        // 关闭反向代理：删除 vhost
        await pool.run(cfg, `rm -f /etc/nginx/conf.d/${name}.conf`);
        // nginx 未运行（纯 systemd 服务器）时 reload 失败不影响结果
        await pool.run(cfg, 'nginx -s reload || true');
        await applyBasicAuth({ pool, config }, cfg, next);
      }
      projectStore.write(list.map((p) => (p.name === name ? next : p)));
      audit(config.dataDir, { action: 'project.settings', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { settings: defaultSettings(next) } });
    } catch (err) {
      audit(config.dataDir, { action: 'project.settings', target: server.host, detail: name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `保存设置失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/projects/:name/vhost', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    if (project.type !== 'php' && !project.proxy?.enabled) {
      return res.json({ code: 0, data: '# 该项目未启用反向代理，无 Nginx 配置' });
    }
    res.json({ code: 0, data: buildVhost(project) });
  });

  router.get('/servers/:id/projects/:name/sitelogs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const type = req.query.type === 'error' ? 'error' : req.query.type === 'access' ? 'access' : null;
    if (!type) return res.status(400).json({ code: 400, message: 'type 必须为 access 或 error' });
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 1000);
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `tail -n ${lines} /var/log/nginx/${name}.${type}.log 2>/dev/null || true`);
      res.json({ code: 0, data: r.stdout || '' });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取网站日志失败: ${err.message}` });
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
