# P1：认证 + 服务器管理 + SSH 连接池 + 监控大盘 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现第一里程碑：JWT 登录、服务器 CRUD（SSH 凭据 AES-256-GCM 加密存储）、SSH 长连接池、监控大盘（CPU/内存/磁盘/网络/负载/系统信息）、数据库管理（MySQL + Redis）、软件商店（8 个常用软件），并连真实服务器 `43.240.221.112` 验证通过。

**架构：** Express 后端（`server/`）+ Vue 3 前端（`apps/web/`）。后端为每台服务器维护常驻 SSH 连接（ssh2），带自动重连、空闲回收、并发队列；数据存本地 JSON（`server/data/`），密码加密；JWT 保护所有 API。

**技术栈：** Node.js 20+、Express 4、ssh2、jsonwebtoken、dotenv、Node 内置 test runner、supertest；Vue 3 + Vite 5 + TypeScript + Element Plus + Pinia + Vue Router + ECharts + axios + Sass。

**设计文档：** `docs/superpowers/specs/2026-08-17-linuxmgr-design.md`（P1 相关：第 3、4、5、6、7、8、8.1、9、10 节）。

**硬性约束（8.1 节）：** 冒烟测试时只执行只读命令；测试痕迹（站点、防火墙规则、回收站）验证后必须清理。

---

## 文件结构

**根目录：**
- 创建：`.gitignore` — 忽略 `node_modules/`、`dist/`、`.env`、`server/data/`、`*.log`
- 创建：`README.md` — 项目说明、目录结构、运行方式、安全约束

**后端 `server/`：**
- 创建：`server/package.json` — 依赖与脚本（start / test）
- 创建：`server/.env.example` — 环境变量模板
- 创建：`server/src/config.js` — 环境变量读取与默认值（含开发默认值警告）
- 创建：`server/src/crypto/cipher.js` — AES-256-GCM 加解密
- 创建：`server/src/auth/jwt.js` — JWT 签发/校验
- 创建：`server/src/auth/middleware.js` — requireAuth 中间件
- 创建：`server/src/store/jsonStore.js` — JSON 原子读写（tmp + rename）
- 创建：`server/src/ssh/exec.js` — 命令执行封装（超时/输出截断/危险命令黑名单）
- 创建：`server/src/ssh/connectionPool.js` — SSH 长连接池（核心）
- 创建：`server/src/utils/sshParser.js` — 监控命令输出解析
- 创建：`server/src/utils/audit.js` — 审计日志
- 创建：`server/src/routes/auth.js` — 登录（含失败限速）
- 创建：`server/src/routes/servers.js` — 服务器 CRUD + 连接测试
- 创建：`server/src/routes/monitor.js` — 监控数据
- 创建：`server/src/routes/database.js` — 数据库管理（MySQL + Redis）
- 创建：`server/src/routes/store.js` — 软件商店
- 创建：`server/src/utils/dbParser.js` — SHOW DATABASES / redis INFO 输出解析
- 创建：`server/src/index.js` — Express 组装与启动
- 测试：`server/test/*.test.js`、`server/test/helpers/fakeClient.js`

**前端 `apps/web/`：**
- 创建：`apps/web/package.json`、`apps/web/vite.config.ts`、`apps/web/tsconfig.json`、`apps/web/tsconfig.node.json`、`apps/web/index.html`、`apps/web/src/env.d.ts`
- 创建：`apps/web/src/main.ts`、`apps/web/src/App.vue`、`apps/web/src/styles/index.scss`
- 创建：`apps/web/src/api/request.ts`、`apps/web/src/api/auth.ts`、`apps/web/src/api/servers.ts`、`apps/web/src/api/monitor.ts`、`apps/web/src/api/database.ts`、`apps/web/src/api/store.ts`
- 创建：`apps/web/src/stores/user.ts`、`apps/web/src/stores/server.ts`
- 创建：`apps/web/src/router/index.ts`
- 创建：`apps/web/src/layout/index.vue`
- 创建：`apps/web/src/views/login/index.vue`、`apps/web/src/views/dashboard/index.vue`、`apps/web/src/views/servers/index.vue`、`apps/web/src/views/databases/index.vue`、`apps/web/src/views/store/index.vue`

---

### 任务 1：项目脚手架与配置

**文件：**
- 创建：`.gitignore`
- 创建：`README.md`
- 创建：`server/package.json`
- 创建：`server/.env.example`
- 创建：`server/src/config.js`
- 测试：`server/test/config.test.js`

- [ ] **步骤 1：创建根目录文件**

`.gitignore`：

```gitignore
node_modules/
dist/
.env
*.log
server/data/
```

`README.md`：

```markdown
# linuxmgr — 服务器管理工具（宝塔风格）

通过 SSH 管理远程 Linux 服务器的 Web 面板：监控大盘、多服务器管理、网站管理、进程与服务、文件管理、安全防护。

## 目录结构

- `server/` — Express 后端（SSH 长连接池、JWT 认证、AES-256-GCM 凭据加密）
- `apps/web/` — Vue 3 + Element Plus 前端（参照 youlai/vue3-element-admin 风格）
- `docs/` — 设计文档与实现计划

## 运行

```bash
# 后端
cd server
npm install
cp .env.example .env   # 填写 JWT_SECRET / MASTER_KEY / ADMIN_PASSWORD
npm start              # http://localhost:3000

# 前端（开发模式）
cd apps/web
npm install
npm run dev            # http://localhost:5173，/api 代理到 3000
```

## 安全约束（重要）

- 不修改服务器上任何已有配置；新增文件统一 `linuxmgr-` 前缀
- 危险命令（rm -rf /、mkfs、reboot 等）被后端拦截
- SSH 密码 AES-256-GCM 加密存储，主密钥来自环境变量 `MASTER_KEY`
```

- [ ] **步骤 2：创建 server/package.json 与 .env.example**

```json
{
  "name": "linuxmgr-server",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "ssh2": "^1.15.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

`.env.example`：

```bash
PORT=3000
JWT_SECRET=change-me
MASTER_KEY=change-me
ADMIN_USER=admin
ADMIN_PASSWORD=change-me
DATA_DIR=./data
```

- [ ] **步骤 3：编写失败的 config 测试**

`server/test/config.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loadConfig 读取环境变量', () => {
  const { config } = loadConfig({
    PORT: '4000',
    JWT_SECRET: 's1',
    MASTER_KEY: 'k1',
    ADMIN_USER: 'boss',
    ADMIN_PASSWORD: 'p1',
    DATA_DIR: '/tmp/d1',
  });
  assert.equal(config.port, 4000);
  assert.equal(config.jwtSecret, 's1');
  assert.equal(config.masterKey, 'k1');
  assert.equal(config.adminUser, 'boss');
  assert.equal(config.adminPassword, 'p1');
  assert.equal(config.dataDir, '/tmp/d1');
});

test('loadConfig 缺失时使用开发默认值并给出警告', () => {
  const { config, warnings } = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.jwtSecret, 'dev-jwt-secret');
  assert.equal(config.masterKey, 'dev-master-key');
  assert.equal(config.adminUser, 'admin');
  assert.equal(config.adminPassword, 'admin123');
  assert.ok(warnings.some((w) => w.includes('JWT_SECRET')));
  assert.ok(warnings.some((w) => w.includes('MASTER_KEY')));
  assert.ok(warnings.some((w) => w.includes('ADMIN_PASSWORD')));
});
```

- [ ] **步骤 4：运行测试验证失败**

运行：`node --test test/config.test.js`（在 `server/` 下，先 `npm install`）
预期：FAIL，报错 `Cannot find module '../src/config'`

- [ ] **步骤 5：实现 config.js**

`server/src/config.js`：

```js
const path = require('path');

function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3000),
    jwtSecret: env.JWT_SECRET || '',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '24h',
    masterKey: env.MASTER_KEY || '',
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  };
  const warnings = [];
  if (!config.jwtSecret) {
    config.jwtSecret = 'dev-jwt-secret';
    warnings.push('JWT_SECRET 未设置，使用开发默认值 dev-jwt-secret');
  }
  if (!config.masterKey) {
    config.masterKey = 'dev-master-key';
    warnings.push('MASTER_KEY 未设置，使用开发默认值 dev-master-key（生产必须设置）');
  }
  if (!config.adminPassword) {
    config.adminPassword = 'admin123';
    warnings.push('ADMIN_PASSWORD 未设置，使用开发默认值 admin123');
  }
  return { config, warnings };
}

module.exports = { loadConfig };
```

- [ ] **步骤 6：运行测试验证通过**

运行：`node --test test/config.test.js`
预期：PASS（2 个测试）

- [ ] **步骤 7：Commit**

```bash
git add .gitignore README.md server/package.json server/.env.example server/src/config.js server/test/config.test.js
git commit -m "chore: 项目脚手架与配置模块"
```

---

### 任务 2：AES-256-GCM 加解密模块

**文件：**
- 创建：`server/src/crypto/cipher.js`
- 测试：`server/test/cipher.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/cipher.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt } = require('../src/crypto/cipher');

test('加解密往返一致', () => {
  const payload = encrypt('MyP@ssw0rd!', 'master-key-1');
  assert.notEqual(payload, 'MyP@ssw0rd!');
  assert.equal(decrypt(payload, 'master-key-1'), 'MyP@ssw0rd!');
});

test('相同明文不同 IV，密文不同', () => {
  const a = encrypt('same', 'k');
  const b = encrypt('same', 'k');
  assert.notEqual(a, b);
});

test('错误主密钥解密抛错', () => {
  const payload = encrypt('secret', 'right');
  assert.throws(() => decrypt(payload, 'wrong'), /Unsupported state or unable to authenticate data/);
});

