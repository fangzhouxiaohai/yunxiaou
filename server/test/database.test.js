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
  assert.equal(res.body.data.available, true);
  assert.ok(res.body.data.databases.includes('app_blog'));
  assert.ok(calls.some((c) => c.includes('SHOW DATABASES')));
});

test('MySQL 未安装时返回 unavailable 而非报错', async () => {
  const { app } = setup({
    default: () => ({ code: 127, stdout: '', stderr: 'bash: mysql: command not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
  assert.ok(res.body.data.message.includes('mysql'));
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
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.version, '7.0.15');
  assert.equal(res.body.data.totalKeys, 5);
});

test('Redis 未安装时返回 unavailable 而非报错', async () => {
  const { app } = setup({
    default: () => ({ code: 127, stdout: '', stderr: 'bash: redis-cli: command not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/redis').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
  assert.ok(res.body.data.message.includes('redis-cli'));
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

test('MySQL 版本列表（已装实例 + 可安装版本）', async () => {
  const { app } = setup({
    'mysql --version': () => ({ code: 0, stdout: 'mysql  Ver 8.0.40 for Linux on x86_64', stderr: '' }),
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mysqld.service loaded active running\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/mysql/versions').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.instances.length, 1);
  assert.equal(res.body.data.instances[0].service, 'mysqld');
  assert.equal(res.body.data.instances[0].state, 'running');
  assert.ok(res.body.data.instances[0].version.includes('8.0'), '应带 mysql 客户端版本');
  assert.ok(res.body.data.available.length >= 2, '应列出可安装版本');
});

test('安装 MySQL 8.0（官方源）', async () => {
  const { app, calls } = setup({
    'rpm -Uvh https://repo.mysql.com/mysql80-community-release-el7-7.noarch.rpm': () => ({ code: 0, stdout: '', stderr: '' }),
    'yum install -y mysql-community-server': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl enable --now mysqld': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mysql-community-server'), '应安装 MySQL 官方包');
});

test('已存在 MySQL 实例时拒绝自动安装', async () => {
  const { app } = setup({
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mysqld.service loaded active running\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: true });
  assert.equal(res.status, 400);
});

test('安装 MySQL 未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 127, stdout: '', stderr: 'not found' }) });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: false });
  assert.equal(res.status, 400);
});

test('切换默认 MySQL 实例（停其他启目标）', async () => {
  const { app, calls } = setup({
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mariadb.service loaded active running\nmysqld.service loaded inactive dead\n', stderr: '' }),
    'systemctl stop mariadb': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl start mysqld': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/switch').set(await auth(app))
    .send({ service: 'mysqld', confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('systemctl stop mariadb'), '应停止其他实例');
  assert.ok(joined.includes('systemctl start mysqld'), '应启动目标实例');
});
