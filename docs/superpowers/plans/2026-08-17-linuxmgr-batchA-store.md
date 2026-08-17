# 批次 A：软件商店扩充与版本管理 实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:executing-plans 或 subagent-driven-development 逐任务实现。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 软件商店支持 PHP 多版本（7.4-8.3 并存）、Composer、Java 环境管理器、Supervisor 进程守护、磁盘挂载工具、MySQL 多版本共存+切换。

**架构：** 扩展 `server/src/routes/store.js` 为元数据驱动的软件条目体系；新增 `distro.js`（发行版/包管理器/第三方源检测）、`disk.js` 与 `supervisor.js` 路由；前端商店页升级为版本化条目 + 骨架屏 + 操作进度。所有写操作遵循 8.1 约束（`linuxmgr-` 前缀、二次确认、审计）。

**技术栈：** 沿用 Express + ssh2 长连接池 + Vue3/Element Plus。新增依赖：无（解析全部用 node 内置）。

**设计文档：** `docs/superpowers/specs/2026-08-17-linuxmgr-design.md` 第 12 节批次 A。

**硬性约束：** 目标服务器是 CentOS 7（已确认）；安装类写操作一律二次确认 + 审计；`curl | bash` 类管道被 exec 黑名单拦截（Composer 安装必须分两步：下载到文件再执行）；**不提供格式化**（mkfs 保持黑名单拦截）。

---

## 文件结构

**后端 `server/src/`：**
- 创建：`utils/distro.js` — 发行版/包管理器/remi/sury/官方源检测
- 重构：`routes/store.js` — 元数据化软件条目（支持多版本条目）
- 创建：`routes/disk.js` — 磁盘工具（lsblk/df/mount/umount）
- 创建：`routes/supervisor.js` — Supervisor 状态与配置管理
- 扩展：`routes/database.js` — MySQL 多版本检测/安装/切换
- 扩展：`utils/dbParser.js` — lsblk/df 输出解析
- 修改：`index.js` — 挂载新路由

**测试 `server/test/`：**
- 创建：`distro.test.js`、`disk.test.js`、`supervisor.test.js`
- 扩展：`store.test.js`（多版本条目）、`database.test.js`（多版本接口）

**前端 `apps/web/src/`：**
- 扩展：`api/store.ts`（版本条目类型）、新建 `api/disk.ts`、`api/supervisor.ts`
- 升级：`views/store/index.vue`（版本化卡片、安装进度、磁盘/守护入口）
- 新建：`views/disk/index.vue`（磁盘工具页）、`views/supervisor/index.vue`（进程守护页）
- 修改：`router/index.ts`、`layout/index.vue`（新菜单）

---

### 任务 A1：发行版与软件源检测模块

**文件：**
- 创建：`server/src/utils/distro.js`
- 测试：`server/test/distro.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/distro.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDistro, remiAvailable, suryAvailable } = require('../src/utils/distro');

test('解析 /etc/os-release 为发行版信息', () => {
  const info = detectDistro('NAME="CentOS Linux"\nVERSION="7 (Core)"\nID="centos"\nVERSION_ID="7"\n');
  assert.equal(info.id, 'centos');
  assert.equal(info.versionMajor, 7);
  assert.equal(info.family, 'rhel');
});

test('Ubuntu 识别为 debian 系', () => {
  const info = detectDistro('NAME="Ubuntu"\nVERSION="20.04.6 LTS"\nID="ubuntu"\nVERSION_ID="20.04"\n');
  assert.equal(info.family, 'debian');
  assert.equal(info.versionMajor, 20);
});

test('remi 源可用性判断（rhel7 有 remi-release 时 true）', () => {
  assert.equal(remiAvailable('rhel', 7, 'remi-release  installed'), true);
  assert.equal(remiAvailable('rhel', 7, ''), false);
  assert.equal(remiAvailable('debian', 20, 'x'), false, 'debian 系不走 remi');
});

test('sury 源可用性判断（debian 系）', () => {
  assert.equal(suryAvailable('debian', 20, 'php'), true, 'sury 包存在即可用');
  assert.equal(suryAvailable('rhel', 7, 'x'), false);
});
```

