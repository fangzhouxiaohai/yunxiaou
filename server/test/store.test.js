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

// 默认所有检测命令都失败（未安装），需要时用 keyed 覆盖
const NOT_FOUND = () => ({ code: 127, stdout: '', stderr: 'not found' });

test('软件列表包含全部条目与检测结果', async () => {
  const { app, calls } = setup({
    'nginx -v 2>&1': () => ({ code: 0, stdout: 'nginx version: nginx/1.24.0', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).get('/api/servers/srv1/store').set(await auth(app));
  assert.equal(res.status, 200);
  const names = res.body.data.map((s) => s.name);
  for (const n of ['nginx', 'php74', 'php81', 'composer', 'java', 'supervisor', 'disk', 'mysql']) {
    assert.ok(names.includes(n), `应包含条目 ${n}`);
  }
  const nginx = res.body.data.find((s) => s.name === 'nginx');
  assert.equal(nginx.installed, true);
  assert.ok(nginx.version.includes('1.24.0'));
  const php81 = res.body.data.find((s) => s.name === 'php81');
  assert.equal(php81.installed, false, '默认未安装');
  const disk = res.body.data.find((s) => s.name === 'disk');
  assert.equal(disk.installed, true, '磁盘工具恒可用');
  assert.ok(calls.some((c) => c.includes('nginx -v')));
});

test('PHP 多版本条目：检测多个已装版本', async () => {
  const { app } = setup({
    'php81 -v 2>&1': () => ({ code: 0, stdout: 'PHP 8.1.27 (cli)', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).get('/api/servers/srv1/store').set(await auth(app));
  assert.equal(res.status, 200);
  const php81 = res.body.data.find((s) => s.name === 'php81');
  assert.equal(php81.installed, true);
  assert.ok(php81.version.includes('8.1.27'));
  const php74 = res.body.data.find((s) => s.name === 'php74');
  assert.equal(php74.installed, false);
});

test('安装 PHP 版本走 remi 源（rhel 系）', async () => {
  const { app, calls } = setup({
    'rpm -q remi-release >/dev/null 2>&1 || yum install -y https://rpms.remirepo.net/enterprise/remi-release-7.rpm': () => ({ code: 0, stdout: '', stderr: '' }),
    'yum-config-manager --enable remi-php81': () => ({ code: 0, stdout: '', stderr: '' }),
    'yum install -y php81-php-fpm': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl enable --now php81-php-fpm': () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/store/php81/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('remi-php81'), '应启用 remi-php81 源');
  assert.ok(joined.includes('php81-php-fpm'), '应安装 php81-php-fpm');
});

test('安装软件走包管理器并审计', async () => {
  const { app, calls, config } = setup({
    'yum install -y git': () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/store/git/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('apt-get') || joined.includes('yum'), '应使用系统包管理器');
  assert.ok(joined.includes('git'));
  const auditLog = fs.readFileSync(path.join(config.dataDir, 'audit.log'), 'utf8');
  assert.ok(auditLog.includes('store.install'));
});

test('Composer 安装分两步（不经过管道）', async () => {
  const { app, calls } = setup({
    'command -v php': () => ({ code: 0, stdout: '/usr/bin/php', stderr: '' }),
    'curl -sS -o /tmp/linuxmgr-composer-setup.php https://getcomposer.org/installer': () => ({ code: 0, stdout: '', stderr: '' }),
    'php /tmp/linuxmgr-composer-setup.php --install-dir=/usr/local/bin --filename=composer': () => ({ code: 0, stdout: '', stderr: '' }),
    'rm -f /tmp/linuxmgr-composer-setup.php': () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/store/composer/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('curl') && joined.includes('-o'), '应下载到文件');
  assert.ok(!/(?<!\|)\|(?!\|)/.test(joined), '不得使用单管道执行（curl|bash 类）');
});

test('Composer 在 PHP 未安装时拒绝安装', async () => {
  const { app } = setup({ default: NOT_FOUND });
  const res = await request(app).post('/api/servers/srv1/store/composer/install').set(await auth(app));
  assert.equal(res.status, 400);
});

test('Java 多版本检测与默认版本', async () => {
  const { app } = setup({
    'java -version 2>&1': () => ({ code: 0, stdout: 'openjdk version "1.8.0_412"\n', stderr: '' }),
    'alternatives --list java 2>&1': () => ({ code: 0, stdout: '/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.412.b08-1.el7_9.x86_64/jre/bin/java\n', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).get('/api/servers/srv1/store').set(await auth(app));
  assert.equal(res.status, 200);
  const java = res.body.data.find((s) => s.name === 'java');
  assert.equal(java.installed, true);
  assert.equal(java.defaultVersion, '1.8');
});

test('切换 Java 默认版本走 alternatives', async () => {
  const { app, calls } = setup({
    'alternatives --list java 2>&1': () => ({ code: 0, stdout: '/usr/lib/jvm/java-11-openjdk-11.0.22.7-1.el7_9.x86_64/bin/java\n/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.412.b08-1.el7_9.x86_64/jre/bin/java\n', stderr: '' }),
    "alternatives --set java '/usr/lib/jvm/java-11-openjdk-11.0.22.7-1.el7_9.x86_64/bin/java'": () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/store/java/switch').set(await auth(app))
    .send({ version: '11' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('alternatives --set java'), '应通过 alternatives 切换');
  assert.ok(joined.includes('java-11-openjdk'), '应切换到 11 版本路径');
});

test('安装 Supervisor 走 EPEL 源并启用服务', async () => {
  const { app, calls } = setup({
    'rpm -q epel-release >/dev/null 2>&1 || yum install -y epel-release': () => ({ code: 0, stdout: '', stderr: '' }),
    'yum install -y supervisor': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl enable --now supervisord': () => ({ code: 0, stdout: '', stderr: '' }),
    default: NOT_FOUND,
  });
  const res = await request(app).post('/api/servers/srv1/store/supervisor/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('epel-release'), 'CentOS 应先装 EPEL 源');
  assert.ok(joined.includes('supervisord'), '应启用 supervisord 服务');
});

test('未知软件名拒绝安装', async () => {
  const { app } = setup({ default: NOT_FOUND });
  const res = await request(app).post('/api/servers/srv1/store/evil-tool/install').set(await auth(app));
  assert.equal(res.status, 400);
});
