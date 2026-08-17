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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-proj-'));
  const { config } = loadConfig({ JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir });
  const stores = {
    servers: new JsonStore(dataDir, 'servers.json', []),
    projects: new JsonStore(dataDir, 'projects.json', []),
  };
  stores.servers.write([{ id: 'srv1', name: 't', host: '10.0.0.1', port: 22, username: 'root', passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString() }]);
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const h = scripted[command] || scripted.default;
      return h ? h() : { code: 0, stdout: '', stderr: '' };
    },
    closeKey: () => {},
  };
  const app = createApp({ config, pool, stores });
  return { app, stores, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

const OK = () => ({ code: 0, stdout: '', stderr: '' });

test('项目列表为空', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).get('/api/servers/srv1/projects').set(await auth(app));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('创建 Node 项目（systemd unit）', async () => {
  const { app, stores, calls } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'app1', type: 'node', directory: '/www/app1', port: 3001, entry: 'node server.js' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('/etc/systemd/system/linuxmgr-app1.service'), '应写 systemd unit');
  assert.ok(joined.includes('systemctl daemon-reload'));
  assert.ok(joined.includes('node server.js'), '应包含启动命令');
  assert.ok(joined.includes('PORT=3001'), '应注入端口环境变量');
  const saved = JSON.parse(fs.readFileSync(stores.projects.file, 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'node');
});

test('创建 PHP 项目（Nginx vhost + remi socket）', async () => {
  const { app, calls } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'blog', type: 'php', directory: '/www/blog', port: 8080, phpVersion: 'php81' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('/etc/nginx/conf.d/linuxmgr-blog.conf'), '应写 nginx vhost');
  assert.ok(joined.includes('unix:/var/run/php81-php-fpm.sock'), '应使用对应 PHP 版本 socket');
  assert.ok(joined.includes('nginx -s reload'), '应 reload 而非 restart');
});

test('非法项目参数返回 400', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'bad name!', type: 'node', directory: '/etc', port: 99999, entry: 'x' });
  assert.equal(res.status, 400);
});

test('危险启动命令被拦截', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'evil', type: 'node', directory: '/www/evil', port: 3002, entry: 'rm -rf /' });
  assert.equal(res.status, 400);
});

test('停止/启动/重启项目', async () => {
  const { app, calls } = setup({
    'systemctl stop linuxmgr-app1': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl start linuxmgr-app1': () => ({ code: 0, stdout: '', stderr: '' }),
    default: OK,
  });
  // 先创建
  await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'app1', type: 'node', directory: '/www/app1', port: 3001, entry: 'node server.js' });
  const stop = await request(app).post('/api/servers/srv1/projects/linuxmgr-app1/stop').set(await auth(app));
  assert.equal(stop.status, 200);
  assert.ok(calls.some((c) => c.includes('systemctl stop linuxmgr-app1')));
  const start = await request(app).post('/api/servers/srv1/projects/linuxmgr-app1/start').set(await auth(app));
  assert.equal(start.status, 200);
});

test('删除项目需确认并清理 unit', async () => {
  const { app, calls } = setup({
    'systemctl stop linuxmgr-app1': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl disable linuxmgr-app1': () => ({ code: 0, stdout: '', stderr: '' }),
    'rm -f /etc/systemd/system/linuxmgr-app1.service': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl daemon-reload': () => ({ code: 0, stdout: '', stderr: '' }),
    default: OK,
  });
  await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'app1', type: 'node', directory: '/www/app1', port: 3001, entry: 'node server.js' });
  const del = await request(app).delete('/api/servers/srv1/projects/linuxmgr-app1').set(await auth(app))
    .send({ confirm: true });
  assert.equal(del.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('rm -f /etc/systemd/system/linuxmgr-app1.service'));
});

test('删除项目未确认时拒绝', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).delete('/api/servers/srv1/projects/linuxmgr-app1').set(await auth(app))
    .send({ confirm: false });
  assert.equal(res.status, 400);
});

test('项目日志', async () => {
  const { app } = setup({
    'journalctl -u linuxmgr-app1 -n 200 --no-pager': () => ({ code: 0, stdout: 'line1\nline2\n', stderr: '' }),
    default: OK,
  });
  const res = await request(app).get('/api/servers/srv1/projects/linuxmgr-app1/logs').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.includes('line1'));
});

test('创建 PHP 项目带伪静态预设', async () => {
  const { app, calls } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'tp5', type: 'php', directory: '/www/tp5', port: 8081, phpVersion: 'php74', rewritePreset: 'thinkphp' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('/index.php?s=$1'), 'vhost 应含 thinkphp 伪静态');
  assert.ok(joined.includes('linuxmgr-tp5.access.log'), 'vhost 应含专属日志');
});

test('创建 PHP 项目传非法伪静态预设返回 400', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'bad', type: 'php', directory: '/www/bad', port: 8082, phpVersion: 'php74', rewritePreset: 'evil' });
  assert.equal(res.status, 400);
});