- [ ] **步骤 2：运行测试验证失败**（`Cannot find module '../src/utils/distro'`）

- [ ] **步骤 3：实现 distro.js**

```js
// distro.js — 发行版检测与第三方软件源判断
function detectDistro(osReleaseText) {
  const kv = {};
  for (const line of osReleaseText.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) kv[m[1]] = m[2];
  }
  const id = (kv.ID || 'unknown').toLowerCase();
  const family = id === 'centos' || id === 'rhel' || id === 'fedora' || id === 'rocky' || id === 'almalinux' || id === 'amzn' ? 'rhel' : 'debian';
  return { id, name: kv.NAME || '', version: kv.VERSION_ID || '', versionMajor: parseInt(kv.VERSION_ID || '0', 10), family };
}

// rpm -qa 输出包含 remi-release 且系统为 rhel 系 → remi 可用
function remiAvailable(family, versionMajor, rpmOutput) {
  return family === 'rhel' && versionMajor === 7 && /remi-release/.test(rpmOutput);
}

// dpkg -l 输出包含 php 相关包且系统为 debian 系 → sury 可用
function suryAvailable(family, versionMajor, dpkgOutput) {
  return family === 'debian' && /php/.test(dpkgOutput);
}

module.exports = { detectDistro, remiAvailable, suryAvailable };
```

- [ ] **步骤 4：运行测试验证通过**
- [ ] **步骤 5：Commit** `feat: 发行版与软件源检测模块`

---

### 任务 A2：商店条目元数据化 + PHP 多版本

**文件：**
- 重构：`server/src/routes/store.js`
- 扩展：`server/test/store.test.js`

- [ ] **步骤 1：扩展测试（新增用例，原有用例保持通过）**

```js
test('PHP 多版本条目：检测多个已装版本', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: 'PHP 8.1.27 (cli)', stderr: '' }),
    // 版本命令以 php81 -v 结尾的返回 0，php74/php80/php82/php83 返回 127
    'php81 -v 2>&1': () => ({ code: 0, stdout: 'PHP 8.1.27 (cli)', stderr: '' }),
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
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/store/php81/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('remi-safe') || joined.includes('remi-php81'), '应使用 remi 源安装');
});

test('Composer 安装分两步（不经过管道）', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/store/composer/install').set(await auth(app));
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('curl') && joined.includes('-o'), '应下载到文件');
  assert.ok(!joined.includes('|'), '不得使用管道执行');
});
```

- [ ] **步骤 2：运行测试验证失败**（PHP 条目不存在）

- [ ] **步骤 3：重构 store.js 软件条目体系**

关键设计：

```js
// 条目元数据：type: 'plain'（普通软件）| 'php'（多版本）| 'composer' | 'java' | 'supervisor' | 'disk'
const PHP_VERSIONS = [
  { name: 'php74', display: 'PHP 7.4', verCmd: 'php74 -v 2>&1', remiPkg: 'php74-php-fpm', suryPkg: 'php7.4-fpm', aptPkg: 'php7.4-fpm', yumPkg: 'php74-php-fpm', fpmService: 'php74-php-fpm' },
  { name: 'php80', display: 'PHP 8.0', ... },
  { name: 'php81', display: 'PHP 8.1', ... },
  { name: 'php82', display: 'PHP 8.2', ... },
  { name: 'php83', display: 'PHP 8.3', ... },
];

// 检测：全部版本命令并行；安装：rhel 系先确保 remi 源（yum install -y epel-release remi-release 已装则跳过；启用 remi-phpXX 源 yum-config-manager --enable remi-php81）
// 安装命令模板（rhel + remi）：
//   1. rpm -q remi-release || yum install -y https://rpms.remirepo.net/enterprise/remi-release-7.rpm
//   2. yum install -y remi-release 已装则 yum-config-manager --enable remi-php81 && yum install -y php81-php-fpm
//   3. systemctl enable --now php81-php-fpm
// debian + sury 类似（apt-get install -y lsb-release apt-transport-https ca-certificates wget && wget -O /etc/apt/trusted.gpg.d/php.gpg https://packages.sury.org/php/apt.gpg && echo "deb https://packages.sury.org/php/ $(lsb_release -sc) main" > /etc/apt/sources.list.d/php.list && apt-get update && apt-get install -y php8.1-fpm）
```

