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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-files-'));
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

const LS = `total 8
drwxr-xr-x 3 root root 4096 2026-08-17 10:00 app
-rw-r--r-- 1 root root 1234 2026-08-17 09:30 server.js
lrwxrwxrwx 1 root root 5 2026-08-17 08:00 link -> app
`;

test('文件列表解析', async () => {
  const { app } = setup({
    'ls -la --time-style=long-iso /www': () => ({ code: 0, stdout: LS, stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/files?path=/www').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.path, '/www');
  assert.equal(res.body.data.items.length, 3);
  assert.equal(res.body.data.items[0].name, 'app');
  assert.equal(res.body.data.items[0].type, 'dir');
  assert.equal(res.body.data.items[1].type, 'file');
  assert.equal(res.body.data.items[2].type, 'link');
  assert.equal(res.body.data.items[1].size, 1234);
});

test('读取受保护文件拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/read').set(await auth(app))
    .send({ path: '/etc/shadow' });
  assert.equal(res.status, 400);
});

test('写入文件（heredoc）', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/write').set(await auth(app))
    .send({ path: '/www/app/config.json', content: '{"a":1}' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('/www/app/config.json'), '应写目标文件');
  assert.ok(joined.includes('{"a":1}'), '应包含内容');
});

test('写入受保护文件拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/write').set(await auth(app))
    .send({ path: '/etc/passwd', content: 'x' });
  assert.equal(res.status, 400);
});

test('删除文件移入回收站', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/delete').set(await auth(app))
    .send({ path: '/www/app/tmp.log', confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('/tmp/linuxmgr-trash/')), '应移入回收站而非直接删除');
});

test('删除未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/delete').set(await auth(app))
    .send({ path: '/www/app/tmp.log', confirm: false });
  assert.equal(res.status, 400);
});

test('chmod 模式校验', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const bad = await request(app).post('/api/servers/srv1/files/chmod').set(await auth(app))
    .send({ path: '/www/app/x.sh', mode: 'abc' });
  assert.equal(bad.status, 400);
  const good = await request(app).post('/api/servers/srv1/files/chmod').set(await auth(app))
    .send({ path: '/www/app/x.sh', mode: '755' });
  assert.equal(good.status, 200);
  assert.ok((await Promise.resolve(good)).body.code === 0);
});

test('SSL 证书列表', async () => {
  const { app } = setup({
    'ls /etc/nginx/ssl/linuxmgr-*.crt 2>/dev/null': () => ({ code: 0, stdout: '/etc/nginx/ssl/linuxmgr-example.com.crt\n', stderr: '' }),
    "openssl x509 -in /etc/nginx/ssl/linuxmgr-example.com.crt -noout -subject -dates -issuer": () => ({ code: 0, stdout: 'subject=CN = example.com\nnotBefore=Aug  1 00:00:00 2026 GMT\nnotAfter=Aug  1 00:00:00 2027 GMT\nissuer=CN = My CA\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/ssl').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].domain, 'example.com');
  assert.ok(res.body.data[0].subject.includes('example.com'));
});

test('SSL 上传校验 PEM 格式', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const bad = await request(app).post('/api/servers/srv1/ssl/upload').set(await auth(app))
    .send({ domain: 'example.com', cert: 'not-a-pem', key: 'not-a-key' });
  assert.equal(bad.status, 400);
});

test('SSL 自签证书', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/ssl/selfsigned').set(await auth(app))
    .send({ domain: 'test.local' });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('openssl req')), '应执行 openssl 自签');
});