test('密文被篡改后解密抛错', () => {
  const payload = encrypt('secret', 'k');
  const parts = payload.split('.');
  const tampered = parts[0] + '.AAAA' + parts[0].slice(4) + '.' + parts[2];
  assert.throws(() => decrypt(tampered, 'k'));
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/cipher.test.js`
预期：FAIL，`Cannot find module '../src/crypto/cipher'`

- [ ] **步骤 3：实现 cipher.js**

`server/src/crypto/cipher.js`：

```js
const crypto = require('crypto');

// 返回格式: base64(iv).base64(authTag).base64(data)
function encrypt(plainText, masterKey) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload, masterKey) {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/cipher.test.js`
预期：PASS（4 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/crypto/cipher.js server/test/cipher.test.js
git commit -m "feat: AES-256-GCM 凭据加解密模块"
```

---

### 任务 3：JWT 模块与认证中间件

**文件：**
- 创建：`server/src/auth/jwt.js`
- 创建：`server/src/auth/middleware.js`
- 测试：`server/test/jwt.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/jwt.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken } = require('../src/auth/jwt');
const { requireAuth } = require('../src/auth/middleware');

test('签发与校验往返', () => {
  const token = signToken({ username: 'admin', role: 'admin' }, 'secret', '1h');
  const payload = verifyToken(token, 'secret');
  assert.equal(payload.username, 'admin');
  assert.equal(payload.role, 'admin');
});

test('错误密钥校验失败', () => {
  const token = signToken({ username: 'admin' }, 'a', '1h');
  assert.throws(() => verifyToken(token, 'b'));
});

test('过期令牌校验失败', async () => {
  const token = signToken({ username: 'admin' }, 'secret', '1ms');
  await new Promise((r) => setTimeout(r, 20));
  assert.throws(() => verifyToken(token, 'secret'));
});

test('requireAuth 无令牌返回 401', () => {
  const middleware = requireAuth({ jwtSecret: 'secret' });
  const req = { headers: {} };
  const res = { status: (c) => ({ json: (b) => { res._status = c; res._body = b; } }) };
  middleware(req, res, () => { throw new Error('不应进入 next'); });
  assert.equal(res._status, 401);
  assert.equal(res._body.code, 401);
});

test('requireAuth 有效令牌放行并注入 req.user', () => {
  const middleware = requireAuth({ jwtSecret: 'secret' });
  const token = signToken({ username: 'admin' }, 'secret', '1h');
  const req = { headers: { authorization: `Bearer ${token}` } };
  let passed = false;
  middleware(req, {}, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.user.username, 'admin');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/jwt.test.js`
预期：FAIL，`Cannot find module '../src/auth/jwt'`

- [ ] **步骤 3：实现 jwt.js 与 middleware.js**

`server/src/auth/jwt.js`：

```js
const jwt = require('jsonwebtoken');

function signToken(payload, secret, expiresIn) {
  return jwt.sign(payload, secret, { expiresIn });
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

module.exports = { signToken, verifyToken };
```

`server/src/auth/middleware.js`：

```js
const { verifyToken } = require('./jwt');

function requireAuth(config) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ code: 401, message: '未登录或令牌缺失' });
    }
    try {
      req.user = verifyToken(token, config.jwtSecret);
      next();
    } catch {
      return res.status(401).json({ code: 401, message: '令牌无效或已过期' });
    }
  };
}

module.exports = { requireAuth };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/jwt.test.js`
预期：PASS（5 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/auth/jwt.js server/src/auth/middleware.js server/test/jwt.test.js
git commit -m "feat: JWT 签发校验与认证中间件"
```

---

### 任务 4：JSON 原子存储

**文件：**
- 创建：`server/src/store/jsonStore.js`
- 测试：`server/test/jsonStore.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/jsonStore.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/store/jsonStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-'));
}

test('无文件时返回默认值', () => {
  const store = new JsonStore(tmpDir(), 'servers.json', []);
  assert.deepEqual(store.read(), []);
});

test('写入后可读回，且无残留 tmp 文件', () => {
  const dir = tmpDir();
  const store = new JsonStore(dir, 'servers.json', []);
  store.write([{ id: '1', name: 'web' }]);
  assert.deepEqual(store.read(), [{ id: '1', name: 'web' }]);
  const files = fs.readdirSync(dir);
  assert.ok(!files.some((f) => f.endsWith('.tmp')));
});

test('文件损坏时抛出明确错误', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'servers.json'), '{bad json');
  const store = new JsonStore(dir, 'servers.json', []);
  assert.throws(() => store.read(), SyntaxError);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/jsonStore.test.js`
预期：FAIL，`Cannot find module '../src/store/jsonStore'`

- [ ] **步骤 3：实现 jsonStore.js**

`server/src/store/jsonStore.js`：

```js
const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(dataDir, name, defaults = []) {
    this.file = path.join(dataDir, name);
    this.defaults = defaults;
  }

  read() {
    if (!fs.existsSync(this.file)) return structuredClone(this.defaults);
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/jsonStore.test.js`
预期：PASS（3 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/store/jsonStore.js server/test/jsonStore.test.js
git commit -m "feat: JSON 原子读写存储"
```

---

### 任务 5：SSH 命令执行封装（危险命令黑名单 + 超时 + 输出截断）

**文件：**
- 创建：`server/src/ssh/exec.js`
- 测试：`server/test/exec.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/exec.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { assertCommandSafe, run } = require('../src/ssh/exec');

function fakeStream({ stdout = 'hello', stderr = '', code = 0 } = {}) {
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  setTimeout(() => {
    stream.emit('data', Buffer.from(stdout));
    stream.stderr.emit('data', Buffer.from(stderr));
    stream.emit('close', code);
  }, 5);
  return stream;
}

function fakeClient() {
  return {
    exec(command, cb) {
      cb(null, fakeStream());
    },
    destroy() { this.destroyed = true; },
  };
}

test('危险命令被拦截', () => {
  assert.throws(() => assertCommandSafe('rm -rf /'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('mkfs.ext4 /dev/sda1'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('reboot'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('dd if=/dev/zero of=/dev/sda'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('shutdown -h now'), /安全策略拦截/);
});

test('安全命令放行', () => {
  assert.doesNotThrow(() => assertCommandSafe('uptime'));
  assert.doesNotThrow(() => assertCommandSafe('free -m'));
  assert.doesNotThrow(() => assertCommandSafe('ls -la /etc/nginx'));
  assert.doesNotThrow(() => assertCommandSafe('rm -rf /tmp/linuxmgr-trash/test'));
});

test('run 返回退出码与输出', async () => {
  const result = await run(fakeClient(), 'uptime');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
});

test('run 超时后销毁连接并拒绝', async () => {
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  const client = {
    exec(command, cb) { cb(null, stream); },
    destroy() { this.destroyed = true; },
  };
  await assert.rejects(
    run(client, 'sleep 100', { timeoutMs: 30 }),
    /执行超时/
  );
  assert.equal(client.destroyed, true);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/exec.test.js`
预期：FAIL，`Cannot find module '../src/ssh/exec'`

- [ ] **步骤 3：实现 exec.js**

`server/src/ssh/exec.js`：

```js
// 危险命令黑名单：命中即拒绝（硬性约束 8.1 第 5 条）
const DANGER_PATTERNS = [
  /\brm\s+-rf\s+(\/|\/\*)/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /:\s*\(\s*\)\s*\{/,
  /\bchmod\s+(-R\s+)?777\s+\//,
  /\binit\s+0\b/,
];

function assertCommandSafe(command) {
  for (const pattern of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`命令被安全策略拦截（命中危险模式: ${pattern}）`);
    }
  }
}

function run(client, command, { timeoutMs = 15000, maxOutput = 512 * 1024 } = {}) {
  assertCommandSafe(command);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { client.destroy(); } catch { /* 连接可能已断开 */ }
      reject(new Error(`命令执行超时（${timeoutMs}ms）: ${command.slice(0, 80)}`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      stream.on('data', (d) => {
        if (stdout.length < maxOutput) stdout += d.toString();
      });
      stream.stderr.on('data', (d) => {
        if (stderr.length < maxOutput) stderr += d.toString();
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  });
}

module.exports = { assertCommandSafe, run };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/exec.test.js`
预期：PASS（4 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/ssh/exec.js server/test/exec.test.js
git commit -m "feat: SSH 命令执行封装与危险命令黑名单"
```

---

### 任务 6：SSH 长连接池（核心）

**文件：**
- 创建：`server/src/ssh/connectionPool.js`
- 测试：`server/test/connectionPool.test.js`
- 测试：`server/test/helpers/fakeClient.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/helpers/fakeClient.js`：

```js
const { EventEmitter } = require('node:events');

class FakeClient extends EventEmitter {
  constructor({ connectDelay = 5 } = {}) {
    super();
    this.connectDelay = connectDelay;
    this.connectCount = 0;
    this.execCount = 0;
    this.destroyed = false;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  connect() {
    this.connectCount += 1;
    setTimeout(() => {
      if (this.destroyed) return;
      this.emit('ready');
    }, this.connectDelay);
  }

  exec(command, cb) {
    this.execCount += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const stream = new EventEmitter();
    stream.stderr = new EventEmitter();
    setTimeout(() => {
      stream.emit('data', Buffer.from(`out:${command}`));
      stream.stderr.emit('data', Buffer.from(''));
      stream.emit('close', 0);
      this.inFlight -= 1;
    }, 5);
    cb(null, stream);
  }

  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('close');
    }
  }
}

module.exports = { FakeClient };
```

`server/test/connectionPool.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionPool } = require('../src/ssh/connectionPool');
const { FakeClient } = require('./helpers/fakeClient');

const CFG = { host: '10.0.0.1', port: 22, username: 'root', password: 'p' };

function makePool(overrides = {}) {
  let instance = null;
  const pool = new ConnectionPool({
    clientFactory: () => {
      instance = new FakeClient();
      return instance;
    },
    connectTimeoutMs: 1000,
    reconnectAttempts: 1,
    ...overrides,
  });
  return { pool, getClient: () => instance };
}

test('getConnection 建立连接并复用同一客户端', async () => {
  const { pool, getClient } = makePool();
  const entry1 = await pool.getConnection(CFG);
  const client1 = getClient();
  assert.equal(entry1.ready, true);
  const entry2 = await pool.getConnection(CFG);
  assert.equal(getClient(), client1, '应复用同一连接');
  assert.equal(client1.connectCount, 1);
  pool.closeKey(CFG);
});

test('连接断开后自动重连', async () => {
  const { pool, getClient } = makePool();
  const entry = await pool.getConnection(CFG);
  const client1 = getClient();
  pool.release(entry); // busy 归零后断开才会触发后台重连
  client1.emit('close');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(getClient().connectCount, 2, '应自动重新连接');
  pool.closeKey(CFG);
});

test('并发超过 maxConcurrent 时排队', async () => {
  const { pool, getClient } = makePool({ maxConcurrent: 2 });
  const results = await Promise.all([
    pool.run(CFG, 'a'),
    pool.run(CFG, 'b'),
    pool.run(CFG, 'c'),
    pool.run(CFG, 'd'),
  ]);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.code === 0));
  assert.ok(getClient().maxInFlight <= 2, '同时执行的命令不应超过 2 条');
  pool.closeKey(CFG);
});

test('空闲超时后销毁连接', async () => {
  const { pool, getClient } = makePool({ idleTimeoutMs: 30 });
  const entry = await pool.getConnection(CFG);
  const client = getClient();
  pool.release(entry); // 释放后开始计时空闲回收
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(client.destroyed, true, '空闲连接应被回收');
  pool.closeKey(CFG);
});

test('run 执行命令并返回输出', async () => {
  const { pool, getClient } = makePool();
  const result = await pool.run(CFG, 'uptime');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'out:uptime');
  assert.equal(getClient().execCount, 1);
  pool.closeKey(CFG);
});

test('连接失败抛出明确错误', async () => {
  const { pool } = makePool({ clientFactory: () => new FakeClient() });
  // 用永不 ready 的客户端模拟连接失败
  const badPool = new ConnectionPool({
    clientFactory: () => {
      const c = new FakeClient({ connectDelay: 1000 });
      c.connect = () => { /* 永不 ready */ };
      return c;
    },
    connectTimeoutMs: 50,
    reconnectAttempts: 1,
  });
  await assert.rejects(badPool.getConnection(CFG), /SSH 连接失败/);
  pool.closeKey(CFG);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/connectionPool.test.js`
预期：FAIL，`Cannot find module '../src/ssh/connectionPool'`

- [ ] **步骤 3：实现 connectionPool.js**

`server/src/ssh/connectionPool.js`：

```js
const { Client } = require('ssh2');
const { run } = require('./exec');

class ConnectionPool {
  constructor(opts = {}) {
    this.clientFactory = opts.clientFactory || (() => new Client());
    this.maxConcurrent = opts.maxConcurrent || 4;
    this.idleTimeoutMs = opts.idleTimeoutMs || 10 * 60 * 1000;
    this.reconnectAttempts = opts.reconnectAttempts || 2;
    this.connectTimeoutMs = opts.connectTimeoutMs || 15000;
    this.logger = opts.logger || console;
    this.entries = new Map(); // key -> entry
  }

  keyFor(cfg) {
    return `${cfg.host}:${cfg.port}:${cfg.username}`;
  }

  async getConnection(cfg) {
    const key = this.keyFor(cfg);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        cfg,
        client: null,
        ready: false,
        busy: 0,
        connectAttempts: 0,
        idleTimer: null,
        waiters: [],
        lastUsed: 0,
      };
      this.entries.set(key, entry);
    }
    if (!entry.ready) await this.connect(entry);
    entry.busy += 1;
    if (entry.busy > this.maxConcurrent) {
      await new Promise((resolve) => entry.waiters.push(resolve));
    }
    entry.lastUsed = Date.now();
    this.clearIdleTimer(entry);
    return entry;
  }

  async connect(entry) {
    while (entry.connectAttempts <= this.reconnectAttempts) {
      entry.connectAttempts += 1;
      try {
        const client = this.clientFactory();
        const ok = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), this.connectTimeoutMs);
          client.once('ready', () => { clearTimeout(timer); resolve(true); });
          client.once('error', () => { clearTimeout(timer); resolve(false); });
          client.connect({
            host: entry.cfg.host,
            port: entry.cfg.port,
            username: entry.cfg.username,
            password: entry.cfg.password,
            keepaliveInterval: 60000,
            readyTimeout: this.connectTimeoutMs,
          });
        });
        if (!ok) {
          try { client.destroy(); } catch { /* noop */ }
          continue;
        }
        entry.client = client;
        entry.ready = true;
        entry.connectAttempts = 0;
        client.on('close', () => this.onClose(entry));
        client.on('error', () => { /* 错误由 close 统一处理 */ });
        return;
      } catch (err) {
        this.logger.warn(`[pool] connect failed ${entry.key}: ${err.message}`);
      }
    }
    throw new Error(`SSH 连接失败（已重试 ${this.reconnectAttempts} 次）: ${entry.key}`);
  }

  onClose(entry) {
    if (!entry.ready) return;
    entry.ready = false;
    entry.client = null;
    this.logger.warn(`[pool] connection closed: ${entry.key}`);
    if (entry.busy === 0) {
      this.connect(entry).catch((err) => {
        this.logger.warn(`[pool] reconnect failed: ${err.message}`);
      });
    }
  }

  release(entry) {
    entry.busy -= 1;
    entry.lastUsed = Date.now();
    while (entry.busy < this.maxConcurrent && entry.waiters.length > 0) {
      entry.waiters.shift()();
    }
    this.scheduleIdleReap(entry);
  }

  scheduleIdleReap(entry) {
    this.clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.busy === 0 && entry.ready && Date.now() - entry.lastUsed >= this.idleTimeoutMs) {
        this.logger.info(`[pool] idle reap: ${entry.key}`);
        try { entry.client.destroy(); } catch { /* noop */ }
      }
    }, this.idleTimeoutMs);
  }

  clearIdleTimer(entry) {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  async run(cfg, command, opts) {
    const entry = await this.getConnection(cfg);
    try {
      return await run(entry.client, command, opts);
    } finally {
      this.release(entry);
    }
  }

  closeKey(cfg) {
    const key = this.keyFor(cfg);
    const entry = this.entries.get(key);
    if (entry) {
      this.clearIdleTimer(entry);
      if (entry.client) {
        try { entry.client.destroy(); } catch { /* noop */ }
      }
      this.entries.delete(key);
    }
  }

  closeAll() {
    for (const entry of this.entries.values()) {
      this.clearIdleTimer(entry);
      if (entry.client) {
        try { entry.client.destroy(); } catch { /* noop */ }
      }
    }
    this.entries.clear();
  }
}

