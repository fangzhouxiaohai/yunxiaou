const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken } = require('../src/auth/jwt');
const { requireAuth } = require('../src/auth/middleware');

test('签发与校验往返', () => {
  const token = signToken({ username: 'admin', role: 'admin' }, 'secret', '1h');
  const payload = verifyToken(token, 'secret');
  assert.equal(payload.username, 'admin');
  assert.equal(payload.role, 'admin');
});

test('错误密钥校验失败', () => {
  const token = signToken({ username: 'admin' }, 'a', '1h');
  assert.throws(() => verifyToken(token, 'b'));
});

test('过期令牌校验失败', async () => {
  const token = signToken({ username: 'admin' }, 'secret', '1ms');
  await new Promise((r) => setTimeout(r, 20));
  assert.throws(() => verifyToken(token, 'secret'));
});

test('requireAuth 无令牌返回 401', () => {
  const middleware = requireAuth({ jwtSecret: 'secret' });
  const req = { headers: {} };
  const res = { status: (c) => ({ json: (b) => { res._status = c; res._body = b; } }) };
  middleware(req, res, () => { throw new Error('不应进入 next'); });
  assert.equal(res._status, 401);
  assert.equal(res._body.code, 401);
});

test('requireAuth 有效令牌放行并注入 req.user', () => {
  const middleware = requireAuth({ jwtSecret: 'secret' });
  const token = signToken({ username: 'admin' }, 'secret', '1h');
  const req = { headers: { authorization: `Bearer ${token}` } };
  let passed = false;
  middleware(req, {}, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.user.username, 'admin');
});
