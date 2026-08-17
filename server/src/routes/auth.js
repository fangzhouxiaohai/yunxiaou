const express = require('express');
const { signToken } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');
const { audit } = require('../utils/audit');

function createAuthRouter({ config, credentials }) {
  const router = express.Router();
  const failures = new Map(); // ip -> { fails, lockedUntil }

  function checkLocked(req, res) {
    const rec = failures.get(req.ip || 'unknown');
    if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
      res.status(429).json({ code: 429, message: '失败次数过多，已锁定 15 分钟' });
      return true;
    }
    return false;
  }

  function noteFailure(ip) {
    const now = Date.now();
    const rec = failures.get(ip);
    const next = { fails: (rec ? rec.fails : 0) + 1, lockedUntil: null };
    if (next.fails >= 5) {
      next.lockedUntil = now + 15 * 60 * 1000;
      next.fails = 0;
    }
    failures.set(ip, next);
  }

  router.post('/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (checkLocked(req, res)) return;
    const { username, password } = req.body || {};
    const ok = credentials.verify(username, password || '');
    if (!ok) {
      noteFailure(ip);
      audit(config.dataDir, { action: 'login', target: ip, detail: `user=${username}`, result: 'fail' });
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    failures.delete(ip);
    const token = signToken({ username, role: 'admin' }, config.jwtSecret, config.jwtExpiresIn);
    audit(config.dataDir, { action: 'login', target: ip, detail: `user=${username}`, result: 'success' });
    res.json({ code: 0, data: { token, username, role: 'admin' } });
  });

  router.get('/me', requireAuth(config), (req, res) => {
    res.json({ code: 0, data: req.user });
  });

  router.put('/password', requireAuth(config), (req, res) => {
    const ip = req.ip || 'unknown';
    if (checkLocked(req, res)) return;
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ code: 400, message: '新密码至少 6 位' });
    }
    if (!credentials.verify(req.user.username, oldPassword || '')) {
      noteFailure(ip);
      audit(config.dataDir, { action: 'change-password', target: ip, detail: `user=${req.user.username}`, result: 'fail' });
      return res.status(400).json({ code: 400, message: '原密码错误' });
    }
    failures.delete(ip);
    credentials.setPassword(newPassword);
    audit(config.dataDir, { action: 'change-password', target: ip, detail: `user=${req.user.username}`, result: 'success' });
    res.json({ code: 0, data: { message: '密码修改成功' } });
  });

  return router;
}

module.exports = createAuthRouter;