完整条目清单（`SOFTWARE` 重构后）：
- plain：nginx、redis、docker、node、python3、git、fail2ban（保留现有）
- php 组：php74/php80/php81/php82/php83（remi/sury 安装）
- composer：`composer --version`；安装 = 下载 `https://getcomposer.org/installer` 到 `/tmp/linuxmgr-composer-setup.php`（curl -o），`php /tmp/linuxmgr-composer-setup.php --install-dir=/usr/local/bin --filename=composer`，删除临时文件；前置校验 `command -v php`
- java：单条目「Java 环境」带子版本选择 8/11/17（`java -version` 检测；安装 `yum install -y java-1.8.0-openjdk` / `java-11-openjdk` / `java-17-openjdk`；切换默认 `alternatives --set java <path>`，路径用 `alternatives --list java` 解析）
- supervisor：见任务 A4
- disk：见任务 A5

- [ ] **步骤 4：运行测试验证通过**（全部旧用例 + 新用例）
- [ ] **步骤 5：Commit** `feat: 商店条目元数据化，支持 PHP 多版本与 Composer`

---

### 任务 A3：Java 环境管理器

**文件：**
- 扩展：`server/src/routes/store.js`
- 扩展：`server/test/store.test.js`

- [ ] **步骤 1：新增测试**

```js
test('Java 多版本检测与默认版本', async () => {
  const { app } = setup({
    'java -version 2>&1': () => ({ code: 0, stdout: 'openjdk version "1.8.0_412"\n', stderr: '' }),
    'alternatives --list java 2>&1': () => ({ code: 0, stdout: '/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.412.b08-1.el7_9.x86_64/jre/bin/java\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/store').set(await auth(app));
  const java = res.body.data.find((s) => s.name === 'java');
  assert.equal(java.installed, true);
  assert.equal(java.defaultVersion, '1.8');
});

test('切换 Java 默认版本走 alternatives', async () => {
  const { app, calls } = setup({
    'alternatives --list java 2>&1': () => ({ code: 0, stdout: '/usr/lib/jvm/java-11-openjdk-11.0.22.7-1.el7_9.x86_64/bin/java\n/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.412.b08-1.el7_9.x86_64/jre/bin/java\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/store/java/switch').set(await auth(app))
    .send({ version: '11' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('alternatives --set java'), '应通过 alternatives 切换');
});
```

- [ ] **步骤 2：运行测试验证失败**
- [ ] **步骤 3：实现**

Java 条目数据结构：`{ name: 'java', display: 'Java 环境', type: 'java', versions: ['8','11','17'] }`。
- 检测：`java -version 2>&1` → 解析 `"1.8.0_412"` → `1.8`；`11.0.22` → `11`
- 已装版本列表：`alternatives --list java 2>&1` 路径解析（1.8 → java-1.8.0-*，11 → java-11-*）
- 安装：`yum install -y java-1.8.0-openjdk`（映射表 8→java-1.8.0-openjdk、11→java-11-openjdk、17→java-17-openjdk；apt 系 8→openjdk-8-jdk、11→openjdk-11-jdk、17→openjdk-17-jdk）
- 切换：`alternatives --set java <path>`（从 alternatives --list 解析对应版本路径）；debian 系用 `update-alternatives --set java <path>`（路径从 update-alternatives --list java 解析）
- 全部操作审计；切换/安装需前端确认