module.exports = { ConnectionPool };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/connectionPool.test.js`
预期：PASS（6 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/ssh/connectionPool.js server/test/connectionPool.test.js server/test/helpers/fakeClient.js
git commit -m "feat: SSH 长连接池（自动重连/空闲回收/并发队列）"
```

---

### 任务 7：监控数据解析

**文件：**
- 创建：`server/src/utils/sshParser.js`
- 测试：`server/test/sshParser.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/sshParser.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMonitorOutput } = require('../src/utils/sshParser');

const SAMPLE = `===CPU===
top - 12:00:01 up 10 days,  3:42,  1 user,  load average: 0.15, 0.20, 0.18
Tasks: 123 total,   1 running, 122 sleeping,   0 stopped,   0 zombie
%Cpu(s):  2.3 us,  0.7 sy,  0.0 ni, 96.7 id,  0.0 wa,  0.3 hi,  0.0 si,  0.0 st
===MEM===
              total        used        free      shared  buff/cache   available
Mem:           7821        2043         412         233        5365        5432
Swap:          2047           0        2047
===DISK===
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        40G   12G   27G  31% /
tmpfs           392M     0  392M   0% /dev/shm
===UPTIME===
 12:00:01 up 10 days,  3:42,  1 user,  load average: 0.15, 0.20, 0.18
===NET===
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 123456789  100000    0    0    0     0          0         0 987654321   200000    0    0    0     0       0          0
    lo:  12345    100    0    0    0     0          0         0  12345    100    0    0    0     0       0          0
===SYS===
Linux vm-xxx 5.15.0-91-generic #101-Ubuntu SMP Fri Nov 3 11:24:08 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux
NAME="Ubuntu"
VERSION="20.04.6 LTS (Focal Fossa)"`;

test('解析完整监控输出', () => {
  const data = parseMonitorOutput(SAMPLE);
  assert.equal(data.cpu.us, 2.3);
  assert.equal(data.cpu.sy, 0.7);
  assert.equal(data.cpu.id, 96.7);
  assert.deepEqual(data.load, [0.15, 0.2, 0.18]);
  assert.equal(data.mem.totalMB, 7821);
  assert.equal(data.mem.usedMB, 2043);
  assert.equal(data.mem.percent, 26);
  assert.equal(data.disk.length, 1, '应过滤 tmpfs 等伪文件系统');
  assert.equal(data.disk[0].mount, '/');
  assert.equal(data.disk[0].percent, 31);
  assert.equal(data.net.rxBytes, 123456789);
  assert.equal(data.net.txBytes, 987654321);
  assert.equal(data.uptimeSec, 10 * 86400 + 3 * 3600 + 42 * 60);
  assert.equal(data.os, 'Ubuntu 20.04.6 LTS (Focal Fossa)');
});

test('空输出返回空结构', () => {
  const data = parseMonitorOutput('');
  assert.equal(data.cpu.us, 0);
  assert.equal(data.mem.totalMB, 0);
  assert.deepEqual(data.disk, []);
  assert.deepEqual(data.load, [0, 0, 0]);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/sshParser.test.js`
预期：FAIL，`Cannot find module '../src/utils/sshParser'`

- [ ] **步骤 3：实现 sshParser.js**

`server/src/utils/sshParser.js`：

```js
function section(output, name) {
  const m = output.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?=\\n===|$)`));
  return m ? m[1] : '';
}

function parseCpu(text) {
  const cpu = { us: 0, sy: 0, id: 100 };
  const m = text.match(/%Cpu\(s\):\s+([\d.]+)\s+us,\s+([\d.]+)\s+sy,[\s\S]*?([\d.]+)\s+id/);
  if (m) {
    cpu.us = parseFloat(m[1]);
    cpu.sy = parseFloat(m[2]);
    cpu.id = parseFloat(m[3]);
  }
  return cpu;
}

function parseLoad(text) {
  const m = text.match(/load average:\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
  if (!m) return [0, 0, 0];
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function parseUptime(text) {
  // "up 10 days,  3:42" 或 "up 3:42" 或 "up 1 min"
  const m = text.match(/up\s+(\d+)\s+days?,\s+(\d+):(\d+)/) || text.match(/up\s+(\d+):(\d+)/);
  if (m) {
    const days = m.length === 4 ? parseInt(m[1], 10) : 0;
    const h = m.length === 4 ? parseInt(m[2], 10) : parseInt(m[1], 10);
    const min = m.length === 4 ? parseInt(m[3], 10) : parseInt(m[2], 10);
    return days * 86400 + h * 3600 + min * 60;
  }
  return 0;
}

function parseMem(text) {
  const m = text.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)/);
  if (!m) return { totalMB: 0, usedMB: 0, availMB: 0, percent: 0 };
  const total = parseInt(m[1], 10);
  const used = parseInt(m[2], 10);
  const avail = parseInt(m[5], 10);
  return {
    totalMB: total,
    usedMB: used,
    availMB: avail,
    percent: total ? Math.round((used / total) * 100) : 0,
  };
}

function parseDisk(text) {
  const lines = text.split('\n').filter((l) => /^\//.test(l.trim()));
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      fs: parts[0],
      size: parts[1],
      used: parts[2],
      percent: parseInt(parts[4].replace('%', ''), 10),
      mount: parts[5],
    };
  });
}

function parseNet(text) {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\w+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (m && m[1] !== 'lo') {
      rx += parseInt(m[2], 10);
      tx += parseInt(m[3], 10);
    }
  }
  return { rxBytes: rx, txBytes: tx };
}

function parseOs(text) {
  const name = text.match(/NAME="?([^"\n]+)"?/);
  const version = text.match(/VERSION="?([^"\n]+)"?/);
  if (name && version) return `${name[1]} ${version[1]}`;
  return (name && name[1]) || 'Unknown';
}

function parseMonitorOutput(output) {
  const cpuText = section(output, 'CPU');
  return {
    cpu: parseCpu(cpuText),
    load: parseLoad(cpuText + section(output, 'UPTIME')),
    mem: parseMem(section(output, 'MEM')),
    disk: parseDisk(section(output, 'DISK')),
    net: parseNet(section(output, 'NET')),
    uptimeSec: parseUptime(section(output, 'UPTIME')),
    os: parseOs(section(output, 'SYS')),
  };
}

module.exports = { parseMonitorOutput };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/sshParser.test.js`
预期：PASS（2 个测试）

- [ ] **步骤 5：Commit**

```bash
git add server/src/utils/sshParser.js server/test/sshParser.test.js
git commit -m "feat: 监控输出解析器（CPU/内存/磁盘/网络/负载/系统信息）"
```

---

### 任务 8：审计日志

**文件：**
- 创建：`server/src/utils/audit.js`
- 测试：`server/test/audit.test.js`

- [ ] **步骤 1：编写失败的测试**

`server/test/audit.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit } = require('../src/utils/audit');

test('audit 追加 JSON 行并可读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-'));
  audit(dir, { action: 'server.create', target: '10.0.0.1', result: 'success' });
  audit(dir, { action: 'login', target: '127.0.0.1', result: 'fail' });
  const lines = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.action, 'server.create');
  assert.ok(first.time);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/audit.test.js`
预期：FAIL，`Cannot find module '../src/utils/audit'`

- [ ] **步骤 3：实现 audit.js**

`server/src/utils/audit.js`：

```js
const fs = require('node:fs');
const path = require('node:path');

function audit(dataDir, entry) {
  fs.mkdirSync(dataDir, { recursive: true });
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  fs.appendFileSync(path.join(dataDir, 'audit.log'), `${line}\n`, 'utf8');
}

module.exports = { audit };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/audit.test.js`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add server/src/utils/audit.js server/test/audit.test.js
git commit -m "feat: 审计日志（所有写操作记录）"
```

---

### 任务 9：路由与 Express 组装（含集成测试）

**文件：**
- 创建：`server/src/routes/auth.js`
- 创建：`server/src/routes/servers.js`
- 创建：`server/src/routes/monitor.js`
- 创建：`server/src/index.js`
- 测试：`server/test/api.test.js`

- [ ] **步骤 1：编写失败的集成测试**

`server/test/api.test.js`：

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

function fakePool() {
  return {
    run: async () => ({ code: 0, stdout: 'ok\nLinux 5.15.0-generic', stderr: '' }),
    closeKey: () => {},
  };
}

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-api-'));
  const { config } = loadConfig({
    JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir,
  });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  const app = createApp({ config, pool: fakePool(), stores });
  return { app, stores };
}

async function login(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return res.body.data.token;
}

test('登录成功返回 token，错误密码 401', async () => {
  const { app } = setup();
  const ok = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.token);
  const bad = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' });
  assert.equal(bad.status, 401);
});

test('登录失败 5 次后锁定 15 分钟', async () => {
  const { app } = setup();
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
  }
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  assert.equal(res.status, 429);
});

test('未带令牌访问受保护接口返回 401', async () => {
  const { app } = setup();
  const res = await request(app).get('/api/servers');
  assert.equal(res.status, 401);
});

test('服务器 CRUD 全流程（密码加密存储、响应不含明文）', async () => {
  const { app, stores } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };

  const created = await request(app).post('/api/servers').set(auth).send({
    name: '测试机', host: '43.240.221.112', port: 22, username: 'root', password: 'Secret123',
  });
  assert.equal(created.status, 200);
  const id = created.body.data.id;
  assert.equal(created.body.data.hasPassword, true);
  assert.ok(!('password' in created.body.data), '响应不得包含明文密码');
  assert.ok(!('passwordEnc' in created.body.data), '响应不得包含密文');

  const raw = JSON.parse(fs.readFileSync(stores.servers.file, 'utf8'));
  assert.notEqual(raw[0].passwordEnc, 'Secret123');
  assert.ok(raw[0].passwordEnc.includes('.'), '应为 iv.tag.data 三段式密文');

  const list = await request(app).get('/api/servers').set(auth);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].name, '测试机');

  const upd = await request(app).put(`/api/servers/${id}`).set(auth).send({
    name: '改名机', host: '43.240.221.112', port: 22, username: 'root', password: 'NewPass456',
  });
  assert.equal(upd.body.data.name, '改名机');

  const testRes = await request(app).post(`/api/servers/${id}/test`).set(auth);
  assert.equal(testRes.body.data.ok, true);
  assert.ok(testRes.body.data.uname.includes('Linux'));

  const mon = await request(app).get(`/api/servers/${id}/monitor`).set(auth);
  assert.equal(mon.status, 200);

  await request(app).delete(`/api/servers/${id}`).set(auth);
  const list2 = await request(app).get('/api/servers').set(auth);
  assert.equal(list2.body.data.length, 0);
});

