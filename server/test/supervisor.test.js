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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-sup-'));
  const { config } = loadConfig({ JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
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
  return { app, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

const NOT_FOUND = () => ({ code: 127, stdout: '', stderr: 'not found' });

test('supervisor 状态列表', async () => {
  const { app } = setup({
    'command -v supervisorctl >/dev/null 2>&1 && echo yes || echo no': () => ({ code: 0, stdout: 'yes', stderr: '' }),
    'supervisorctl status': () => ({ code: 0, stdout: 'linuxmgr-app1                  RUNNING   pid 1234, uptime 1:23:45\nlinuxmgr-app2                  STOPPED   Not started\n', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).get('/api/servers/srv1/supervisor').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.programs.length, 2);
  assert.equal(res.body.data.programs[0].status, 'RUNNING');
  assert.equal(res.body.data.programs[0].pid, '1234');
});

test('创建 program 配置（linuxmgr- 前缀）并 reload', async () => {
  const { app, calls } = setup({
    'test -d /etc/supervisord.d && echo a || echo b': () => ({ code: 0, stdout: 'a', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/supervisor/programs').set(await auth(app))
    .send({ name: 'app1', command: 'node /www/app1/server.js', directory: '/www/app1', user: 'root', autostart: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('linuxmgr-app1.ini'), '配置文件名应有 linuxmgr- 前缀');
  assert.ok(joined.includes('supervisorctl reread') && joined.includes('supervisorctl update'));
  assert.ok(joined.includes('node /www/app1/server.js'), '应包含启动命令');
});

test('控制进程启停', async () => {
  const { app, calls } = setup({
    'supervisorctl start linuxmgr-app1': () => ({ code: 0, stdout: 'linuxmgr-app1: started', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/supervisor/programs/linuxmgr-app1/start').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('supervisorctl start')));
});

test('删除 program 需确认且清理配置', async () => {
  const { app, calls } = setup({
    'test -d /etc/supervisord.d && echo a || echo b': () => ({ code: 0, stdout: 'a', stderr: '' }),
    'rm -f /etc/supervisord.d/linuxmgr-app1.ini': () => ({ code: 0, stdout: '', stderr: '' }),
    'supervisorctl reread': () => ({ code: 0, stdout: '', stderr: '' }),
    'supervisorctl update': () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).delete('/api/servers/srv1/supervisor/programs/linuxmgr-app1').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('linuxmgr-app1.ini'));
  assert.ok(joined.includes('supervisorctl update'));
});

test('删除 program 未确认时拒绝', async () => {
  const { app } = setup({ default: NOT_FOUND });
  const res = await request(app).delete('/api/servers/srv1/supervisor/programs/linuxmgr-app1').set(await auth(app))
    .send({ confirm: false });
  assert.equal(res.status, 400);
});

test('未安装 supervisor 返回 unavailable', async () => {
  const { app } = setup({ default: NOT_FOUND });
  const res = await request(app).get('/api/servers/srv1/supervisor').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
});