- [ ] **步骤 4：运行测试验证通过**
- [ ] **步骤 5：Commit** `feat: Java 环境管理器（多版本安装与 alternatives 切换）`

---

### 任务 A4：Supervisor 进程守护管理

**文件：**
- 创建：`server/src/routes/supervisor.js`
- 测试：`server/test/supervisor.test.js`
- 修改：`server/src/index.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/supervisor.test.js`：

```js
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

test('supervisor 状态列表', async () => {
  const { app } = setup({
    'supervisorctl status': () => ({ code: 0, stdout: 'linuxmgr-app1                  RUNNING   pid 1234, uptime 1:23:45\nlinuxmgr-app2                  STOPPED   Not started\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'bash: supervisorctl: command not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/supervisor').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.programs.length, 2);
  assert.equal(res.body.data.programs[0].status, 'RUNNING');
});

test('创建 program 配置（linuxmgr- 前缀）并 reload', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/supervisor/programs').set(await auth(app))
    .send({ name: 'app1', command: 'node /www/app1/server.js', directory: '/www/app1', user: 'root', autostart: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('linuxmgr-app1.ini'), '配置文件名应有 linuxmgr- 前缀');
  assert.ok(joined.includes('supervisorctl reread') && joined.includes('supervisorctl update'));
});

test('未安装 supervisor 返回 unavailable', async () => {
  const { app } = setup({ default: () => ({ code: 127, stdout: '', stderr: 'bash: supervisorctl: command not found' }) });
  const res = await request(app).get('/api/servers/srv1/supervisor').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
});
```

- [ ] **步骤 2：运行测试验证失败**（404）
- [ ] **步骤 3：实现 supervisor.js 并挂载**

```js
// GET  /servers/:id/supervisor            — 状态：available + programs[]（supervisorctl status）
// POST /servers/:id/supervisor/programs   — 创建 program：{ name, command, directory, user, autostart, autorestart }
// DELETE /servers/:id/supervisor/programs/:name — 删除（rm 配置文件 + reread/update，二次确认）
// POST /servers/:id/supervisor/programs/:name/:action — start/stop/restart（supervisorctl）

// 配置目录检测：/etc/supervisord.d/*.ini（CentOS）或 /etc/supervisor/conf.d/*.conf（Debian）
// 配置文件生成（写入 /etc/supervisord.d/linuxmgr-<name>.ini，前缀隔离）：
//   [program:linuxmgr-<name>]
//   command=<command>
//   directory=<directory>
//   user=<user>
//   autostart=<true|false>
//   autorestart=<true|false>
// 写入方式：cat > 文件 <<'EOF' 或 printf；统一走 exec（黑名单不含 cat/printf）
// 全部写操作审计 + 前端确认
```

在 `index.js` 挂载：`app.use('/api', requireAuth(config), createSupervisorRouter({ config, pool, store: stores.servers }));`

- [ ] **步骤 4：运行测试验证通过**
- [ ] **步骤 5：Commit** `feat: Supervisor 进程守护管理（状态/配置 CRUD）`

---

### 任务 A5：磁盘管理挂载工具

**文件：**
- 创建：`server/src/routes/disk.js`
- 扩展：`server/src/utils/dbParser.js`（lsblk/df 解析）
- 测试：`server/test/disk.test.js`
- 修改：`server/src/index.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/disk.test.js`：