test('非法服务器参数返回 400', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).post('/api/servers').set(auth)
    .send({ name: 'x', host: '', port: 99999, username: '', password: 'p' });
  assert.equal(res.status, 400);
});

test('不存在的服务器返回 404', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).delete('/api/servers/no-such-id').set(auth);
  assert.equal(res.status, 404);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm install` 安装 supertest 后执行 `node --test test/api.test.js`
预期：FAIL，`Cannot find module '../src/index'`

- [ ] **步骤 3：实现路由**

`server/src/routes/auth.js`：

```js
const express = require('express');
const crypto = require('node:crypto');
const { signToken } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');
const { audit } = require('../utils/audit');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function createAuthRouter({ config }) {
  const router = express.Router();
  const failures = new Map(); // ip -> { fails, lockedUntil }

  router.post('/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = failures.get(ip);
    if (rec && rec.lockedUntil && rec.lockedUntil > now) {
      return res.status(429).json({ code: 429, message: '登录失败次数过多，已锁定 15 分钟' });
    }
    const { username, password } = req.body || {};
    const ok = username === config.adminUser && safeEqual(password || '', config.adminPassword);
    if (!ok) {
      const next = { fails: (rec ? rec.fails : 0) + 1, lockedUntil: null };
      if (next.fails >= 5) {
        next.lockedUntil = now + 15 * 60 * 1000;
        next.fails = 0;
      }
      failures.set(ip, next);
      audit(config.dataDir, { action: 'login', target: ip, detail: `user=${username}`, result: 'fail' });
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    failures.delete(ip);
    const token = signToken({ username, role: 'admin' }, config.jwtSecret, config.jwtExpiresIn);
    audit(config.dataDir, { action: 'login', target: ip, detail: `user=${username}`, result: 'success' });
    res.json({ code: 0, data: { token, username, role: 'admin' } });
  });

  router.get('/me', requireAuth(config), (req, res) => {
    res.json({ code: 0, data: req.user });
  });

  return router;
}

