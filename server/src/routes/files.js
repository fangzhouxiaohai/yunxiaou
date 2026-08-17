const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const PATH_RE = /^\/$|^\/[a-zA-Z0-9_/.-]{1,200}$/;
const NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const MODE_RE = /^[0-7]{3,4}$/;
// 危险路径：读写均禁止
const PROTECTED = ['/etc/shadow', '/etc/passwd', '/etc/sudoers', '/etc/gshadow', '/etc/ssh', '/root/.ssh', '/proc', '/sys', '/dev', '/boot'];

function createFilesRouter({ config, pool, store }) {
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

  function validPath(p) {
    return PATH_RE.test(p) && !p.split('/').includes('..');
  }

  function isProtected(p) {
    return PROTECTED.some((x) => p === x || p.startsWith(`${x}/`));
  }

  function parseLs(output) {
    return output.split('\n')
      .filter((l) => l.trim() && !l.startsWith('total '))
      .map((line) => {
        const m = line.trim().match(/^(\S{10})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
        if (!m) return null;
        const [, mode, owner, group, size, date, time, name] = m;
        if (name === '.' || name === '..') return null;
        const type = mode[0] === 'd' ? 'dir' : mode[0] === 'l' ? 'link' : 'file';
        return { name, type, size: parseInt(size, 10) || 0, mtime: `${date} ${time}`, mode, owner, group };
      })
      .filter(Boolean);
  }

  router.get('/servers/:id/files', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const dir = String(req.query.path || '/');
    if (!validPath(dir)) return res.status(400).json({ code: 400, message: '路径不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `ls -la --time-style=long-iso ${dir}`);
      if (r.code !== 0) {
        // 目录不存在/无权限 → 结构化容错而非报错
        return res.json({ code: 0, data: { path: dir, items: [], error: r.stderr.trim() || '目录不存在或无法访问' } });
      }
      res.json({ code: 0, data: { path: dir, items: parseLs(r.stdout) } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取目录失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/read', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (isProtected(filePath)) return res.status(400).json({ code: 400, message: '禁止读取受保护文件' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `cat ${filePath}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      res.json({ code: 0, data: r.stdout });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取文件失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/write', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    const content = String(req.body?.content || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (isProtected(filePath)) return res.status(400).json({ code: 400, message: '禁止写入受保护文件' });
    if (content.length > 512 * 1024) return res.status(400).json({ code: 400, message: '内容过大（最大 512KB）' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const cmd = `cat > ${filePath} <<'LINUXMGR_EOF'\n${content}\nLINUXMGR_EOF`;
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.write', target: server.host, detail: filePath, result: 'success' });
      res.json({ code: 0, data: { written: filePath } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `写入文件失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/mkdir', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const dir = String(req.body?.path || '');
    if (!validPath(dir)) return res.status(400).json({ code: 400, message: '路径不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `mkdir -p ${dir}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200));
      audit(config.dataDir, { action: 'file.mkdir', target: server.host, detail: dir, result: 'success' });
      res.json({ code: 0, data: { created: dir } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `创建目录失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/delete', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const filePath = String(req.body?.path || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (isProtected(filePath)) return res.status(400).json({ code: 400, message: '禁止删除受保护文件' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const base = filePath.split('/').pop();
      const cmd = `mkdir -p /tmp/linuxmgr-trash && mv ${filePath} /tmp/linuxmgr-trash/${base}-$(date +%s)`;
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.delete', target: server.host, detail: filePath, result: 'success' });
      res.json({ code: 0, data: { moved: '/tmp/linuxmgr-trash' } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/rename', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    const newName = String(req.body?.newName || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (!NAME_RE.test(newName)) return res.status(400).json({ code: 400, message: '新文件名不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const parent = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
      const r = await pool.run(cfg, `mv ${filePath} ${parent}/${newName}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.rename', target: server.host, detail: `${filePath} -> ${newName}`, result: 'success' });
      res.json({ code: 0, data: { renamed: newName } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `重命名失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/files/chmod', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    const mode = String(req.body?.mode || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (!MODE_RE.test(mode)) return res.status(400).json({ code: 400, message: '权限模式不合法（如 755）' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `chmod ${mode} ${filePath}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.chmod', target: server.host, detail: `${filePath} ${mode}`, result: 'success' });
      res.json({ code: 0, data: { chmod: `${filePath} ${mode}` } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `修改权限失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createFilesRouter;