```js
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
const { parseLsblk, parseDf } = require('../src/utils/dbParser');

const LSB = `NAME   SIZE TYPE MOUNTPOINT
vda    50G  disk
├─vda1 50G  part /
vdb    100G disk
└─vdb1 100G part
`;
const DF = `Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        50G   12G   36G  25% /
/dev/vdb1       100G   30G   66G  32% /data
`;

test('解析 lsblk 输出', () => {
  const disks = parseLsblk(LSB);
  assert.equal(disks.length, 2);
  assert.equal(disks[1].name, 'vdb');
  assert.equal(disks[1].partitions[0].mount, '/data');
});

test('解析 df 输出', () => {
  const mounts = parseDf(DF);
  assert.equal(mounts.length, 2);
  assert.equal(mounts[0].percent, 25);
});

function setup(scripted) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-disk-'));
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

test('磁盘列表（lsblk + df）', async () => {
  const { app } = setup({
    default: () => ({ code: 0, stdout: LSB, stderr: '' }),
    'df -h -x tmpfs -x devtmpfs': () => ({ code: 0, stdout: DF, stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/disk').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.disks.length, 2);
  assert.equal(res.body.data.mounts.length, 2);
});

test('挂载分区到 linuxmgr- 目录', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/disk/mount').set(await auth(app))
    .send({ device: '/dev/vdb1', mountPoint: '/data' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mkdir -p /data') && joined.includes('mount /dev/vdb1 /data'));
});

test('卸载需确认', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/disk/umount').set(await auth(app))
    .send({ mountPoint: '/data', confirm: false });
  assert.equal(res.status, 400);
});
```

- [ ] **步骤 2：运行测试验证失败**（dbParser 无 parseLsblk/parseDf；路由 404）

- [ ] **步骤 3：实现解析器与路由**

`dbParser.js` 追加：

```js
function parseLsblk(output) {
  // 递归解析（树形前缀 ├─/└─）：仅取 NAME/SIZE/TYPE/MOUNTPOINT 列
  const disks = [];
  let current = null;
  for (const line of output.split('\n')) {
    const t = line.trim();
    if (!t || t === 'NAME SIZE TYPE MOUNTPOINT') continue;
    const m = t.match(/^([├└]─)?(\S+)\s+(\S+)\s+(\S+)\s*(\S*)/);
    if (!m) continue;
    const [, tree, name, size, type, mount] = m;
    if (!tree) {
      current = { name, size, type, partitions: [] };
      disks.push(current);
    } else if (current) {
      current.partitions.push({ name, size, type, mount: mount || null });
    }
  }
  return disks;
}

function parseDf(output) {
  return output.split('\n').filter((l) => /^\//.test(l.trim())).map((line) => {
    const parts = line.trim().split(/\s+/);
    return { fs: parts[0], size: parts[1], used: parts[2], avail: parts[3], percent: parseInt(parts[4].replace('%', ''), 10), mount: parts[5] };
  });
}
```

`disk.js` 路由：

```js
// GET  /servers/:id/disk — { disks: parseLsblk(lsblk -o NAME,SIZE,TYPE,MOUNTPOINT), mounts: parseDf(df -h -x tmpfs -x devtmpfs) }
// POST /servers/:id/disk/mount — { device, mountPoint }：mkdir -p <mountPoint> && mount <device> <mountPoint>（审计）
// POST /servers/:id/disk/umount — { mountPoint, confirm }：umount <mountPoint>（审计）
// 校验：device 白名单 ^/dev/[a-zA-Z0-9_/.-]+$；mountPoint 白名单 ^/[a-zA-Z0-9_/.-]+$（禁止 /、/etc、/var 等危险路径列表）
```

挂载点保护列表：`['/', '/etc', '/var', '/usr', '/boot', '/home', '/root', '/tmp', '/dev', '/proc', '/sys']`。

- [ ] **步骤 4：运行测试验证通过**
- [ ] **步骤 5：Commit** `feat: 磁盘管理挂载工具（列表/挂载/卸载）`

---

### 任务 A6：MySQL 多版本共存与切换

**文件：**
- 扩展：`server/src/routes/database.js`
- 扩展：`server/test/database.test.js`

- [ ] **步骤 1：新增测试**

```js
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
  assert.ok(res.body.data.available.length >= 2, '应列出可安装版本');
});

test('安装 MySQL 8.0（官方源）', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mysql80') || joined.includes('mysql-community-server'), '应安装 MySQL 8 包');
});
```