module.exports = createAuthRouter;
```

`server/src/routes/servers.js`：

```js
const express = require('express');
const crypto = require('node:crypto');
const { encrypt, decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const NAME_RE = /^[\w\u4e00-\u9fa5 ._-]{1,50}$/;
const HOST_RE = /^[a-zA-Z0-9.\-:[\]]{1,255}$/;

function createServersRouter({ config, pool, store }) {
  const router = express.Router();

  const all = () => store.read();
  const find = (id) => all().find((s) => s.id === id);
  const mask = (s) => ({
    id: s.id, name: s.name, host: s.host, port: s.port,
    username: s.username, hasPassword: true, createdAt: s.createdAt,
  });

  function validate(body, { requirePassword }) {
    if (!body.name || !NAME_RE.test(body.name)) return '名称不合法（1-50 位中文/字母/数字/._-空格）';
    if (!body.host || !HOST_RE.test(body.host)) return '主机地址不合法';
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须为 1-65535';
    if (!body.username) return '用户名不能为空';
    if (requirePassword && !body.password) return '密码不能为空';
    return null;
  }

  function decryptPassword(server, res) {
    try {
      return decrypt(server.passwordEnc, config.masterKey);
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return null;
    }
  }

  router.get('/', (req, res) => {
    res.json({ code: 0, data: all().map(mask) });
  });

  router.post('/', (req, res) => {
    const err = validate(req.body || {}, { requirePassword: true });
    if (err) return res.status(400).json({ code: 400, message: err });
    const server = {
      id: crypto.randomUUID(),
      name: req.body.name.trim(),
      host: req.body.host.trim(),
      port: Number(req.body.port),
      username: req.body.username.trim(),
      passwordEnc: encrypt(req.body.password, config.masterKey),
      createdAt: new Date().toISOString(),
    };
    const list = all();
    list.push(server);
    store.write(list);
    audit(config.dataDir, { action: 'server.create', target: server.host, detail: server.name, result: 'success' });
    res.json({ code: 0, data: mask(server) });
  });

  router.put('/:id', (req, res) => {
    const list = all();
    const idx = list.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const err = validate(req.body || {}, { requirePassword: false });
    if (err) return res.status(400).json({ code: 400, message: err });
    const next = {
      ...list[idx],
      name: req.body.name.trim(),
      host: req.body.host.trim(),
      port: Number(req.body.port),
      username: req.body.username.trim(),
    };
    if (req.body.password) next.passwordEnc = encrypt(req.body.password, config.masterKey);
    list[idx] = next;
    store.write(list);
    audit(config.dataDir, { action: 'server.update', target: next.host, detail: next.name, result: 'success' });
    res.json({ code: 0, data: mask(next) });
  });

  router.delete('/:id', (req, res) => {
    const list = all();
    const idx = list.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const [removed] = list.splice(idx, 1);
    store.write(list);
    pool.closeKey(removed);
    audit(config.dataDir, { action: 'server.delete', target: removed.host, detail: removed.name, result: 'success' });
    res.json({ code: 0, data: null });
  });

  router.post('/:id/test', async (req, res) => {
    const server = find(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const password = decryptPassword(server, res);
    if (password === null) return;
    const cfg = { host: server.host, port: server.port, username: server.username, password };
    try {
      const result = await pool.run(cfg, 'echo ok && uname -sr');
      if (result.code !== 0) throw new Error(`命令退出码 ${result.code}: ${result.stderr.slice(0, 200)}`);
      const uname = result.stdout.trim().replace(/^ok\s*\n?/, '');
      audit(config.dataDir, { action: 'server.test', target: server.host, result: 'success' });
      res.json({ code: 0, data: { ok: true, uname } });
    } catch (err) {
      audit(config.dataDir, { action: 'server.test', target: server.host, result: 'fail', detail: err.message });
      res.status(502).json({ code: 502, message: `连接失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createServersRouter;
```

`server/src/routes/monitor.js`：

```js
const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { parseMonitorOutput } = require('../utils/sshParser');

// 只读命令集合（硬性约束 8.1：冒烟测试只执行只读命令）
const MONITOR_CMD = [
  "echo '===CPU==='; top -bn1 | head -3",
  "echo '===MEM==='; free -m",
  "echo '===DISK==='; df -h -x tmpfs -x devtmpfs -x overlay",
  "echo '===UPTIME==='; uptime",
  "echo '===NET==='; cat /proc/net/dev",
  "echo '===SYS==='; uname -r; head -2 /etc/os-release",
].join('; ');

function createMonitorRouter({ config, pool, store }) {
  const router = express.Router();
  const lastNet = new Map(); // serverId -> { rxBytes, txBytes, at }

  router.get('/servers/:id/monitor', async (req, res) => {
    const server = store.read().find((s) => s.id === req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    let password;
    try {
      password = decrypt(server.passwordEnc, config.masterKey);
    } catch {
      return res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
    }
    const cfg = { host: server.host, port: server.port, username: server.username, password };
    try {
      const result = await pool.run(cfg, MONITOR_CMD, { timeoutMs: 20000 });
      if (result.code !== 0) throw new Error(`命令退出码 ${result.code}: ${result.stderr.slice(0, 200)}`);
      const raw = parseMonitorOutput(result.stdout);

      const now = Date.now();
      const prev = lastNet.get(server.id);
      let rxRate = 0;
      let txRate = 0;
      if (prev && now > prev.at) {
        rxRate = Math.max(0, Math.round((raw.net.rxBytes - prev.rxBytes) / ((now - prev.at) / 1000)));
        txRate = Math.max(0, Math.round((raw.net.txBytes - prev.txBytes) / ((now - prev.at) / 1000)));
      }
      lastNet.set(server.id, { rxBytes: raw.net.rxBytes, txBytes: raw.net.txBytes, at: now });

      res.json({
        code: 0,
        data: { ...raw, net: { rxBytes: raw.net.rxBytes, txBytes: raw.net.txBytes, rxRate, txRate } },
      });
    } catch (err) {
      res.status(502).json({ code: 502, message: `监控获取失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createMonitorRouter;
```

`server/src/index.js`：

```js
require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { loadConfig } = require('./config');
const { requireAuth } = require('./auth/middleware');
const { JsonStore } = require('./store/jsonStore');
const { ConnectionPool } = require('./ssh/connectionPool');
const createAuthRouter = require('./routes/auth');
const createServersRouter = require('./routes/servers');
const createMonitorRouter = require('./routes/monitor');

function createApp({ config, pool, stores }) {
  const app = express();
  app.use(express.json());

  app.use('/api/auth', createAuthRouter({ config }));
  app.use('/api', requireAuth(config), createMonitorRouter({ config, pool, store: stores.servers }));
  app.use('/api/servers', requireAuth(config), createServersRouter({ config, pool, store: stores.servers }));

  const webDist = path.join(__dirname, '..', '..', 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', (req, res) => res.status(404).json({ code: 404, message: '接口不存在' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
  });

  return app;
}

function start() {
  const { config, warnings } = loadConfig();
  for (const w of warnings) console.warn('[warn]', w);
  const pool = new ConnectionPool({});
  const stores = {
    servers: new JsonStore(config.dataDir, 'servers.json', []),
  };
  const app = createApp({ config, pool, stores });
  app.listen(config.port, () => console.log(`linuxmgr server listening on http://localhost:${config.port}`));
  return app;
}

if (require.main === module) start();

module.exports = { createApp, start };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/`
预期：全部 PASS（config/cipher/jwt/jsonStore/exec/connectionPool/sshParser/audit/api 共 8 个测试文件）

- [ ] **步骤 5：Commit**

```bash
git add server/src/routes server/src/index.js server/test/api.test.js
git commit -m "feat: 认证/服务器/监控路由与 Express 组装"
```

---

### 任务 10：前端脚手架

**文件：**
- 创建：`apps/web/package.json`
- 创建：`apps/web/vite.config.ts`
- 创建：`apps/web/tsconfig.json`
- 创建：`apps/web/tsconfig.node.json`
- 创建：`apps/web/index.html`
- 创建：`apps/web/src/env.d.ts`
- 创建：`apps/web/src/main.ts`
- 创建：`apps/web/src/App.vue`
- 创建：`apps/web/src/styles/index.scss`
- 创建：`apps/web/src/router/index.ts`（最小版：仅 /login 与 / 占位，任务 11 补全）

- [ ] **步骤 1：创建脚手架文件**

`apps/web/package.json`：

```json
{
  "name": "linuxmgr-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@element-plus/icons-vue": "^2.3.1",
    "axios": "^1.7.2",
    "echarts": "^5.5.0",
    "element-plus": "^2.7.5",
    "pinia": "^2.1.7",
    "vue": "^3.4.29",
    "vue-router": "^4.3.3"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.5",
    "sass": "^1.77.6",
    "typescript": "~5.4.5",
    "vite": "^5.3.1",
    "vue-tsc": "^2.0.21"
  }
}
```

`apps/web/vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

`apps/web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`apps/web/tsconfig.node.json`：

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

`apps/web/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>linuxmgr 服务器管理</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/web/src/env.d.ts`：

```ts
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

`apps/web/src/main.ts`：

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import './styles/index.scss'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
```

`apps/web/src/App.vue`：

```vue
<template>
  <router-view />
</template>
```

`apps/web/src/styles/index.scss`：

```scss
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
body { font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; }
```

`apps/web/src/router/index.ts`（最小版，任务 11 补全为完整版）：

```ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/login/index.vue') },
    { path: '/', component: () => import('@/layout/index.vue') },
  ],
})

export default router
```

- [ ] **步骤 2：安装依赖并启动验证**

运行：`npm install && npm run dev`
预期：Vite 启动在 `http://localhost:5173`，浏览器打开能看到 Element Plus 空页面（路由指向不存在的组件会报错属正常，任务 11 补齐视图后消除）

- [ ] **步骤 3：Commit**

```bash
git add apps/web
git commit -m "chore: 前端脚手架（Vue3 + Vite + TS + Element Plus）"
```

---

### 任务 11：前端基础设施（请求封装/API/状态/路由守卫/布局/登录页）

**文件：**
- 创建：`apps/web/src/api/request.ts`
- 创建：`apps/web/src/api/auth.ts`
- 创建：`apps/web/src/api/servers.ts`
- 创建：`apps/web/src/api/monitor.ts`
- 创建：`apps/web/src/stores/user.ts`
- 创建：`apps/web/src/stores/server.ts`
- 修改：`apps/web/src/router/index.ts`（完整版）
- 创建：`apps/web/src/layout/index.vue`
- 创建：`apps/web/src/views/login/index.vue`

- [ ] **步骤 1：实现请求封装与 API 模块**

`apps/web/src/api/request.ts`：

```ts
import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

const request = axios.create({ baseURL: '/api', timeout: 30000 })

request.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('linuxmgr_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

request.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data
      ElMessage.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message))
    }
    return body
  },
  (err) => {
    const status = err.response?.status
    const message = err.response?.data?.message
    if (status === 401) {
      localStorage.removeItem('linuxmgr_token')
      localStorage.removeItem('linuxmgr_username')
      router.push('/login')
      ElMessage.warning('登录已过期，请重新登录')
    } else {
      ElMessage.error(message || err.message || '网络错误')
    }
    return Promise.reject(err)
  }
)

export default request
```

`apps/web/src/api/auth.ts`：

```ts
import request from './request'

export interface LoginResult {
  token: string
  username: string
  role: string
}

export function login(username: string, password: string) {
  return request.post('/auth/login', { username, password }) as Promise<LoginResult>
}
```

`apps/web/src/api/servers.ts`：

```ts
import request from './request'

export interface ServerInfo {
  id: string
  name: string
  host: string
  port: number
  username: string
  hasPassword: boolean
  createdAt: string
}

export interface ServerPayload {
  name: string
  host: string
  port: number
  username: string
  password?: string
}

export function listServers() {
  return request.get('/servers') as Promise<ServerInfo[]>
}

export function createServer(payload: ServerPayload) {
  return request.post('/servers', payload) as Promise<ServerInfo>
}

export function updateServer(id: string, payload: ServerPayload) {
  return request.put(`/servers/${id}`, payload) as Promise<ServerInfo>
}

export function deleteServer(id: string) {
  return request.delete(`/servers/${id}`)
}

export function testServer(id: string) {
  return request.post(`/servers/${id}/test`) as Promise<{ ok: boolean; uname: string }>
}
```

`apps/web/src/api/monitor.ts`：

```ts
import request from './request'

export interface MonitorData {
  cpu: { us: number; sy: number; id: number }
  load: number[]
  mem: { totalMB: number; usedMB: number; availMB: number; percent: number }
  disk: Array<{ fs: string; size: string; used: string; percent: number; mount: string }>
  net: { rxBytes: number; txBytes: number; rxRate: number; txRate: number }
  uptimeSec: number
  os: string
}

export function getMonitor(serverId: string) {
  return request.get(`/servers/${serverId}/monitor`) as Promise<MonitorData>
}
```

- [ ] **步骤 2：实现 Pinia 状态**

`apps/web/src/stores/user.ts`：

```ts
import { defineStore } from 'pinia'
import { login as apiLogin } from '@/api/auth'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('linuxmgr_token') || '',
    username: localStorage.getItem('linuxmgr_username') || '',
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username: string, password: string) {
      const data = await apiLogin(username, password)
      this.token = data.token
      this.username = data.username
      localStorage.setItem('linuxmgr_token', data.token)
      localStorage.setItem('linuxmgr_username', data.username)
    },
    logout() {
      this.token = ''
      this.username = ''
      localStorage.removeItem('linuxmgr_token')
      localStorage.removeItem('linuxmgr_username')
    },
  },
})
```

`apps/web/src/stores/server.ts`：

```ts
import { defineStore } from 'pinia'
import { listServers, type ServerInfo } from '@/api/servers'

export const useServerStore = defineStore('server', {
  state: () => ({
    servers: [] as ServerInfo[],
    currentId: localStorage.getItem('linuxmgr_current_server') || '',
  }),
  getters: {
    current(state): ServerInfo | undefined {
      return state.servers.find((s) => s.id === state.currentId)
    },
  },
  actions: {
    async load() {
      this.servers = await listServers()
      if (!this.servers.some((s) => s.id === this.currentId)) {
        this.currentId = this.servers[0]?.id || ''
        localStorage.setItem('linuxmgr_current_server', this.currentId)
      }
    },
    switchServer(id: string) {
      this.currentId = id
      localStorage.setItem('linuxmgr_current_server', id)
    },
  },
})
```

- [ ] **步骤 3：补全路由（完整版）**

`apps/web/src/router/index.ts`：

```ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/login/index.vue') },
    {
      path: '/',
      component: () => import('@/layout/index.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/index.vue'),
          meta: { title: '监控大盘' },
        },
        {
          path: 'servers',
          name: 'Servers',
          component: () => import('@/views/servers/index.vue'),
          meta: { title: '服务器管理' },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('linuxmgr_token')
  if (!token && to.path !== '/login') return '/login'
  if (token && to.path === '/login') return '/'
  return true
})

export default router
```

- [ ] **步骤 4：实现布局与登录页**

`apps/web/src/layout/index.vue`：

```vue
<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">云小U</div>
      <el-menu
        router
        :default-active="$route.path"
        background-color="#001529"
        text-color="#a6adb4"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon><span>监控大盘</span>
        </el-menu-item>
        <el-menu-item index="/servers">
          <el-icon><Monitor /></el-icon><span>服务器管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-title">{{ $route.meta.title || '' }}</div>
        <div class="header-right">
          <el-select
            :model-value="serverStore.currentId"
            placeholder="选择服务器"
            style="width: 240px"
            @change="serverStore.switchServer"
          >
            <el-option
              v-for="s in serverStore.servers"
              :key="s.id"
              :label="`${s.name} (${s.host})`"
              :value="s.id"
            />
          </el-select>
          <el-dropdown @command="onCommand">
            <span class="user">{{ userStore.username }} <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Odometer, Monitor, ArrowDown } from '@element-plus/icons-vue'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const serverStore = useServerStore()
const userStore = useUserStore()

onMounted(() => {
  serverStore.load().catch(() => {})
})

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  }
}
</script>

<style scoped lang="scss">
.layout { height: 100%; }
.aside {
  background: #001529;
  .logo { height: 56px; line-height: 56px; text-align: center; color: #fff; font-size: 20px; font-weight: 600; }
  :deep(.el-menu) { border-right: none; }
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border-bottom: 1px solid #e8e8e8;
  .header-title { font-size: 16px; font-weight: 600; }
  .header-right { display: flex; align-items: center; gap: 16px; .user { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; } }
}
.main { background: #f0f2f5; }
</style>
```

`apps/web/src/views/login/index.vue`：

```vue
<template>
  <div class="login-page">
    <el-card class="login-card">
      <h2 class="title">云小U 服务器管理</h2>
      <el-form :model="form" @keyup.enter="onSubmit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="onSubmit">
          登 录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const form = reactive({ username: '', password: '' })
const loading = ref(false)

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await userStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-page {
  height: 100%; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1f3b73, #2b5aa0);
}
.login-card {
  width: 380px; padding: 8px 12px;
  .title { text-align: center; margin-bottom: 24px; color: #1f3b73; }
}
</style>
```

- [ ] **步骤 5：验证**

运行：`npm run dev`，浏览器打开 `http://localhost:5173`，未登录自动跳转 `/login`；输入错误凭据提示错误；输入 `ADMIN_USER`/`ADMIN_PASSWORD`（后端 .env 中配置）登录成功进入布局页（此时 dashboard/servers 页面还是空白的，任务 12/13 填充）

- [ ] **步骤 6：Commit**

```bash
git add apps/web/src/api apps/web/src/stores apps/web/src/router apps/web/src/layout apps/web/src/views/login
git commit -m "feat: 前端基础设施（请求封装/状态/路由守卫/布局/登录页）"
```

---

### 任务 12：服务器管理页面

**文件：**
- 创建：`apps/web/src/views/servers/index.vue`

- [ ] **步骤 1：实现页面**

`apps/web/src/views/servers/index.vue`：

```vue
<template>
  <el-card>
    <div class="toolbar">
      <el-button type="primary" @click="openDialog()">新增服务器</el-button>
    </div>
    <el-table :data="serverStore.servers" v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="120" />
      <el-table-column prop="host" label="主机" min-width="140" />
      <el-table-column prop="port" label="端口" width="80" />
      <el-table-column prop="username" label="用户名" width="100" />
      <el-table-column label="连接状态" width="200">
        <template #default="{ row }">
          <el-button link type="primary" :loading="testingId === row.id" @click="onTest(row)">
            测试连接
          </el-button>
          <span v-if="testResult[row.id]" :class="testResult[row.id].ok ? 'ok' : 'fail'">
            {{ testResult[row.id].ok ? `正常 (${testResult[row.id].uname})` : '失败' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
          <el-button link type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="form.id ? '编辑服务器' : '新增服务器'" width="480px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="如：生产环境-Web" />
      </el-form-item>
      <el-form-item label="主机" required>
        <el-input v-model="form.host" placeholder="IP 或域名，如 43.240.221.112" />
      </el-form-item>
      <el-form-item label="端口" required>
        <el-input-number v-model="form.port" :min="1" :max="65535" />
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="form.username" placeholder="如 root" />
      </el-form-item>
      <el-form-item :label="form.id ? '密码(留空不变)' : '密码'" required>
        <el-input v-model="form.password" type="password" show-password placeholder="SSH 密码（加密存储）" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createServer, deleteServer, testServer, updateServer, type ServerPayload } from '@/api/servers'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const loading = ref(false)
const saving = ref(false)
const testingId = ref('')
const testResult = reactive<Record<string, { ok: boolean; uname?: string }>>({})
const dialogVisible = ref(false)
const form = reactive<{ id?: string; name: string; host: string; port: number; username: string; password: string }>({
  name: '', host: '', port: 22, username: 'root', password: '',
})

onMounted(async () => {
  loading.value = true
  try {
    await serverStore.load()
  } finally {
    loading.value = false
  }
})

function openDialog(row?: { id: string; name: string; host: string; port: number; username: string }) {
  if (row) {
    form.id = row.id
    form.name = row.name
    form.host = row.host
    form.port = row.port
    form.username = row.username
    form.password = ''
  } else {
    form.id = undefined
    form.name = ''
    form.host = ''
    form.port = 22
    form.username = 'root'
    form.password = ''
  }
  dialogVisible.value = true
}

async function onSave() {
  if (!form.name || !form.host || !form.username) {
    ElMessage.warning('请填写名称、主机和用户名')
    return
  }
  saving.value = true
  try {
    const payload: ServerPayload = { name: form.name, host: form.host, port: form.port, username: form.username }
    if (form.password) payload.password = form.password
    if (form.id) {
      await updateServer(form.id, payload)
      ElMessage.success('已更新')
    } else {
      if (!form.password) {
        ElMessage.warning('新增服务器必须填写密码')
        return
      }
      await createServer(payload)
      ElMessage.success('已添加')
    }
    dialogVisible.value = false
    await serverStore.load()
  } finally {
    saving.value = false
  }
}

async function onTest(row: { id: string }) {
  testingId.value = row.id
  try {
    const data = await testServer(row.id)
    testResult[row.id] = data
    if (data.ok) ElMessage.success(`连接成功：${data.uname}`)
  } catch {
    testResult[row.id] = { ok: false }
  } finally {
    testingId.value = ''
  }
}

async function onDelete(row: { id: string; name: string }) {
  await ElMessageBox.confirm(`确定删除服务器「${row.name}」吗？将断开其 SSH 连接。`, '删除确认', { type: 'warning' })
  await deleteServer(row.id)
  ElMessage.success('已删除')
  await serverStore.load()
}
</script>

<style scoped lang="scss">
.toolbar { margin-bottom: 16px; }
.ok { color: #67c23a; font-size: 12px; }
.fail { color: #f56c6c; font-size: 12px; }
</style>
```

- [ ] **步骤 2：验证**

浏览器 `http://localhost:5173/servers`：新增服务器（填真实服务器信息），列表出现；点「测试连接」显示"连接成功：Linux ..."；编辑修改名称保存生效；删除有确认弹窗。

- [ ] **步骤 3：Commit**

```bash
git add apps/web/src/views/servers/index.vue
git commit -m "feat: 服务器管理页面（CRUD + 连接测试）"
```

---

### 任务 13：监控大盘页面

**文件：**
- 创建：`apps/web/src/views/dashboard/index.vue`

- [ ] **步骤 1：实现页面**

`apps/web/src/views/dashboard/index.vue`：

```vue
<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加服务器，并在顶部选择要监控的服务器" />
  </div>
  <div v-else>
    <el-row :gutter="16">
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">CPU 使用率</div>
          <div class="value">{{ cpuText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">内存</div>
          <div class="value">{{ memText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">磁盘（根分区）</div>
          <div class="value">{{ diskText }}</div>
        </div></el-card>
      </el-col>
      <el-col :span="6">
        <el-card><div class="stat">
          <div class="label">负载（1/5/15 分钟）</div>
          <div class="value">{{ loadText }}</div>
        </div></el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="row-gap">
      <el-col :span="12">
        <el-card>
          <template #header>CPU 使用率（%）</template>
          <div ref="cpuChartEl" class="chart" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>网络速率（KB/s）</template>
          <div ref="netChartEl" class="chart" />
        </el-card>
      </el-col>
    </el-row>

    <el-card class="row-gap">
      <template #header>系统信息</template>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="操作系统">{{ current?.os || '--' }}</el-descriptions-item>
        <el-descriptions-item label="运行时长">{{ uptimeText }}</el-descriptions-item>
        <el-descriptions-item label="内存可用">{{ memAvailText }}</el-descriptions-item>
        <el-descriptions-item v-for="d in current?.disk || []" :key="d.mount" :label="`磁盘 ${d.mount}`">
          {{ d.used }} / {{ d.size }}（{{ d.percent }}%）
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import { getMonitor, type MonitorData } from '@/api/monitor'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const current = ref<MonitorData | null>(null)
const cpuChartEl = ref<HTMLDivElement>()
const netChartEl = ref<HTMLDivElement>()

let cpuChart: echarts.ECharts | null = null
let netChart: echarts.ECharts | null = null
let timer: number | undefined
const history = {
  cpu: [] as number[],
  rx: [] as number[],
  tx: [] as number[],
  time: [] as string[],
}

const cpuText = computed(() => (current.value ? `${(current.value.cpu.us + current.value.cpu.sy).toFixed(1)}%` : '--'))
const memText = computed(() => {
  const m = current.value?.mem
  return m ? `${m.usedMB} / ${m.totalMB} MB（${m.percent}%）` : '--'
})
const diskText = computed(() => {
  const root = current.value?.disk.find((d) => d.mount === '/')
  return root ? `${root.used} / ${root.size}（${root.percent}%）` : '--'
})
const loadText = computed(() => (current.value ? current.value.load.map((n) => n.toFixed(2)).join(' / ') : '--'))
const uptimeText = computed(() => {
  const s = current.value?.uptimeSec ?? 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d} 天 ${h} 小时 ${m} 分` : `${h} 小时 ${m} 分`
})
const memAvailText = computed(() => {
  const m = current.value?.mem
  return m ? `${m.availMB} MB` : '--'
})

function pushHistory(data: MonitorData) {
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  history.time.push(now)
  history.cpu.push(Number((data.cpu.us + data.cpu.sy).toFixed(1)))
  history.rx.push(Number((data.net.rxRate / 1024).toFixed(1)))
  history.tx.push(Number((data.net.txRate / 1024).toFixed(1)))
  if (history.time.length > 60) {
    history.time.shift()
    history.cpu.shift()
    history.rx.shift()
    history.tx.shift()
  }
}

function updateCharts() {
  if (!cpuChart || !netChart) return
  cpuChart.setOption({
    xAxis: { type: 'category', data: history.time },
    yAxis: { type: 'value', max: 100 },
    series: [{ type: 'line', smooth: true, data: history.cpu, areaStyle: {} }],
  })
  netChart.setOption({
    xAxis: { type: 'category', data: history.time },
    yAxis: { type: 'value' },
    series: [
      { name: '下行', type: 'line', smooth: true, data: history.rx, areaStyle: {} },
      { name: '上行', type: 'line', smooth: true, data: history.tx, areaStyle: {} },
    ],
  })
}

async function refresh() {
  if (!serverStore.currentId) return
  try {
    const data = await getMonitor(serverStore.currentId)
    current.value = data
    pushHistory(data)
    updateCharts()
  } catch {
    /* 错误已由拦截器提示 */
  }
}

onMounted(() => {
  if (cpuChartEl.value) {
    cpuChart = echarts.init(cpuChartEl.value)
  }
  if (netChartEl.value) {
    netChart = echarts.init(netChartEl.value)
  }
  refresh()
  timer = window.setInterval(refresh, 3000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  cpuChart?.dispose()
  netChart?.dispose()
})
</script>

<style scoped lang="scss">
.row-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 22px; font-weight: 600; }
}
.chart { height: 300px; }
</style>
```

- [ ] **步骤 2：验证**

浏览器 `http://localhost:5173/dashboard`：顶部选择服务器后，四个统计卡显示真实数值；两张折线图每 3 秒刷新并保留最近 60 个采样点；切换服务器后数据跟着切换；「系统信息」显示操作系统、运行时长、磁盘分区。

