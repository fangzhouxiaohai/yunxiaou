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

function setup(scripted, projectSeed = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-files-'));
  const { config } = loadConfig({ JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir });
  const stores = {
    servers: new JsonStore(dataDir, 'servers.json', []),
    projects: new JsonStore(dataDir, 'projects.json', []),
  };
  stores.servers.write([{ id: 'srv1', name: 't', host: '10.0.0.1', port: 22, username: 'root', passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString() }]);
  if (projectSeed.length > 0) stores.projects.write(projectSeed);
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const h = scripted[command] || scripted.default;
      return h ? h() : { code: 0, stdout: '', stderr: '' };
    },
    async sftpPut(cfg, local, remote) {
      calls.push(`sftpPut:${remote}`);
      return { code: 0 };
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

test('目录不存在时返回结构化容错而非报错', async () => {
  const { app } = setup({
    'ls -la --time-style=long-iso /nope': () => ({ code: 2, stdout: '', stderr: 'ls: cannot access /nope: No such file or directory' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/files?path=/nope').set(await auth(app));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.items, []);
  assert.ok(res.body.data.error.includes('No such file'));
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

test('项目域名列表（仅已配置域名的项目）', async () => {
  const seed = [
    { name: 'linuxmgr-blog', type: 'php', directory: '/www/blog', port: 8080, domain: 'blog.example.com', createdAt: '2026-01-01' },
    { name: 'linuxmgr-api', type: 'node', directory: '/www/api', port: 3001, createdAt: '2026-01-01' },
  ];
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) }, seed);
  const res = await request(app).get('/api/servers/srv1/ssl/domains').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1, '只有配置了域名的项目出现');
  assert.equal(res.body.data[0].domain, 'blog.example.com');
  assert.equal(res.body.data[0].project, 'linuxmgr-blog');
});

test('自签证书自动设置续期（脚本 + crontab）并关联项目 vhost', async () => {
  const seed = [
    { name: 'linuxmgr-blog', type: 'php', directory: '/www/blog', port: 8080, domain: 'blog.example.com', createdAt: '2026-01-01' },
  ];
  const { app, calls } = setup({
    'cat /etc/nginx/conf.d/linuxmgr-blog.conf': () => ({ code: 0, stdout: 'server {\n    listen 8080;\n    server_name blog.example.com;\n}\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  }, seed);
  const res = await request(app).post('/api/servers/srv1/ssl/selfsigned').set(await auth(app))
    .send({ domain: 'blog.example.com' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.autoRenew, true);
  assert.equal(res.body.data.vhost.linked, true);
  const joined = calls.join(' ');
  assert.ok(joined.includes('linuxmgr-renew-blog.example.com.sh'), '应写续期脚本');
  assert.ok(joined.includes('# linuxmgr-renew-blog.example.com'), 'crontab 应带标记');
  assert.ok(joined.includes('0 3 * * * /usr/local/bin/linuxmgr-renew-blog.example.com.sh'), '应每天 3 点检查');
  assert.ok(joined.includes('listen 443 ssl'), 'vhost 应追加 443 ssl 段');
  assert.ok(joined.includes('nginx -t && nginx -s reload'), '应 reload nginx');
});

test('自签证书重复生成时 vhost 不重复生成（幂等，按 sslDomain 判断）', async () => {
  const seed = [
    { name: 'linuxmgr-blog', type: 'php', directory: '/www/blog', port: 8080, domain: 'blog.example.com', domains: ['blog.example.com'], sslDomain: 'blog.example.com', createdAt: '2026-01-01' },
  ];
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  }, seed);
  const res = await request(app).post('/api/servers/srv1/ssl/selfsigned').set(await auth(app))
    .send({ domain: 'blog.example.com' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.vhost.linked, true);
  assert.equal(res.body.data.vhost.reason, '已关联');
  const joined = calls.join(' ');
  const writeCount = joined.split('cat > /etc/nginx/conf.d/linuxmgr-blog.conf').length - 1;
  assert.equal(writeCount, 0, 'sslDomain 已关联时不应重写 vhost');
});

// ===== 多文件上传 / 移动 / 复制 =====

test('多文件上传（含子目录结构，走 SFTP）', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app)
    .post('/api/servers/srv1/files/upload')
    .set(await auth(app))
    .field('path', '/www/app')
    .field('paths', 'logo.png')
    .field('paths', 'img/banner.png')
    .attach('files', Buffer.from('PNGDATA1'), { filename: 'logo.png' })
    .attach('files', Buffer.from('PNGDATA2'), { filename: 'banner.png' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.uploaded, 2);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mkdir -p /www/app'), '应确保目标目录存在');
  assert.ok(joined.includes('sftpPut:/www/app/logo.png'), '应 SFTP 上传第一个文件');
  assert.ok(joined.includes('mkdir -p /www/app/img'), '应创建子目录');
  assert.ok(joined.includes('sftpPut:/www/app/img/banner.png'), '应上传到子目录');
});

test('上传无文件返回 400', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app)
    .post('/api/servers/srv1/files/upload?path=/www')
    .set(await auth(app))
    .field('paths', 'x.png');
  assert.equal(res.status, 400);
});

test('非法相对路径拒绝（.. 与绝对路径）', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const bad = await request(app)
    .post('/api/servers/srv1/files/upload?path=/www')
    .set(await auth(app))
    .field('paths', '../evil.sh')
    .attach('files', Buffer.from('x'), { filename: 'evil.sh' });
  assert.equal(bad.status, 400);
  const bad2 = await request(app)
    .post('/api/servers/srv1/files/upload?path=/www')
    .set(await auth(app))
    .field('paths', '/etc/passwd')
    .attach('files', Buffer.from('x'), { filename: 'passwd' });
  assert.equal(bad2.status, 400);
});

test('移动文件到目录（拖拽移动）', async () => {
  const { app, calls } = setup({
    'mkdir -p /www/app/sub && mv /www/app/file.txt /www/app/sub/': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/files/move').set(await auth(app))
    .send({ path: '/www/app/file.txt', targetDir: '/www/app/sub', confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('mv /www/app/file.txt /www/app/sub/')));
});

test('移动未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/move').set(await auth(app))
    .send({ path: '/www/app/file.txt', targetDir: '/www/app/sub', confirm: false });
  assert.equal(res.status, 400);
});

test('不能移动到自身子目录', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/move').set(await auth(app))
    .send({ path: '/www/app', targetDir: '/www/app/sub', confirm: true });
  assert.equal(res.status, 400);
});

test('新建空文件（txt）', async () => {
  const { app, calls } = setup({
    'touch /www/app/notes.txt': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/files/touch').set(await auth(app))
    .send({ path: '/www/app/notes.txt' });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('touch /www/app/notes.txt')));
});

test('新建文件非法名称拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/files/touch').set(await auth(app))
    .send({ path: '/www/app/bad name!.txt' });
  assert.equal(res.status, 400);
});

test('复制文件到目录', async () => {
  const { app, calls } = setup({
    'mkdir -p /www/app/sub && cp -r /www/app/file.txt /www/app/sub/': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/files/copy').set(await auth(app))
    .send({ path: '/www/app/file.txt', targetDir: '/www/app/sub' });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('cp -r /www/app/file.txt')));
});