- [ ] **步骤 2：运行测试验证失败**
- [ ] **步骤 3：实现**

```js
// GET  /servers/:id/mysql/versions
//   已装实例：mysql --version + systemctl list-units | grep -Ei "mysql|mariadb"（解析服务名/状态）
//   可安装版本：[{ version: '5.7', pkg: 'mysql57-community-server' }, { version: '8.0', pkg: 'mysql80-community-release' }, { version: 'mariadb', pkg: 'mariadb-server' }]
// POST /servers/:id/mysql/install { version, confirm }
//   rhel：先装官方源 rpm（mysql80-community-release-el7 等），再 yum install -y <pkg>
//   mariadb：yum install -y mariadb-server（默认源）
//   新实例端口分配：已占用 3306 → 3307 → 3308（grep 端口占用检测）
//   安装后：systemctl enable --now <service>；数据目录 /var/lib/mysql-<version>（新建实例时配置 my.cnf 片段，不触碰已有配置）
// POST /servers/:id/mysql/switch { service, confirm }
//   停所有其他 mysql/mariadb 实例 → 启动目标实例（审计 + 二次确认）
// 所有命令白名单校验：service 名 ^[a-zA-Z0-9_-]+$
```

注意：多版本并存实现复杂度高，第一版约束为：**安装一个额外版本（端口自动分配）** + **启停/切换已装实例**；若目标服务器已装 MySQL 8.0 且端口 3306 占用，额外版本用 3307。切换 = 停非默认 + 启默认。

- [ ] **步骤 4：运行测试验证通过**
- [ ] **步骤 5：Commit** `feat: MySQL 多版本共存与切换`

---

### 任务 A7：前端升级（商店版本化 + 磁盘/守护页面 + 菜单）

**文件：**
- 扩展：`apps/web/src/api/store.ts`（StoreItem 加 type/versions 等）
- 创建：`apps/web/src/api/disk.ts`、`apps/web/src/api/supervisor.ts`
- 升级：`apps/web/src/views/store/index.vue`
- 创建：`apps/web/src/views/disk/index.vue`、`apps/web/src/views/supervisor/index.vue`
- 修改：`apps/web/src/router/index.ts`、`apps/web/src/layout/index.vue`

- [ ] **步骤 1：扩展 API 类型**

```ts
// store.ts 扩展
export interface StoreItem {
  name: string
  display: string
  desc: string
  installed: boolean
  version: string
  package: string
  type?: 'plain' | 'php' | 'java' | 'composer' | 'supervisor' | 'disk'
  versions?: string[]        // php/java 子版本
  defaultVersion?: string    // java 默认版本
}

export function switchJava(serverId: string, version: string) {
  return request.post(`/servers/${serverId}/store/java/switch`, { version })
}

// disk.ts
export interface DiskInfo { name: string; size: string; type: string; partitions: Array<{ name: string; size: string; type: string; mount: string | null }> }
export interface MountInfo { fs: string; size: string; used: string; avail: string; percent: number; mount: string }
export function getDisk(serverId: string) { return request.get(`/servers/${serverId}/disk`) as Promise<{ disks: DiskInfo[]; mounts: MountInfo[] }> }
export function mountDevice(serverId: string, payload: { device: string; mountPoint: string }) { return request.post(`/servers/${serverId}/disk/mount`, payload) }
export function umountDevice(serverId: string, mountPoint: string, confirm: boolean) { return request.post(`/servers/${serverId}/disk/umount`, { mountPoint, confirm }) }

// supervisor.ts
export interface Program { name: string; status: string; pid?: string; uptime?: string }
export function getSupervisor(serverId: string) { return request.get(`/servers/${serverId}/supervisor`) as Promise<{ available: boolean; programs: Program[]; message?: string }> }
export function createProgram(serverId: string, payload: { name: string; command: string; directory: string; user: string; autostart: boolean }) { return request.post(`/servers/${serverId}/supervisor/programs`, payload) }
export function deleteProgram(serverId: string, name: string, confirm: boolean) { return request.delete(`/servers/${serverId}/supervisor/programs/${name}`, { data: { confirm } }) }
export function controlProgram(serverId: string, name: string, action: 'start' | 'stop' | 'restart') { return request.post(`/servers/${serverId}/supervisor/programs/${name}/${action}`) }
```