- [ ] **步骤 3：Commit**

```bash
git add apps/web/src/views/dashboard/index.vue
git commit -m "feat: 监控大盘页面（ECharts 实时图表）"
```

---

### 任务 14：数据库管理后端（MySQL + Redis）

**文件：**
- 创建：`server/src/utils/dbParser.js`
- 创建：`server/src/routes/database.js`
- 测试：`server/test/dbParser.test.js`
- 测试：`server/test/database.test.js`（mock pool 集成）

- [ ] **步骤 1：编写失败的解析器测试**

`server/test/dbParser.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDatabases, parseRedisInfo } = require('../src/utils/dbParser');

const DB_OUTPUT = `Database
information_schema
mysql
performance_schema
sys
app_blog
app_shop
`;

const REDIS_INFO = `# Server
redis_version:7.0.15
redis_mode:standalone
os:Linux 5.15.0-91-generic x86_64
# Clients
connected_clients:3
blocked_clients:0
# Memory
used_memory:1048576
used_memory_human:1.00M
maxmemory:0
# Stats
total_connections_received:1234
total_commands_processed:5678
keyspace_hits:100
keyspace_misses:20
# Keyspace
db0:keys=42,expires=10,avg_ttl=0
db1:keys=7,expires=0,avg_ttl=0
`;

test('解析 SHOW DATABASES 输出', () => {
  const dbs = parseDatabases(DB_OUTPUT);
  assert.deepEqual(dbs, ['information_schema', 'mysql', 'performance_schema', 'sys', 'app_blog', 'app_shop']);
});

test('解析 redis INFO 输出', () => {
  const info = parseRedisInfo(REDIS_INFO);
  assert.equal(info.version, '7.0.15');
  assert.equal(info.mode, 'standalone');
  assert.equal(info.connectedClients, 3);
  assert.equal(info.usedMemory, 1048576);
  assert.equal(info.totalConnections, 1234);
  assert.equal(info.totalCommands, 5678);
  assert.equal(info.hitRate, 83); // 100/(100+20) 取整
  assert.equal(info.totalKeys, 49); // 42+7
  assert.deepEqual(info.databases, [{ db: 'db0', keys: 42, expires: 10 }, { db: 'db1', keys: 7, expires: 0 }]);
});

test('空输出返回空结构', () => {
  assert.deepEqual(parseDatabases(''), []);
  const info = parseRedisInfo('');
  assert.equal(info.version, '');
  assert.equal(info.totalKeys, 0);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/dbParser.test.js`
预期：FAIL，`Cannot find module '../src/utils/dbParser'`

- [ ] **步骤 3：实现 dbParser.js**

`server/src/utils/dbParser.js`：

```js
function parseDatabases(output) {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'Database');
}

function parseRedisInfo(output) {
  const lines = output.split('\n');
  const kv = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_0-9]+):(.*)$/);
    if (m) kv[m[1]] = m[2];
  }
  const hits = parseInt(kv.keyspace_hits || '0', 10);
  const misses = parseInt(kv.keyspace_misses || '0', 10);
  const databases = [];
  for (const [key, value] of Object.entries(kv)) {
    if (key.startsWith('db') && /^\d+$/.test(key.slice(2))) {
      const m = value.match(/^keys=(\d+),expires=(\d+)/);
      if (m) databases.push({ db: key, keys: parseInt(m[1], 10), expires: parseInt(m[2], 10) });
    }
  }
  return {
    version: kv.redis_version || '',
    mode: kv.redis_mode || '',
    connectedClients: parseInt(kv.connected_clients || '0', 10),
    usedMemory: parseInt(kv.used_memory || '0', 10),
    totalConnections: parseInt(kv.total_connections_received || '0', 10),
    totalCommands: parseInt(kv.total_commands_processed || '0', 10),
    hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0,
    totalKeys: databases.reduce((sum, d) => sum + d.keys, 0),
    databases,
  };
}

module.exports = { parseDatabases, parseRedisInfo };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/dbParser.test.js`
预期：PASS（3 个测试）

- [ ] **步骤 5：编写失败的集成测试（mock pool）**

`server/test/database.test.js`：

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
  assert.ok(joined.includes('CREATE DATABASE `app_new`'));
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
```

- [ ] **步骤 6：运行测试验证失败**

运行：`node --test test/database.test.js`
预期：FAIL，数据库路由 404（路由尚未挂载）

- [ ] **步骤 7：实现 database.js 路由并挂载**

`server/src/routes/database.js`：

```js
const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { parseDatabases, parseRedisInfo } = require('../utils/dbParser');
const { audit } = require('../utils/audit');

const DB_NAME_RE = /^[a-zA-Z0-9_]{1,64}$/;
const USER_NAME_RE = /^[a-zA-Z0-9_]{1,32}$/;

