const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/index');
const { loadConfig } = require('../src/config');
const { JsonStore } = require('../src/store/jsonStore');
const { encrypt } = require('../src/crypto/cipher');

function setup(scripted) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-store-'));
  const { config } = loadConfig({
    JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir,
  });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  stores.servers.write([{
    id: 'srv1', name: '测试机', host: '10.0.0.1', port: 22, username: 'root',
    passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString(),
  }]);
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const handler = scripted[command] || scripted.default;
      return handler ? handler() : { code: 0, stdout: '', stderr: '' };
    },
    closeKey: () => {},
  };
  const app = createApp({ config, pool, stores });
  return { app, config, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

test('软件列表返回 8 个软件及检测结果', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: 'nginx version: nginx/1.24.0', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/store').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 8);
  const nginx = res.body.data.find((s) => s.name === 'nginx');
  assert.equal(nginx.installed, true);
  assert.ok(nginx.version.includes('1.24.0'));
  assert.ok(calls.some((c) => c.includes('nginx -v')));
});

test('安装软件走包管理器并审计', async () => {
  const { app, calls, config } = setup({
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/store/git/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('apt-get') || joined.includes('yum'), '应使用系统包管理器');
  assert.ok(joined.includes('git'));
  const auditLog = fs.readFileSync(path.join(config.dataDir, 'audit.log'), 'utf8');
  assert.ok(auditLog.includes('store.install'));
});

test('未知软件名拒绝安装', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/store/evil-tool/install').set(await auth(app));
  assert.equal(res.status, 400);
});