- [ ] **步骤 2：升级商店页面**

- PHP 版本卡片：显示版本号；已装 → 绿色标签+版本，未装 → 安装按钮；安装按钮 loading 状态（安装请求长超时）
- Java 卡片：已装 → 显示默认版本 + 「切换版本」下拉（versions 列表）；未装 → 安装按钮（默认装 8）
- Composer 卡片：未装且 PHP 未装时按钮禁用并提示"请先安装 PHP"
- supervisor/disk 卡片：点击「管理」跳转对应页面（router.push）
- 保持骨架屏

- [ ] **步骤 3：创建磁盘管理页**

`views/disk/index.vue`：el-tabs（磁盘/挂载点）：
- 磁盘 Tab：lsblk 树形展示（el-table + 缩进），未挂载分区显示「挂载」按钮 → dialog（挂载点输入，白名单提示）
- 挂载点 Tab：df 列表 + 「卸载」按钮（确认弹窗）
- 全部操作带确认与审计提示

- [ ] **步骤 4：创建 Supervisor 页面**

`views/supervisor/index.vue`：未安装 → el-alert + 安装引导（跳商店）；已安装 → 程序列表（状态标签 RUNNING/STOPPED）+ 启停按钮 + 「新建进程」dialog（name/command/directory/user/autostart）+ 删除（确认）

- [ ] **步骤 5：菜单与路由**

layout 菜单追加：「磁盘管理」（/disk，图标 Disk）、「进程守护」（/supervisor，图标 Cpu）；router children 对应。商店条目中的 disk/supervisor 卡片按钮跳转。

- [ ] **步骤 6：验证**

`npx vue-tsc -b` 0 错误；dev server 页面可访问；商店加载骨架屏正常。

- [ ] **步骤 7：Commit** `feat: 前端商店升级与磁盘/进程守护页面`

---

### 任务 A8：真实服务器端到端验证

**约束：** 目标服务器（CentOS 7）运行着用户真实项目。**只读验证**：版本检测、lsblk/df、supervisor 状态、mysql 版本列表。**写操作不做**（安装 PHP/软件、挂载、切换）——留给用户通过界面自行触发；如需验证写操作，先征得用户同意。

- [ ] **步骤 1：重启后端，验证只读接口**

```powershell
# 商店：PHP 多版本条目、Composer、Java、supervisor、disk 卡片数据齐全
# GET /api/servers/<id>/store → php74-83 条目 + composer + java + supervisor + disk
# GET /api/servers/<id>/disk → lsblk/df 真实数据
# GET /api/servers/<id>/supervisor → available（未装则 false + 提示）
# GET /api/servers/<id>/mysql/versions → 已装实例 + 可安装版本
```

- [ ] **步骤 2：前端页面验证**（浏览器：商店骨架屏 → 卡片数据、磁盘页、守护页、Java 切换 UI 显示）
- [ ] **步骤 3：8.1 约束检查**：全部只读命令，服务器零改动
- [ ] **步骤 4：Commit** `chore: 完成批次 A 端到端验证`

---

## 自检记录

- [ ] 规格覆盖度：批次 A 全部 6 项（PHP 多版本/Composer/Java/Supervisor/磁盘/MySQL 多版本）有对应任务
- [ ] 占位符扫描：无 TODO；`<mountPoint>` 等为输入变量
- [ ] 类型一致性：前端 StoreItem.type 与后端条目元数据一致；disk/supervisor API 字段与后端响应一致
