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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-logs-'));
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

const LOG_SCAN = 'for f in /var/log/nginx/error.log /var/log/nginx/access.log /var/log/mysql/error.log /var/log/php-fpm/error.log /var/log/messages /var/log/secure /var/log/auth.log /var/log/syslog; do if [ -f "$f" ]; then echo "$f|1|$(stat -c%s "$f" 2>/dev/null)"; else echo "$f|0|0"; fi; done';

test('日志文件列表（存在性+大小）', async () => {
  const { app } = setup({
    [LOG_SCAN]: () => ({ code: 0, stdout: '/var/log/nginx/error.log|1|12345\n/var/log/messages|0|0\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/logs/files').set(await auth(app));
  assert.equal(res.status, 200);
  const err = res.body.data.find((f) => f.path === '/var/log/nginx/error.log');
  assert.equal(err.exists, true);
  assert.equal(err.size, 12345);
  const msg = res.body.data.find((f) => f.path === '/var/log/messages');
  assert.equal(msg.exists, false);
});

test('读取日志（tail）', async () => {
  const { app } = setup({
    'tail -n 100 /var/log/nginx/error.log': () => ({ code: 0, stdout: 'line1\nline2\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/logs/read?path=/var/log/nginx/error.log&lines=100').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.includes('line1'));
});

test('非法日志路径拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).get('/api/servers/srv1/logs/read?path=/etc/shadow&lines=100').set(await auth(app));
  assert.equal(res.status, 400);
});

test('计划任务列表（含 ours 标记识别）', async () => {
  const { app } = setup({
    'crontab -l 2>/dev/null': () => ({ code: 0, stdout: '0 2 * * * /usr/bin/backup.sh\n# linuxmgr-abc123\n*/5 * * * * /usr/bin/check.sh\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/crontabs').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 3);
  assert.equal(res.body.data[0].ours, false);
  assert.equal(res.body.data[1].ours, true);
  assert.equal(res.body.data[1].id, 'linuxmgr-abc123');
});

test('crontab 不存在时返回空列表', async () => {
  const { app } = setup({
    'crontab -l 2>/dev/null': () => ({ code: 127, stdout: '', stderr: 'no crontab for root' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/crontabs').set(await auth(app));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('新增计划任务（带 linuxmgr- 标记）', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/crontabs').set(await auth(app))
    .send({ expression: '0 2 * * *', command: '/usr/bin/backup.sh' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('linuxmgr-'), '应带标记');
  assert.ok(joined.includes('0 2 * * * /usr/bin/backup.sh'), '应包含表达式与命令');
  assert.ok(joined.includes('| crontab -'), '应写入 crontab');
});

test('非法 cron 表达式拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/crontabs').set(await auth(app))
    .send({ expression: 'not a cron', command: 'x' });
  assert.equal(res.status, 400);
});

test('删除本工具的计划任务（awk 精确删除）', async () => {
  const { app, calls } = setup({
    "crontab -l 2>/dev/null | awk 'BEGIN{skip=0} /^# linuxmgr-abc123/{skip=1; next} skip && !/^#/{skip=0; next} {print}' | crontab -": () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).delete('/api/servers/srv1/crontabs/linuxmgr-abc123').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('awk')));
});
