const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const multer = require('multer');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const PATH_RE = /^\/$|^\/[a-zA-Z0-9_/.-]{1,200}$/;
const NAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const MODE_RE = /^[0-7]{3,4}$/;
const RELPATH_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5 .()\-/]{1,300}$/;
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

  // 新建文件（空文件，如 txt 文本）
  router.post('/servers/:id/files/touch', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    if (!validPath(filePath)) return res.status(400).json({ code: 400, message: '路径不合法' });
    const name = filePath.split('/').pop() || '';
    if (!NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '文件名不合法（字母/数字/._-，1-100 位）' });
    if (isProtected(filePath)) return res.status(400).json({ code: 400, message: '禁止在受保护路径创建文件' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `touch ${filePath}`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.touch', target: server.host, detail: filePath, result: 'success' });
      res.json({ code: 0, data: { created: filePath } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `创建文件失败: ${err.message}` });
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

  // ===== 多文件/文件夹上传（multipart + SFTP）=====

  // 目标目录必须已存在；相对路径逐段校验（防 .. 与绝对路径）
  function validRelPath(rel) {
    if (!RELPATH_RE.test(rel)) return false;
    if (rel.startsWith('/') || rel.includes('\\')) return false;
    if (rel.split('/').some((seg) => seg === '..' || seg === '')) return false;
    return true;
  }

  const uploader = multer({
    dest: path.join(os.tmpdir(), 'linuxmgr-uploads'),
    limits: { fileSize: 20 * 1024 * 1024, files: 200 },
  });

  router.post('/servers/:id/files/upload', uploader.array('files', 200), async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const targetDir = String(req.body?.path || '/');
    if (!validPath(targetDir)) return res.status(400).json({ code: 400, message: '目标目录不合法' });
    const files = req.files || [];
    const relPaths = Array.isArray(req.body?.paths) ? req.body.paths : (req.body?.paths ? [req.body.paths] : []);
    if (files.length === 0) return res.status(400).json({ code: 400, message: '未接收到文件' });
    if (files.length !== relPaths.length) return res.status(400).json({ code: 400, message: '文件与路径数量不一致' });
    for (const rel of relPaths) {
      if (!validRelPath(String(rel))) return res.status(400).json({ code: 400, message: `相对路径不合法: ${rel}` });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      // 目标目录不存在则创建
      const mk = await pool.run(cfg, `mkdir -p ${targetDir}`);
      if (mk.code !== 0) throw new Error(mk.stderr.slice(0, 200));
      const uploaded = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = String(relPaths[i]);
        const remoteDir = rel.includes('/') ? `${targetDir}/${rel.slice(0, rel.lastIndexOf('/'))}` : targetDir;
        const remotePath = `${targetDir}/${rel}`;
        const mkdir = await pool.run(cfg, `mkdir -p ${remoteDir}`);
        if (mkdir.code !== 0) throw new Error(`创建远端目录失败: ${mkdir.stderr.slice(0, 200)}`);
        if (typeof pool.sftpPut === 'function') {
          await pool.sftpPut(cfg, file.path, remotePath);
        } else {
          throw new Error('连接池不支持 sftpPut');
        }
        uploaded.push(remotePath);
      }
      audit(config.dataDir, { action: 'file.upload', target: server.host, detail: `${targetDir} (${files.length} 个文件)`, result: 'success' });
      res.json({ code: 0, data: { uploaded: uploaded.length, targetDir } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `上传失败: ${err.message}` });
    } finally {
      // 清理本地临时文件
      try { fs.rmSync(path.join(os.tmpdir(), 'linuxmgr-uploads'), { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  // 移动文件/文件夹到目标目录（前端拖拽到目录）
  router.post('/servers/:id/files/move', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const filePath = String(req.body?.path || '');
    const targetDir = String(req.body?.targetDir || '');
    if (!validPath(filePath) || !validPath(targetDir)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (isProtected(filePath) || isProtected(targetDir)) return res.status(400).json({ code: 400, message: '禁止操作受保护路径' });
    if (targetDir === filePath || targetDir.startsWith(`${filePath}/`)) {
      return res.status(400).json({ code: 400, message: '不能移动到自身或其子目录' });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `mkdir -p ${targetDir} && mv ${filePath} ${targetDir}/`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.move', target: server.host, detail: `${filePath} -> ${targetDir}`, result: 'success' });
      res.json({ code: 0, data: { moved: `${filePath} -> ${targetDir}` } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `移动失败: ${err.message}` });
    }
  });

  // 复制文件/文件夹到目标目录
  router.post('/servers/:id/files/copy', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const filePath = String(req.body?.path || '');
    const targetDir = String(req.body?.targetDir || '');
    if (!validPath(filePath) || !validPath(targetDir)) return res.status(400).json({ code: 400, message: '路径不合法' });
    if (isProtected(filePath) || isProtected(targetDir)) return res.status(400).json({ code: 400, message: '禁止操作受保护路径' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `mkdir -p ${targetDir} && cp -r ${filePath} ${targetDir}/`);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      audit(config.dataDir, { action: 'file.copy', target: server.host, detail: `${filePath} -> ${targetDir}`, result: 'success' });
      res.json({ code: 0, data: { copied: `${filePath} -> ${targetDir}` } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `复制失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createFilesRouter;
