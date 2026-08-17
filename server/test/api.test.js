const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/index');
const { loadConfig } = require('../src/config');
const { JsonStore } = require('../src/store/jsonStore');

function fakePool() {
  return {
    run: async () => ({ code: 0, stdout: 'ok\nLinux 5.15.0-generic', stderr: '' }),
    closeKey: () => {},
  };
}

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-api-'));
  const { config } = loadConfig({
    JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir,
  });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  const app = createApp({ config, pool: fakePool(), stores });
  return { app, stores };
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return res.body.data.token;
}

test('登录成功返回 token，错误密码 401', async () => {
  const { app } = setup();
  const ok = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.token);
  const bad = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' });
  assert.equal(bad.status, 401);
});

test('登录失败 5 次后锁定 15 分钟', async () => {
  const { app } = setup();
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
  }
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  assert.equal(res.status, 429);
});

test('未带令牌访问受保护接口返回 401', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/servers');
  assert.equal(res.status, 401);
});

test('服务器 CRUD 全流程（密码加密存储、响应不含明文）', async () => {
  const { app, stores } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };

  const created = await request(app).post('/api/servers').set(auth).send({
    name: '测试机', host: '43.240.221.112', port: 22, username: 'root', password: 'Secret123',
  });
  assert.equal(created.status, 200);
  const id = created.body.data.id;
  assert.equal(created.body.data.hasPassword, true);
  assert.ok(!('password' in created.body.data), '响应不得包含明文密码');
  assert.ok(!('passwordEnc' in created.body.data), '响应不得包含密文');

  const raw = JSON.parse(fs.readFileSync(stores.servers.file, 'utf8'));
  assert.notEqual(raw[0].passwordEnc, 'Secret123');
  assert.ok(raw[0].passwordEnc.includes('.'), '应为 iv.tag.data 三段式密文');

  const list = await request(app).get('/api/servers').set(auth);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].name, '测试机');

  const upd = await request(app).put(`/api/servers/${id}`).set(auth).send({
    name: '改名机', host: '43.240.221.112', port: 22, username: 'root', password: 'NewPass456',
  });
  assert.equal(upd.body.data.name, '改名机');

  const testRes = await request(app).post(`/api/servers/${id}/test`).set(auth);
  assert.equal(testRes.body.data.ok, true);
  assert.ok(testRes.body.data.uname.includes('Linux'));

  const mon = await request(app).get(`/api/servers/${id}/monitor`).set(auth);
  assert.equal(mon.status, 200);

  await request(app).delete(`/api/servers/${id}`).set(auth);
  const list2 = await request(app).get('/api/servers').set(auth);
  assert.equal(list2.body.data.length, 0);
});

test('非法服务器参数返回 400', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).post('/api/servers').set(auth)
    .send({ name: 'x', host: '', port: 99999, username: '', password: 'p' });
  assert.equal(res.status, 400);
});

test('不存在的服务器返回 404', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).delete('/api/servers/no-such-id').set(auth);
  assert.equal(res.status, 404);
});
