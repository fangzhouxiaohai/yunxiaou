const express = require('express');
const crypto = require('node:crypto');
const { signToken } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');
const { audit } = require('../utils/audit');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function createAuthRouter({ config }) {
  const router = express.Router();
  const failures = new Map(); // ip -> { fails, lockedUntil }

  router.post('/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = failures.get(ip);
    if (rec && rec.lockedUntil && rec.lockedUntil > now) {
      return res.status(429).json({ code: 429, message: '登录失败次数过多，已锁定 15 分钟' });
    }
    const { username, password } = req.body || {};
    const ok = username === config.adminUser && safeEqual(password || '', config.adminPassword);
    if (!ok) {
      const next = { fails: (rec ? rec.fails : 0) + 1, lockedUntil: null };
      if (next.fails >= 5) {
        next.lockedUntil = now + 15 * 60 * 1000;
        next.fails = 0;
      }
      failures.set(ip, next);
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

  return router;
}

module.exports = createAuthRouter;
