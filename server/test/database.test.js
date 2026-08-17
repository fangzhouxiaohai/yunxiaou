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

function makePool(scripted) {
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const handler = scripted[command] || scripted.default;
      if (handler) return handler();
      return { code: 0, stdout: '', stderr: '' };
    },
    closeKey: () => {},
  };
  return { pool, calls };
}

const DB_OUTPUT = `Database\ninformation_schema\nmysql\nperformance_schema\nsys\napp_blog\n`;

function setup(scripted = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-db-'));
  const { config } = loadConfig({
    JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir,
  });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  stores.servers.write([{
    id: 'srv1', name: '测试机', host: '10.0.0.1', port: 22, username: 'root',
    passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString(),
  }]);
  const { pool, calls } = makePool(scripted);
  const app = createApp({ config, pool, stores });
  return { app, config, stores, pool, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

test('数据库列表', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: DB_OUTPUT, stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.includes('app_blog'));
  assert.ok(calls.some((c) => c.includes('SHOW DATABASES')));
});

test('创建数据库+用户+授权', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases').set(await auth(app))
    .send({ name: 'app_new', username: 'app_new_user', password: 'DbPass123!' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('CREATE DATABASE IF NOT EXISTS `app_new`'));
  assert.ok(joined.includes('CREATE USER'));
  assert.ok(joined.includes('GRANT ALL PRIVILEGES ON `app_new`.*'));
});

test('删除数据库前自动备份', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).delete('/api/servers/srv1/databases/app_old').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mysqldump'), '删除前应备份');
  assert.ok(joined.includes('/tmp/linuxmgr-db-backup'));
  assert.ok(joined.includes('DROP DATABASE `app_old`'));
});

test('删除数据库未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).delete('/api/servers/srv1/databases/app_old').set(await auth(app))
    .send({ confirm: false });
  assert.equal(res.status, 400);
});

test('Redis 状态', async () => {
  const { app } = setup({
    default: () => ({
      code: 0,
      stdout: 'redis_version:7.0.15\nconnected_clients:3\nused_memory:1048576\nkeyspace_hits:10\nkeyspace_misses:2\ndb0:keys=5,expires=0,avg_ttl=0\n',
      stderr: '',
    }),
  });
  const res = await request(app).get('/api/servers/srv1/redis').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.version, '7.0.15');
  assert.equal(res.body.data.totalKeys, 5);
});

test('Redis 清空需确认且审计', async () => {
  const { app, calls, config } = setup({ default: () => ({ code: 0, stdout: 'OK', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/redis/flush').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('FLUSHDB')));
  const auditLog = fs.readFileSync(path.join(config.dataDir, 'audit.log'), 'utf8');
  assert.ok(auditLog.includes('redis.flush'));
});