function createDatabaseRouter({ config, pool, store }) {
  const router = express.Router();

  const findServer = (id) => store.read().find((s) => s.id === id);

  function passwordOf(server, field, res) {
    if (!server[field]) return null; // 未配置则用 sudo/无密码方式
    try {
      return decrypt(server[field], config.masterKey);
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return undefined; // 区分"未配置"(null) 与 "解密失败"(undefined)
    }
  }

  // mysql 认证参数：配置了密码用 -p，否则走 sudo（auth_socket）
  function mysqlAuth(server, res) {
    const pwd = passwordOf(server, 'mysqlPasswordEnc', res);
    if (pwd === undefined) return null; // 解密失败
    if (pwd) return `-u root -p'${pwd.replace(/'/g, "'\\''")}'`;
    return ''; // sudo 模式
  }

  function mysqlCmd(server, sql, res) {
    const auth = mysqlAuth(server, res);
    if (auth === null) return null;
    if (auth) return `mysql ${auth} -N -e "${sql}"`;
    return `sudo mysql -N -e "${sql}"`;
  }

  function mysqldumpCmd(server, db, res) {
    const auth = mysqlAuth(server, res);
    if (auth === null) return null;
    if (auth) return `mysqldump ${auth} --single-transaction ${db}`;
    return `sudo mysqldump --single-transaction ${db}`;
  }

  router.get('/servers/:id/databases', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cmd = mysqlCmd(server, 'SHOW DATABASES', res);
    if (cmd === null) return;
    try {
      const result = await pool.run(
        { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) },
        cmd
      );
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      res.json({ code: 0, data: parseDatabases(result.stdout) });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取数据库列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/databases', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { name, username, password } = req.body || {};
    if (!name || !DB_NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '数据库名不合法（字母/数字/下划线，1-64 位）' });
    if (username && !USER_NAME_RE.test(username)) return res.status(400).json({ code: 400, message: '用户名不合法' });
    if (!username || !password) return res.status(400).json({ code: 400, message: '请提供用户名和密码' });
    const sshCfg = { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) };
    const cmds = [
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE USER IF NOT EXISTS '${username}'@'localhost' IDENTIFIED BY '${password.replace(/'/g, "'\\''")}'`,
      `GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'localhost'`,
      'FLUSH PRIVILEGES',
    ];
    try {
      for (const sql of cmds) {
        const cmd = mysqlCmd(server, sql, res);
        if (cmd === null) return;
        const result = await pool.run(sshCfg, cmd);
        if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      }
      audit(config.dataDir, { action: 'database.create', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { name, username } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `创建数据库失败: ${err.message}` });
    }
  });

  router.delete('/servers/:id/databases/:name', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const name = req.params.name;
    if (!DB_NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '数据库名不合法' });
    const sshCfg = { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) };
    try {
      const backupDir = '/tmp/linuxmgr-db-backup';
      const dump = mysqldumpCmd(server, name, res);
      if (dump === null) return;
      const backupCmd = `mkdir -p ${backupDir} && ${dump} > ${backupDir}/${name}-$(date +%Y%m%d%H%M%S).sql`;
      const backup = await pool.run(sshCfg, backupCmd);
      if (backup.code !== 0) throw new Error(`备份失败: ${backup.stderr.slice(0, 200)}`);
      const cmd = mysqlCmd(server, `DROP DATABASE \`${name}\``, res);
      const drop = await pool.run(sshCfg, cmd);
      if (drop.code !== 0) throw new Error(drop.stderr.slice(0, 200));
      audit(config.dataDir, { action: 'database.drop', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { dropped: name } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除数据库失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/redis', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const sshCfg = { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) };
    try {
      const result = await pool.run(sshCfg, `redis-cli ${authPart} INFO`);
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      res.json({ code: 0, data: parseRedisInfo(result.stdout) });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取 Redis 状态失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/redis/keys', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const sshCfg = { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) };
    try {
      const result = await pool.run(sshCfg, `redis-cli ${authPart} --scan --count 100`);
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      const keys = result.stdout.split('\n').map((k) => k.trim()).filter(Boolean);
      res.json({ code: 0, data: keys });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取 Redis 键列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/redis/flush', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const sshCfg = { host: server.host, port: server.port, username: server.username, password: passwordOf(server, 'passwordEnc', res) };
    try {
      const result = await pool.run(sshCfg, `redis-cli ${authPart} FLUSHDB`);
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      audit(config.dataDir, { action: 'redis.flush', target: server.host, result: 'success' });
      res.json({ code: 0, data: { flushed: true } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `清空 Redis 失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createDatabaseRouter;
```

在 `server/src/index.js` 中挂载（新增一行，位于 monitor 路由之后）：

```js
app.use('/api', requireAuth(config), createDatabaseRouter({ config, pool, store: stores.servers }));
```

- [ ] **步骤 8：运行测试验证通过**

运行：`node --test test/dbParser.test.js test/database.test.js`
预期：全部 PASS（数据库路由集成测试需先确认 `createApp` 已接收 `createDatabaseRouter` 依赖并挂载）

- [ ] **步骤 9：Commit**

```bash
git add server/src/utils/dbParser.js server/src/routes/database.js server/src/index.js server/test/dbParser.test.js server/test/database.test.js
git commit -m "feat: 数据库管理后端（MySQL 库/用户/备份删除 + Redis 状态/键/清空）"
```

---

### 任务 15：软件商店后端

**文件：**
- 创建：`server/src/routes/store.js`
- 测试：`server/test/store.test.js`（mock pool 集成）

- [ ] **步骤 1：编写失败的集成测试**

`server/test/store.test.js`：

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
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/store.test.js`
预期：FAIL，store 路由 404（尚未挂载）

- [ ] **步骤 3：实现 store.js 路由并挂载**

`server/src/routes/store.js`：

```js
const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

// 软件清单：name 同时是包名与命令名（统一白名单，杜绝任意命令注入）
const SOFTWARE = [
  { name: 'nginx', display: 'Nginx', desc: 'Web 服务器/反向代理', versionCmd: 'nginx -v 2>&1', pkg: { apt: 'nginx', yum: 'nginx' } },
  { name: 'mysql', display: 'MySQL/MariaDB', desc: '关系型数据库', versionCmd: 'mysql --version', pkg: { apt: 'mysql-server', yum: 'mysql-server' } },
  { name: 'redis', display: 'Redis', desc: '内存键值数据库', versionCmd: 'redis-server --version', pkg: { apt: 'redis-server', yum: 'redis' } },
  { name: 'docker', display: 'Docker', desc: '容器引擎', versionCmd: 'docker --version', pkg: { apt: 'docker.io', yum: 'docker-ce' } },
  { name: 'node', display: 'Node.js', desc: 'JavaScript 运行时', versionCmd: 'node -v', pkg: { apt: 'nodejs', yum: 'nodejs' } },
  { name: 'python3', display: 'Python 3', desc: '脚本语言运行时', versionCmd: 'python3 --version', pkg: { apt: 'python3', yum: 'python3' } },
  { name: 'git', display: 'Git', desc: '版本控制', versionCmd: 'git --version', pkg: { apt: 'git', yum: 'git' } },
  { name: 'fail2ban', display: 'Fail2ban', desc: '暴力破解防护', versionCmd: 'fail2ban-server --version 2>&1 | head -1', pkg: { apt: 'fail2ban', yum: 'fail2ban' } },
];

function createStoreRouter({ config, pool, store }) {
  const router = express.Router();

  const findServer = (id) => store.read().find((s) => s.id === id);
  const sshCfg = (server, res) => {
    try {
      return {
        host: server.host, port: server.port, username: server.username,
        password: decrypt(server.passwordEnc, config.masterKey),
      };
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return null;
    }
  };

  // 检测包管理器：优先 apt-get（Debian/Ubuntu），否则 yum（RHEL 系）
  async function detectPkgManager(cfg) {
    const r = await pool.run(cfg, 'command -v apt-get >/dev/null 2>&1 && echo apt || echo yum');
    return r.stdout.trim() === 'apt' ? 'apt' : 'yum';
  }

  router.get('/servers/:id/store', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const items = [];
      for (const soft of SOFTWARE) {
        const version = await pool.run(cfg, soft.versionCmd);
        const installed = version.code === 0 && version.stdout.trim() !== '';
        items.push({
          name: soft.name,
          display: soft.display,
          desc: soft.desc,
          installed,
          version: installed ? version.stdout.trim().split('\n')[0] : '',
          package: soft.pkg[pkg],
        });
      }
      res.json({ code: 0, data: items });
    } catch (err) {
      res.status(502).json({ code: 502, message: `软件状态检测失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/store/:name/install', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const soft = SOFTWARE.find((s) => s.name === req.params.name);
    if (!soft) return res.status(400).json({ code: 400, message: '未知软件' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const installCmd = pkg === 'apt'
        ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${soft.pkg.apt}`
        : `yum install -y ${soft.pkg.yum}`;
      const result = await pool.run(cfg, installCmd, { timeoutMs: 600000 });
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 300) || `退出码 ${result.code}`);
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: soft.name, result: 'success' });
      res.json({ code: 0, data: { installed: soft.name, package: soft.pkg[pkg] } });
    } catch (err) {
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: soft.name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `安装失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createStoreRouter;
```

在 `server/src/index.js` 中挂载（monitor 路由之后）：

```js
app.use('/api', requireAuth(config), createStoreRouter({ config, pool, store: stores.servers }));
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/store.test.js`
预期：全部 PASS

- [ ] **步骤 5：Commit**

```bash
git add server/src/routes/store.js server/src/index.js server/test/store.test.js
git commit -m "feat: 软件商店后端（8 软件状态检测 + 包管理器一键安装）"
```

---

### 任务 16：数据库管理页面

**文件：**
- 创建：`apps/web/src/api/database.ts`
- 创建：`apps/web/src/views/databases/index.vue`
- 修改：`apps/web/src/router/index.ts`（加路由）
- 修改：`apps/web/src/layout/index.vue`（加菜单）

- [ ] **步骤 1：实现 API 模块**

`apps/web/src/api/database.ts`：

```ts
import request from './request'

export interface RedisInfo {
  version: string
  mode: string
  connectedClients: number
  usedMemory: number
  totalConnections: number
  totalCommands: number
  hitRate: number
  totalKeys: number
  databases: Array<{ db: string; keys: number; expires: number }>
}

export function listDatabases(serverId: string) {
  return request.get(`/servers/${serverId}/databases`) as Promise<string[]>
}

export function createDatabase(serverId: string, payload: { name: string; username: string; password: string }) {
  return request.post(`/servers/${serverId}/databases`, payload)
}

export function dropDatabase(serverId: string, name: string, confirm: boolean) {
  return request.delete(`/servers/${serverId}/databases/${name}`, { data: { confirm } })
}

export function getRedisInfo(serverId: string) {
  return request.get(`/servers/${serverId}/redis`) as Promise<RedisInfo>
}

export function listRedisKeys(serverId: string) {
  return request.get(`/servers/${serverId}/redis/keys`) as Promise<string[]>
}

export function flushRedis(serverId: string, confirm: boolean) {
  return request.post(`/servers/${serverId}/redis/flush`, { confirm })
}
```

- [ ] **步骤 2：实现页面（双 Tab：MySQL / Redis）**

`apps/web/src/views/databases/index.vue`：

```vue
<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <el-tabs v-else v-model="activeTab">
    <el-tab-pane label="MySQL/MariaDB" name="mysql">
      <el-card>
        <div class="toolbar">
          <el-button type="primary" @click="dbDialogVisible = true">创建数据库</el-button>
        </div>
        <el-table :data="databases" v-loading="dbLoading">
          <el-table-column prop="name" label="数据库名" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button link type="danger" @click="onDropDb(row.name)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-tab-pane>

    <el-tab-pane label="Redis" name="redis">
      <el-row :gutter="16">
        <el-col :span="6"><el-card><div class="stat"><div class="label">版本</div><div class="value">{{ redisInfo?.version || '--' }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">内存占用</div><div class="value">{{ memText }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">连接数</div><div class="value">{{ redisInfo?.connectedClients ?? '--' }}</div></div></el-card></el-col>
        <el-col :span="6"><el-card><div class="stat"><div class="label">命中率</div><div class="value">{{ redisInfo ? redisInfo.hitRate + '%' : '--' }}</div></div></el-card></el-col>
      </el-row>
      <el-card class="row-gap">
        <template #header>
          <div class="redis-header">
            <span>键列表（共 {{ redisInfo?.totalKeys ?? 0 }} 个键）</span>
            <div>
              <el-button size="small" @click="loadRedis">刷新</el-button>
              <el-button size="small" type="danger" @click="onFlushRedis">清空当前库</el-button>
            </div>
          </div>
        </template>
        <el-table :data="redisKeys" v-loading="redisLoading" max-height="360">
          <el-table-column prop="key" label="键名" />
        </el-table>
      </el-card>
    </el-tab-pane>
  </el-tabs>

  <el-dialog v-model="dbDialogVisible" title="创建数据库" width="440px">
    <el-form :model="dbForm" label-width="90px">
      <el-form-item label="数据库名" required>
        <el-input v-model="dbForm.name" placeholder="字母/数字/下划线" />
      </el-form-item>
      <el-form-item label="用户名" required>
        <el-input v-model="dbForm.username" />
      </el-form-item>
      <el-form-item label="密码" required>
        <el-input v-model="dbForm.password" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dbDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="dbSaving" @click="onCreateDb">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createDatabase, dropDatabase, flushRedis, getRedisInfo, listDatabases, listRedisKeys, type RedisInfo } from '@/api/database'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const activeTab = ref('mysql')
const databases = ref<Array<{ name: string }>>([])
const dbLoading = ref(false)
const dbDialogVisible = ref(false)
const dbSaving = ref(false)
const dbForm = reactive({ name: '', username: '', password: '' })
const redisInfo = ref<RedisInfo | null>(null)
const redisKeys = ref<Array<{ key: string }>>([])
const redisLoading = ref(false)

const memText = computed(() => {
  const m = redisInfo.value?.usedMemory
  return m === undefined ? '--' : m >= 1048576 ? `${(m / 1048576).toFixed(1)} MB` : `${Math.round(m / 1024)} KB`
})

async function loadDatabases() {
  if (!serverStore.currentId) return
  dbLoading.value = true
  try {
    const names = await listDatabases(serverStore.currentId)
    databases.value = names.map((name) => ({ name }))
  } finally {
    dbLoading.value = false
  }
}

async function loadRedis() {
  if (!serverStore.currentId) return
  redisLoading.value = true
  try {
    redisInfo.value = await getRedisInfo(serverStore.currentId)
    const keys = await listRedisKeys(serverStore.currentId)
    redisKeys.value = keys.map((key) => ({ key }))
  } finally {
    redisLoading.value = false
  }
}

onMounted(() => {
  loadDatabases()
  loadRedis()
})

async function onCreateDb() {
  if (!dbForm.name || !dbForm.username || !dbForm.password) {
    ElMessage.warning('请填写完整信息')
    return
  }
  dbSaving.value = true
  try {
    await createDatabase(serverStore.currentId!, { ...dbForm })
    ElMessage.success('创建成功')
    dbDialogVisible.value = false
    dbForm.name = ''
    dbForm.username = ''
    dbForm.password = ''
    loadDatabases()
  } finally {
    dbSaving.value = false
  }
}

async function onDropDb(name: string) {
  await ElMessageBox.confirm(
    `将备份后删除数据库「${name}」，该操作不可恢复。`, '删除数据库', { type: 'warning' }
  )
  await dropDatabase(serverStore.currentId!, name, true)
  ElMessage.success('已删除（备份在服务器 /tmp/linuxmgr-db-backup/）')
  loadDatabases()
}

async function onFlushRedis() {
  await ElMessageBox.confirm('将清空当前 Redis 库的所有键，不可恢复。', '清空 Redis', { type: 'warning' })
  await flushRedis(serverStore.currentId!, true)
  ElMessage.success('已清空')
  loadRedis()
}
</script>

<style scoped lang="scss">
.toolbar { margin-bottom: 16px; }
.row-gap { margin-top: 16px; }
.stat {
  .label { font-size: 13px; color: #909399; margin-bottom: 8px; }
  .value { font-size: 20px; font-weight: 600; }
}
.redis-header { display: flex; justify-content: space-between; align-items: center; }
</style>
```

- [ ] **步骤 3：加路由与菜单**

`apps/web/src/router/index.ts` 的 children 中追加（servers 路由之后）：

```ts
{
  path: 'databases',
  name: 'Databases',
  component: () => import('@/views/databases/index.vue'),
  meta: { title: '数据库管理' },
},
```

`apps/web/src/layout/index.vue` 的 el-menu 中追加（服务器管理之后）：

```vue
<el-menu-item index="/databases">
  <el-icon><Coin /></el-icon><span>数据库管理</span>
</el-menu-item>
```

并在 script 的图标导入中追加 `Coin`。

- [ ] **步骤 4：验证**

浏览器 `http://localhost:5173/databases`：MySQL Tab 显示数据库列表（真实服务器上可看到 information_schema 等系统库）；创建对话框可创建库+用户；删除有确认弹窗且先备份。Redis Tab 显示版本/内存/连接数/命中率与键列表；清空有确认弹窗。

- [ ] **步骤 5：Commit**

```bash
git add apps/web/src/api/database.ts apps/web/src/views/databases apps/web/src/router/index.ts apps/web/src/layout/index.vue
git commit -m "feat: 数据库管理页面（MySQL + Redis）"
```

---

### 任务 17：软件商店页面

**文件：**
- 创建：`apps/web/src/api/store.ts`
- 创建：`apps/web/src/views/store/index.vue`
- 修改：`apps/web/src/router/index.ts`（加路由）
- 修改：`apps/web/src/layout/index.vue`（加菜单）

- [ ] **步骤 1：实现 API 模块**

`apps/web/src/api/store.ts`：

```ts
import request from './request'

export interface StoreItem {
  name: string
  display: string
  desc: string
  installed: boolean
  version: string
  package: string
}

export function listStore(serverId: string) {
  return request.get(`/servers/${serverId}/store`) as Promise<StoreItem[]>
}

export function installSoftware(serverId: string, name: string) {
  return request.post(`/servers/${serverId}/store/${name}/install`)
}
```

- [ ] **步骤 2：实现页面（卡片网格，参照应用商店风格）**

`apps/web/src/views/store/index.vue`：

```vue
<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加并选择服务器" />
  </div>
  <div v-else>
    <el-row :gutter="16">
      <el-col v-for="item in items" :key="item.name" :span="6" class="col">
        <el-card class="soft-card">
          <div class="soft-name">{{ item.display }}</div>
          <div class="soft-desc">{{ item.desc }}</div>
          <div class="soft-version">
            <el-tag v-if="item.installed" type="success" size="small">{{ item.version || '已安装' }}</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <el-button
            v-if="!item.installed"
            type="primary"
            size="small"
            class="soft-btn"
            :loading="installing === item.name"
            @click="onInstall(item)"
          >
            一键安装
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { installSoftware, listStore, type StoreItem } from '@/api/store'
import { useServerStore } from '@/stores/server'

const serverStore = useServerStore()
const items = ref<StoreItem[]>([])
const installing = ref('')

async function load() {
  if (!serverStore.currentId) return
  items.value = await listStore(serverStore.currentId)
}

onMounted(load)

async function onInstall(item: StoreItem) {
  await ElMessageBox.confirm(
    `将通过系统包管理器安装「${item.display}」（包名 ${item.package}），安装过程可能需要数分钟。`,
    '安装软件',
    { type: 'warning', confirmButtonText: '开始安装' }
  )
  installing.value = item.name
  try {
    await installSoftware(serverStore.currentId!, item.name)
    ElMessage.success('安装完成')
    await load()
  } finally {
    installing.value = ''
  }
}
</script>

<style scoped lang="scss">
.col { margin-bottom: 16px; }
.soft-card {
  .soft-name { font-size: 18px; font-weight: 600; }
  .soft-desc { color: #909399; font-size: 13px; margin: 8px 0; min-height: 36px; }
  .soft-version { margin-bottom: 12px; }
  .soft-btn { width: 100%; }
}
</style>
```

- [ ] **步骤 3：加路由与菜单**

`apps/web/src/router/index.ts` 的 children 中追加（databases 路由之后）：

```ts
{
  path: 'store',
  name: 'Store',
  component: () => import('@/views/store/index.vue'),
  meta: { title: '软件商店' },
},
```

`apps/web/src/layout/index.vue` 的 el-menu 中追加（数据库管理之后）：

```vue
<el-menu-item index="/store">
  <el-icon><Shop /></el-icon><span>软件商店</span>
</el-menu-item>
```

并在 script 的图标导入中追加 `Shop`。

- [ ] **步骤 4：验证**

浏览器 `http://localhost:5173/store`：显示 8 个软件卡片，已安装的显示绿色标签+版本号，未安装的显示"一键安装"按钮；安装有确认弹窗。

- [ ] **步骤 5：Commit**

```bash
git add apps/web/src/api/store.ts apps/web/src/views/store apps/web/src/router/index.ts apps/web/src/layout/index.vue
git commit -m "feat: 软件商店页面（状态检测 + 一键安装）"
```

---

### 任务 18：真实服务器端到端验证

**前置：** 用户提供的测试服务器 `43.240.221.112`（root）。本任务只执行**只读命令**（监控、数据库列表、Redis INFO、软件状态检测均为只读），遵守硬性约束 8.1。**不执行**软件安装/数据库创建等写操作——这些留给用户后续在界面上自行触发。

**文件：**
- 创建：`server/.env`（不提交 git，gitignore 已覆盖）

- [ ] **步骤 1：创建 .env**

```bash
PORT=3000
JWT_SECRET=<随机 32 位字符串>
MASTER_KEY=<随机 32 位字符串>
ADMIN_USER=admin
ADMIN_PASSWORD=<自定登录密码>
DATA_DIR=./data
```

生成随机值：PowerShell 执行 `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | % {[char]$_})`。

- [ ] **步骤 2：启动后端并验证登录**

运行（后台）：`node src/index.js`（`server/` 目录）
预期：输出 `linuxmgr server listening on http://localhost:3000`

运行：`curl.exe -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'`
预期：返回 `{"code":0,"data":{"token":"...","username":"admin","role":"admin"}}`

> 注意：pwsh 中 `curl` 是 `Invoke-WebRequest` 的别名，本任务统一使用 `curl.exe`。

- [ ] **步骤 3：通过 API 添加真实服务器并测试连接**

```powershell
$token = (curl.exe -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' | ConvertFrom-Json).data.token
$body = '{"name":"测试服务器","host":"43.240.221.112","port":22,"username":"root","password":"<SSH密码>"}'
$created = curl.exe -s -X POST http://localhost:3000/api/servers -H "Content-Type: application/json" -H "Authorization: Bearer $token" -d $body
$created
$id = ($created | ConvertFrom-Json).data.id
curl.exe -s -X POST "http://localhost:3000/api/servers/$id/test" -H "Authorization: Bearer $token"
```

预期：创建返回服务器信息（无明文密码）；测试连接返回 `{"code":0,"data":{"ok":true,"uname":"Linux ..."}}`

- [ ] **步骤 4：验证监控接口**

运行：`curl.exe -s "http://localhost:3000/api/servers/<id>/monitor" -H "Authorization: Bearer $token"`
预期：返回 CPU/内存/磁盘/网络/负载/系统信息，且数值与 `ssh root@43.240.221.112 free -m` 手动对比一致（量级吻合即可）

- [ ] **步骤 5：验证数据库与软件商店接口（只读）**

```powershell
curl.exe -s "http://localhost:3000/api/servers/$id/databases" -H "Authorization: Bearer $token"
curl.exe -s "http://localhost:3000/api/servers/$id/redis" -H "Authorization: Bearer $token"
curl.exe -s "http://localhost:3000/api/servers/$id/store" -H "Authorization: Bearer $token"
```

预期：数据库列表返回系统库（information_schema/mysql 等）或 502 明确报错（服务器未装 MySQL 时提示"获取数据库列表失败"）；Redis 返回 INFO 解析结果或明确报错；软件商店返回 8 个软件及安装状态（本机若已装 nginx/git 等应显示已安装+版本）。以上均为只读命令，不修改服务器状态。

- [ ] **步骤 6：验证安全约束**

运行：`curl.exe -s -X POST http://localhost:3000/api/auth/login ...` 错误密码连输 5 次，第 6 次正确密码应返回 429 锁定。
运行：`curl.exe -s http://localhost:3000/api/servers` 不带 token 应返回 401。
检查 `server/data/audit.log`：包含 login success/fail、server.create、server.test 记录。

- [ ] **步骤 7：前端验证**

运行（后台）：`npm run dev`（`apps/web/`）
浏览器 `http://localhost:5173`：登录 → 服务器列表显示测试服务器 → 顶部切换器选中 → 监控大盘图表显示真实数据 → 数据库管理页显示 MySQL 列表与 Redis 状态（如服务器未装对应服务则显示明确错误提示）→ 软件商店显示 8 个软件状态。

- [ ] **步骤 8：确认服务器未被改动（8.1 约束检查）**

本里程碑所有命令均为只读（`top`、`free`、`df`、`uptime`、`cat /proc/net/dev`、`uname`、`echo ok`、`SHOW DATABASES`、`redis-cli INFO`、`--scan`、版本检测命令），服务器上不会留下任何新文件、配置或规则。用 SSH 手动执行 `ls -la /etc/nginx/conf.d/ | grep linuxmgr` 确认无残留（本阶段不应有输出）。

- [ ] **步骤 9：Commit**

```bash
git add server/.env.example README.md
git commit -m "chore: 完成 P1 端到端验证"
```

---

## 自检记录

（执行者完成计划后填写：规格覆盖度 / 占位符扫描 / 类型一致性三项检查结果）

- [ ] 规格覆盖度：P1 覆盖设计文档第 3（架构）、4（P1 模块）、5（后端结构）、6（前端结构）、7（API 约定）、8（安全）、8.1（约束）、9（测试）、10（运行方式）节。唯一延期项：设计第 6 节"暗色主题"未纳入 P1，随 P2 计划实现。
- [ ] 占位符扫描：无 TODO/待定/占位代码；`<ADMIN_PASSWORD>`、`<SSH密码>`、`<id>` 均为命令执行时需填入的变量
- [ ] 类型一致性：前后端接口字段名一致（MonitorData 与 parseMonitorOutput、ServerInfo 与 mask 输出、LoginResult 与 login 响应、ServerPayload 与 servers 路由校验字段）

