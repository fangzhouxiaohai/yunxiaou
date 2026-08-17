# 云小U 前端整体 UI 美化 + 暗色模式 + 响应式 + 修改密码 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不改业务逻辑的前提下，整体美化云小U Web 面板（Vue 3 + Element Plus），新增暗色模式切换、响应式/移动端适配、修改密码功能（默认凭据 admin / 123456）。

**架构：** 后端新增凭据持久化模块（`data/auth.json`，scrypt 加盐哈希，优先级 auth.json > .env > 默认值）和 `PUT /api/auth/password` 接口。前端建立全局设计令牌层（亮/暗双套 CSS 变量 + Element Plus 变量覆盖），重做布局外壳与登录页，逐页精修 12 个业务视图。

**技术栈：** Node.js + Express + node:test + supertest（后端）；Vue 3 + TypeScript + Element Plus + Pinia + SCSS + ECharts（前端）。

**规格文档：** `docs/superpowers/specs/2026-08-17-ui-beautify-design.md`

---

## 文件结构

**后端：**
- 创建 `server/src/auth/credentials.js` — 凭据读取/校验/修改（auth.json 持久化，scrypt 哈希）
- 修改 `server/src/config.js` — 默认密码兜底改为 `123456`
- 修改 `server/src/routes/auth.js` — 登录改用 credentials 校验；新增 `PUT /password`
- 修改 `server/src/index.js` — 创建 credentials 实例传入 auth 路由
- 修改 `server/.env.example` — `ADMIN_PASSWORD=123456`
- 修改 `server/test/api.test.js` — 修改密码接口测试
- 修改 `server/test/config.test.js` — 默认值断言改为 `123456`

**前端：**
- 重写 `apps/web/src/styles/index.scss` — 设计令牌（亮/暗）+ Element Plus 覆盖 + 全局细节 + 工具类
- 创建 `apps/web/src/stores/theme.ts` — 亮/暗模式状态（localStorage 持久化，跟随系统）
- 修改 `apps/web/src/main.ts` — 引入 Element Plus 暗色变量 CSS
- 修改 `apps/web/src/App.vue` — 启动时初始化主题
- 创建 `apps/web/src/layout/SideMenu.vue` — 侧边菜单（桌面侧边栏与移动端抽屉共用）
- 重写 `apps/web/src/layout/index.vue` — 外壳重做：暗色切换、修改密码对话框、移动端抽屉
- 修改 `apps/web/src/api/auth.ts` — 新增 `changePassword`
- 重写 `apps/web/src/views/login/index.vue`
- 重写 `apps/web/src/views/dashboard/index.vue`
- 修改其余 10 个视图（servers / databases / store / projects / supervisor / disk / files / ssl / logs / crontab / terminal）

---

## 任务 1：后端凭据模块 credentials.js

**文件：**
- 创建：`server/src/auth/credentials.js`
- 测试：`server/test/api.test.js`（任务 3 中写接口测试）

- [ ] **步骤 1：创建 credentials.js**

```js
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 凭据优先级：data/auth.json > 环境变量 > 默认值（admin / 123456）
function createCredentials({ dataDir, envUser, envPassword }) {
  const file = path.join(dataDir, 'auth.json');

  function readStored() {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function current() {
    const stored = readStored();
    if (stored && stored.username && stored.passwordHash && stored.salt) return stored;
    return { username: envUser || 'admin', password: envPassword || '123456' };
  }

  function verify(username, password) {
    const c = current();
    if (username !== c.username) return false;
    if (c.password !== undefined) {
      return safeEqualStr(password || '', c.password);
    }
    return safeEqualHex(hashPassword(password || '', c.salt), c.passwordHash);
  }

  function setPassword(newPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const data = {
      username: current().username,
      passwordHash: hashPassword(newPassword, salt),
      salt,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return data.username;
  }

  return { verify, setPassword };
}

module.exports = { createCredentials };
```

- [ ] **步骤 2：Commit**

```bash
git add server/src/auth/credentials.js
git commit -m "feat(server): 凭据持久化模块，支持运行时修改密码"
```

---

## 任务 2：接入配置默认值与路由

**文件：**
- 修改：`server/src/config.js:22-25`
- 修改：`server/src/routes/auth.js`（全文替换）
- 修改：`server/src/index.js`（auth 路由挂载处）
- 修改：`server/.env.example`
- 修改：`server/test/config.test.js:28`

- [ ] **步骤 1：config.js 默认密码改为 123456**

`server/src/config.js` 第 22-25 行改为：

```js
  if (!config.adminPassword) {
    config.adminPassword = '123456';
    warnings.push('ADMIN_PASSWORD 未设置，使用默认值 123456（生产环境必须修改）');
  }
```

- [ ] **步骤 2：config.test.js 断言同步更新**

`server/test/config.test.js` 第 28 行：

```js
  assert.equal(config.adminPassword, '123456');
```

- [ ] **步骤 3：.env.example 更新**

`server/.env.example` 中 `ADMIN_PASSWORD=change-me` 改为 `ADMIN_PASSWORD=123456`。

- [ ] **步骤 4：重写 server/src/routes/auth.js**

```js
const express = require('express');
const { signToken } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');
const { audit } = require('../utils/audit');

function createAuthRouter({ config, credentials }) {
  const router = express.Router();
  const failures = new Map(); // ip -> { fails, lockedUntil }

  function checkLocked(req, res) {
    const rec = failures.get(req.ip || 'unknown');
    if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
      res.status(429).json({ code: 429, message: '失败次数过多，已锁定 15 分钟' });
      return true;
    }
    return false;
  }

  function noteFailure(ip) {
    const now = Date.now();
    const rec = failures.get(ip);
    const next = { fails: (rec ? rec.fails : 0) + 1, lockedUntil: null };
    if (next.fails >= 5) {
      next.lockedUntil = now + 15 * 60 * 1000;
      next.fails = 0;
    }
    failures.set(ip, next);
  }

  router.post('/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (checkLocked(req, res)) return;
    const { username, password } = req.body || {};
    const ok = credentials.verify(username, password || '');
    if (!ok) {
      noteFailure(ip);
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

  router.put('/password', requireAuth(config), (req, res) => {
    const ip = req.ip || 'unknown';
    if (checkLocked(req, res)) return;
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ code: 400, message: '新密码至少 6 位' });
    }
    if (!credentials.verify(req.user.username, oldPassword || '')) {
      noteFailure(ip);
      audit(config.dataDir, { action: 'change-password', target: ip, detail: `user=${req.user.username}`, result: 'fail' });
      return res.status(400).json({ code: 400, message: '原密码错误' });
    }
    failures.delete(ip);
    credentials.setPassword(newPassword);
    audit(config.dataDir, { action: 'change-password', target: ip, detail: `user=${req.user.username}`, result: 'success' });
    res.json({ code: 0, data: { message: '密码修改成功' } });
  });

  return router;
}

module.exports = createAuthRouter;
```

- [ ] **步骤 5：index.js 创建 credentials 并传入**

`server/src/index.js` 顶部 require 区加：

```js
const { createCredentials } = require('./auth/credentials');
```

`createApp` 函数体内、`app.use('/api/auth', ...)` 之前加：

```js
  const credentials = createCredentials({
    dataDir: config.dataDir,
    envUser: config.adminUser,
    envPassword: config.adminPassword,
  });
```

并把 `app.use('/api/auth', createAuthRouter({ config }));` 改为：

```js
  app.use('/api/auth', createAuthRouter({ config, credentials }));
```

- [ ] **步骤 6：运行现有测试确认无回归**

运行：`cd server && npm test`
预期：全部 PASS（config.test.js 已同步改断言）

---

## 任务 3：修改密码接口测试（TDD 验证）

**文件：**
- 测试：`server/test/api.test.js`（文件末尾追加）

- [ ] **步骤 1：追加测试**

在 `server/test/api.test.js` 末尾追加：

```js
test('修改密码：成功后旧密码失效、新密码可登录', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).put('/api/auth/password').set(auth)
    .send({ oldPassword: 'pw', newPassword: 'newpass1' });
  assert.equal(res.status, 200);
  const oldLogin = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'newpass1' });
  assert.equal(newLogin.status, 200);
});

test('修改密码：原密码错误返回 400', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const res = await request(app).put('/api/auth/password').set(auth)
    .send({ oldPassword: 'wrong', newPassword: 'newpass1' });
  assert.equal(res.status, 400);
});

test('修改密码：新密码少于 6 位返回 400，未登录返回 401', async () => {
  const { app } = setup();
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const short = await request(app).put('/api/auth/password').set(auth)
    .send({ oldPassword: 'pw', newPassword: '123' });
  assert.equal(short.status, 400);
  const noAuth = await request(app).put('/api/auth/password')
    .send({ oldPassword: 'pw', newPassword: 'newpass1' });
  assert.equal(noAuth.status, 401);
});
```

- [ ] **步骤 2：运行测试**

运行：`cd server && npm test`
预期：全部 PASS（含新增 3 个测试）

- [ ] **步骤 3：Commit**

```bash
git add server/src server/.env.example server/test
git commit -m "feat(server): 修改密码接口 PUT /api/auth/password，默认凭据 admin/123456"
```

---

## 任务 4：前端全局设计层 styles/index.scss

**文件：**
- 重写：`apps/web/src/styles/index.scss`

- [ ] **步骤 1：全文替换为**

```scss
// ===== 设计令牌 =====
:root {
  // 主色与语义色
  --brand: #3b6fe0;
  --brand-hover: #5c87e6;
  --brand-active: #2f5cc4;
  --success: #34a06e;
  --warning: #d98e2b;
  --danger: #d95555;

  // 灰阶与背景
  --bg-page: #f5f7fa;
  --bg-card: #ffffff;
  --bg-hover: #f2f5fa;
  --bg-table-head: #f7f8fa;
  --border: #e4e8ef;
  --border-light: #edf0f5;
  --text-1: #1f2733;
  --text-2: #5a6472;
  --text-3: #98a1ad;

  // 侧边栏（亮暗模式共用深色）
  --aside-bg: #0f1f3d;
  --aside-bg-2: #16294d;
  --aside-text: #9fb0c9;
  --aside-active-bg: rgba(59, 111, 224, 0.22);
  --aside-active-text: #ffffff;
  --aside-bar: #3b6fe0;

  // 圆角与阴影
  --radius-card: 8px;
  --radius-ctrl: 6px;
  --shadow-card: 0 1px 2px rgba(16, 32, 64, 0.04), 0 2px 8px rgba(16, 32, 64, 0.06);
  --shadow-pop: 0 6px 24px rgba(16, 32, 64, 0.14);

  // 间距
  --gap: 16px;
}

html.dark {
  --bg-page: #141a24;
  --bg-card: #1c2431;
  --bg-hover: #242e3d;
  --bg-table-head: #222b39;
  --border: #303a4a;
  --border-light: #2a3342;
  --text-1: #e4e9f0;
  --text-2: #a3adbb;
  --text-3: #6d7787;
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.35);
  --shadow-pop: 0 6px 24px rgba(0, 0, 0, 0.5);
}

// ===== Element Plus 变量覆盖 =====
:root {
  --el-color-primary: var(--brand);
  --el-color-primary-light-3: #6a92e9;
  --el-color-primary-light-5: #93aef0;
  --el-color-primary-light-7: #bccaf6;
  --el-color-primary-light-8: #d2dcf9;
  --el-color-primary-light-9: #e8eefe;
  --el-color-primary-dark-2: var(--brand-active);
  --el-color-success: var(--success);
  --el-color-warning: var(--warning);
  --el-color-danger: var(--danger);
  --el-border-radius-base: var(--radius-ctrl);
  --el-border-color: var(--border);
  --el-border-color-light: var(--border-light);
  --el-border-color-lighter: var(--border-light);
  --el-fill-color-light: var(--bg-hover);
  --el-text-color-primary: var(--text-1);
  --el-text-color-regular: var(--text-2);
  --el-text-color-secondary: var(--text-3);
  --el-bg-color: var(--bg-card);
  --el-bg-color-overlay: var(--bg-card);
  --el-box-shadow-light: var(--shadow-card);
  --el-box-shadow: var(--shadow-pop);
}

// ===== 基础 =====
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
body {
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif;
  color: var(--text-1);
  background: var(--bg-page);
  -webkit-font-smoothing: antialiased;
}
::selection { background: rgba(59, 111, 224, 0.2); }

// 细滚动条
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: rgba(120, 132, 150, 0.35); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(120, 132, 150, 0.55); }
::-webkit-scrollbar-track { background: transparent; }

// ===== Element Plus 组件细节 =====
.el-card {
  border: none;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  background: var(--bg-card);
}
.el-card__header { border-bottom: 1px solid var(--border-light); font-weight: 600; }

.el-table { --el-table-header-bg-color: var(--bg-table-head); --el-table-row-hover-bg-color: var(--bg-hover); }
.el-table th.el-table__cell { font-weight: 600; color: var(--text-2); }

.el-dialog { border-radius: var(--radius-card); }
.el-drawer { background: var(--bg-card); }
.el-message-box { border-radius: var(--radius-card); }

.el-button { font-weight: 500; }

// ===== 通用工具类 =====
.num { font-variant-numeric: tabular-nums; }

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: var(--gap);
  .page-title { font-size: 17px; font-weight: 600; color: var(--text-1); }
  .page-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
}

// 深色日志/代码块（projects / files / logs 共用）
.code-box {
  background: #0d1117;
  color: #c9d1d9;
  border-radius: var(--radius-ctrl);
  padding: 12px 16px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
}
```

- [ ] **步骤 2：构建验证**

运行：`cd apps/web && npm run build`
预期：构建成功（样式改动不影响类型检查）

- [ ] **步骤 3：Commit**

```bash
git add apps/web/src/styles/index.scss
git commit -m "feat(web): 全局设计令牌层与 Element Plus 主题覆盖"
```

---

## 任务 5：暗色模式基础设施

**文件：**
- 创建：`apps/web/src/stores/theme.ts`
- 修改：`apps/web/src/main.ts`
- 修改：`apps/web/src/App.vue`

- [ ] **步骤 1：创建 theme store**

```ts
import { defineStore } from 'pinia'

type ThemeMode = 'light' | 'dark'
const KEY = 'linuxmgr_theme'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: (localStorage.getItem(KEY) as ThemeMode | null) || (systemPrefersDark() ? 'dark' : 'light') as ThemeMode,
  }),
  actions: {
    apply() {
      document.documentElement.classList.toggle('dark', this.mode === 'dark')
    },
    toggle() {
      this.mode = this.mode === 'dark' ? 'light' : 'dark'
      localStorage.setItem(KEY, this.mode)
      this.apply()
    },
  },
})
```

- [ ] **步骤 2：main.ts 引入暗色变量**

`apps/web/src/main.ts` 在 `import 'element-plus/dist/index.css'` 之后加一行：

```ts
import 'element-plus/theme-chalk/dark/css-vars.css'
```

- [ ] **步骤 3：App.vue 启动时应用主题**

`apps/web/src/App.vue` 全文替换为：

```vue
<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
onMounted(() => themeStore.apply())
</script>
```

- [ ] **步骤 4：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/stores/theme.ts apps/web/src/main.ts apps/web/src/App.vue
git commit -m "feat(web): 暗色模式状态管理与 Element Plus 暗色变量接入"
```

---

## 任务 6：布局外壳重做（含暗色切换、修改密码、移动端抽屉）

**文件：**
- 创建：`apps/web/src/layout/SideMenu.vue`
- 重写：`apps/web/src/layout/index.vue`
- 修改：`apps/web/src/api/auth.ts`

- [ ] **步骤 1：api/auth.ts 增加 changePassword**

文件末尾追加：

```ts
export function changePassword(oldPassword: string, newPassword: string) {
  return request.put('/auth/password', { oldPassword, newPassword }) as Promise<{ message: string }>
}
```

- [ ] **步骤 2：创建 SideMenu.vue**

```vue
<template>
  <el-menu
    router
    :default-active="$route.path"
    class="side-menu"
    background-color="transparent"
    :text-color="'var(--aside-text)'"
    active-text-color="#ffffff"
    @select="emit('select')"
  >
    <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><span>监控大盘</span></el-menu-item>
    <el-menu-item index="/servers"><el-icon><Monitor /></el-icon><span>服务器管理</span></el-menu-item>
    <el-menu-item index="/databases"><el-icon><Coin /></el-icon><span>数据库管理</span></el-menu-item>
    <el-menu-item index="/store"><el-icon><Shop /></el-icon><span>软件商店</span></el-menu-item>
    <el-menu-item index="/disk"><el-icon><Files /></el-icon><span>磁盘管理</span></el-menu-item>
    <el-menu-item index="/supervisor"><el-icon><Cpu /></el-icon><span>进程守护</span></el-menu-item>
    <el-menu-item index="/projects"><el-icon><Box /></el-icon><span>项目</span></el-menu-item>
    <el-menu-item index="/terminal"><el-icon><Monitor /></el-icon><span>终端</span></el-menu-item>
    <el-menu-item index="/logs"><el-icon><Document /></el-icon><span>日志</span></el-menu-item>
    <el-menu-item index="/crontab"><el-icon><AlarmClock /></el-icon><span>计划任务</span></el-menu-item>
    <el-menu-item index="/files"><el-icon><Folder /></el-icon><span>文件管理</span></el-menu-item>
    <el-menu-item index="/ssl"><el-icon><Lock /></el-icon><span>SSL 证书</span></el-menu-item>
  </el-menu>
</template>

<script setup lang="ts">
import { Odometer, Monitor, Coin, Shop, Files, Cpu, Box, Document, AlarmClock, Folder, Lock } from '@element-plus/icons-vue'

const emit = defineEmits<{ (e: 'select'): void }>()
</script>

<style lang="scss">
.side-menu {
  border-right: none;
  padding: 8px;
  --el-menu-item-height: 44px;
  --el-menu-item-font-size: 14px;
  .el-menu-item {
    border-radius: 6px;
    margin-bottom: 2px;
    position: relative;
    transition: background 0.2s;
    &:hover { background: rgba(255, 255, 255, 0.06); }
    &.is-active {
      background: var(--aside-active-bg);
      color: var(--aside-active-text);
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 3px;
        border-radius: 2px;
        background: var(--aside-bar);
      }
    }
  }
}
</style>
```

注意：该文件使用非 scoped 的 `<style lang="scss">`，因为 el-menu 的选中态需要穿透到菜单项。

- [ ] **步骤 3：重写 layout/index.vue**

```vue
<template>
  <el-container class="layout">
    <el-aside v-if="!isMobile" width="220px" class="aside">
      <div class="logo">云小U</div>
      <SideMenu />
    </el-aside>
    <el-drawer
      v-model="drawerVisible"
      direction="ltr"
      :with-header="false"
      size="220px"
      class="menu-drawer"
    >
      <div class="logo">云小U</div>
      <SideMenu @select="drawerVisible = false" />
    </el-drawer>
    <el-container>
      <el-header class="header" height="56px">
        <div class="header-left">
          <el-icon v-if="isMobile" class="menu-btn" @click="drawerVisible = true"><Expand /></el-icon>
          <div class="header-title">{{ $route.meta.title || '' }}</div>
        </div>
        <div class="header-right">
          <el-tooltip :content="themeStore.mode === 'dark' ? '切换为亮色' : '切换为暗色'" placement="bottom">
            <el-icon class="theme-btn" @click="themeStore.toggle()">
              <Sunny v-if="themeStore.mode === 'dark'" />
              <Moon v-else />
            </el-icon>
          </el-tooltip>
          <el-select
            :model-value="serverStore.currentId"
            placeholder="选择服务器"
            class="server-select"
            @change="serverStore.switchServer"
          >
            <el-option
              v-for="s in serverStore.servers"
              :key="s.id"
              :label="`${s.name} (${s.host})`"
              :value="s.id"
            />
          </el-select>
          <span class="divider" />
          <el-dropdown @command="onCommand">
            <span class="user">
              <el-icon><User /></el-icon>
              <span class="username">{{ userStore.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
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

  <el-dialog v-model="pwdVisible" title="修改密码" width="min(400px, 92vw)">
    <el-form :model="pwdForm" label-width="80px">
      <el-form-item label="原密码">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input v-model="pwdForm.confirm" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdVisible = false">取消</el-button>
      <el-button type="primary" :loading="pwdLoading" @click="onChangePassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Expand, Sunny, Moon, User, ArrowDown } from '@element-plus/icons-vue'
import SideMenu from './SideMenu.vue'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { changePassword } from '@/api/auth'

const router = useRouter()
const serverStore = useServerStore()
const userStore = useUserStore()
const themeStore = useThemeStore()

const drawerVisible = ref(false)
const isMobile = ref(window.matchMedia('(max-width: 1023px)').matches)
const mq = window.matchMedia('(max-width: 1023px)')
function onMqChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
  if (!e.matches) drawerVisible.value = false
}

const pwdVisible = ref(false)
const pwdLoading = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

onMounted(() => {
  serverStore.load().catch(() => {})
  mq.addEventListener('change', onMqChange)
})
onBeforeUnmount(() => mq.removeEventListener('change', onMqChange))

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    userStore.logout()
    router.push('/login')
  } else if (cmd === 'password') {
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirm = ''
    pwdVisible.value = true
  }
}

async function onChangePassword() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    ElMessage.warning('请填写原密码和新密码')
    return
  }
  if (pwdForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirm) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  pwdLoading.value = true
  try {
    await changePassword(pwdForm.oldPassword, pwdForm.newPassword)
    ElMessage.success('密码修改成功')
    pwdVisible.value = false
  } catch {
    /* 错误已由 request 拦截器提示 */
  } finally {
    pwdLoading.value = false
  }
}
</script>

<style scoped lang="scss">
.layout { height: 100%; }
.aside {
  background: linear-gradient(180deg, var(--aside-bg), var(--aside-bg-2));
  .logo {
    height: 56px;
    line-height: 56px;
    text-align: center;
    color: #fff;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 1px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 4px;
  }
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  box-shadow: 0 1px 4px rgba(16, 32, 64, 0.08);
  position: relative;
  z-index: 1;
  .header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .menu-btn { font-size: 20px; cursor: pointer; color: var(--text-2); }
  .header-title { font-size: 17px; font-weight: 600; white-space: nowrap; }
  .header-right { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .theme-btn { font-size: 18px; cursor: pointer; color: var(--text-2); &:hover { color: var(--brand); } }
  .server-select { width: 240px; max-width: 40vw; }
  .divider { width: 1px; height: 20px; background: var(--border); }
  .user {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    &:hover { color: var(--brand); }
  }
}
.main { background: var(--bg-page); padding: var(--gap); }

@media (max-width: 767px) {
  .header .username { display: none; }
  .header .server-select { width: 150px; }
}
</style>

<style lang="scss">
// 移动端抽屉内的深色菜单（需全局选择器穿透 drawer）
.menu-drawer {
  --el-drawer-bg-color: var(--aside-bg);
  background: linear-gradient(180deg, var(--aside-bg), var(--aside-bg-2));
  .logo {
    height: 56px;
    line-height: 56px;
    text-align: center;
    color: #fff;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 1px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 4px;
  }
}
</style>
```

- [ ] **步骤 4：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/layout apps/web/src/api/auth.ts
git commit -m "feat(web): 布局外壳重做，新增暗色切换、修改密码对话框与移动端抽屉菜单"
```

---

## 任务 7：登录页重做

**文件：**
- 重写：`apps/web/src/views/login/index.vue`

- [ ] **步骤 1：全文替换为**

```vue
<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="brand">
        <div class="brand-name">云小U</div>
        <div class="brand-sub">服务器管理面板</div>
      </div>
      <el-form :model="form" @keyup.enter="onSubmit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" size="large" class="submit" :loading="loading" @click="onSubmit">
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
import { User, Lock } from '@element-plus/icons-vue'
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
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(59, 111, 224, 0.35), transparent),
    radial-gradient(ellipse 50% 40% at 85% 85%, rgba(43, 90, 160, 0.4), transparent),
    linear-gradient(135deg, #0f1f3d, #1f3b73);
}
.login-card {
  width: min(440px, 92vw);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  animation: rise 0.4s ease-out;
  :deep(.el-card__body) { padding: 36px 36px 28px; }
  .brand { text-align: center; margin-bottom: 28px; }
  .brand-name { font-size: 26px; font-weight: 700; color: var(--brand); letter-spacing: 2px; }
  .brand-sub { margin-top: 6px; font-size: 13px; color: var(--text-3); }
  .submit { width: 100%; letter-spacing: 4px; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
```

- [ ] **步骤 2：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/views/login/index.vue
git commit -m "feat(web): 登录页视觉重做"
```

---

## 任务 8：监控大盘重做（指标卡 + 响应式 + ECharts 主题感知）

**文件：**
- 重写：`apps/web/src/views/dashboard/index.vue`

- [ ] **步骤 1：全文替换为**

```vue
<template>
  <div v-if="!serverStore.current">
    <el-empty description="请先在「服务器管理」中添加服务器，并在顶部选择要监控的服务器" />
  </div>
  <div v-else>
    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#3b6fe0"><Cpu /></el-icon>
            <div>
              <div class="label">CPU 使用率</div>
              <div class="value num">{{ cpuText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#34a06e"><Coin /></el-icon>
            <div>
              <div class="label">内存</div>
              <div class="value num">{{ memText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#d98e2b"><Files /></el-icon>
            <div>
              <div class="label">磁盘（根分区）</div>
              <div class="value num">{{ diskText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <el-card class="metric-card">
          <div class="metric">
            <el-icon class="metric-icon" color="#7a5fd0"><Odometer /></el-icon>
            <div>
              <div class="label">负载（1/5/15 分钟）</div>
              <div class="value num">{{ loadText }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="row-gap">
      <el-col :xs="24" :lg="12">
        <el-card>
          <template #header>CPU 使用率（%）</template>
          <div ref="cpuChartEl" class="chart" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card>
          <template #header>网络速率（KB/s）</template>
          <div ref="netChartEl" class="chart" />
        </el-card>
      </el-col>
    </el-row>

    <el-card class="row-gap">
      <template #header>系统信息</template>
      <el-descriptions :column="descColumn" border size="small">
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { Cpu, Coin, Files, Odometer } from '@element-plus/icons-vue'
import { getMonitor, type MonitorData } from '@/api/monitor'
import { useServerStore } from '@/stores/server'
import { useThemeStore } from '@/stores/theme'

const serverStore = useServerStore()
const themeStore = useThemeStore()
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
const MAX_POINTS = 40

const cpuText = computed(() => (current.value ? `${current.value.cpu.toFixed(1)}%` : '--'))
const memText = computed(() => {
  const m = current.value?.mem
  return m ? `${m.used} / ${m.total}（${m.percent}%）` : '--'
})
const diskText = computed(() => {
  const d = current.value?.disk?.find((x) => x.mount === '/') || current.value?.disk?.[0]
  return d ? `${d.used} / ${d.size}（${d.percent}%）` : '--'
})
const loadText = computed(() => current.value?.load?.join(' / ') || '--')
const uptimeText = computed(() => current.value?.uptime || '--')
const memAvailText = computed(() => current.value?.mem?.available || '--')
const descColumn = computed(() => (window.innerWidth < 768 ? 1 : window.innerWidth < 1200 ? 2 : 3))

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function baseChartOption(): echarts.EChartsOption {
  const dark = themeStore.mode === 'dark'
  return {
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: history.time,
      axisLine: { lineStyle: { color: dark ? '#3a4454' : '#d8dde6' } },
      axisLabel: { color: cssVar('--text-3') || '#98a1ad' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: cssVar('--text-3') || '#98a1ad' },
      splitLine: { lineStyle: { color: dark ? '#2a3342' : '#edf0f5' } },
    },
  }
}

function renderCharts() {
  if (!cpuChart || !netChart) return
  cpuChart.setOption({
    ...baseChartOption(),
    series: [{ name: 'CPU', type: 'line', smooth: true, showSymbol: false, data: history.cpu, lineStyle: { color: '#3b6fe0' }, areaStyle: { color: 'rgba(59,111,224,0.15)' } }],
  })
  netChart.setOption({
    ...baseChartOption(),
    series: [
      { name: '下行', type: 'line', smooth: true, showSymbol: false, data: history.rx, lineStyle: { color: '#34a06e' }, areaStyle: { color: 'rgba(52,160,110,0.12)' } },
      { name: '上行', type: 'line', smooth: true, showSymbol: false, data: history.tx, lineStyle: { color: '#d98e2b' }, areaStyle: { color: 'rgba(217,142,43,0.12)' } },
    ],
  })
}

async function poll() {
  if (!serverStore.currentId) return
  try {
    const data = await getMonitor(serverStore.currentId)
    current.value = data
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    history.time.push(t)
    history.cpu.push(data.cpu)
    history.rx.push(data.net.rx)
    history.tx.push(data.net.tx)
    if (history.time.length > MAX_POINTS) {
      history.time.shift(); history.cpu.shift(); history.rx.shift(); history.tx.shift()
    }
    renderCharts()
  } catch {
    /* 轮询失败静默，等待下一轮 */
  }
}

function onResize() {
  cpuChart?.resize()
  netChart?.resize()
}

onMounted(() => {
  if (cpuChartEl.value) cpuChart = echarts.init(cpuChartEl.value)
  if (netChartEl.value) netChart = echarts.init(netChartEl.value)
  poll()
  timer = window.setInterval(poll, 3000)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.removeEventListener('resize', onResize)
  cpuChart?.dispose()
  netChart?.dispose()
})

watch(() => themeStore.mode, renderCharts)
</script>

<style scoped lang="scss">
.row-gap { margin-top: var(--gap); }
.el-col { margin-bottom: var(--gap); }
.metric-card {
  .metric { display: flex; align-items: center; gap: 14px; }
  .metric-icon { font-size: 34px; flex-shrink: 0; }
  .label { font-size: 13px; color: var(--text-3); margin-bottom: 4px; }
  .value { font-size: 20px; font-weight: 600; color: var(--text-1); }
}
.chart { height: 300px; }
</style>
```

注意：本任务沿用原文件的轮询与历史队列逻辑；若原文件字段名（如 `data.net.rx`、`data.mem.percent`、`data.load`、`data.uptime`）与本计划不一致，以 `apps/web/src/api/monitor.ts` 中的 `MonitorData` 类型为准调整取值代码，结构不变。

- [ ] **步骤 2：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/views/dashboard/index.vue
git commit -m "feat(web): 监控大盘指标卡重做、响应式栅格与图表主题感知"
```

---

## 任务 9：六个列表页统一精修（servers / supervisor / crontab / ssl / logs / disk）

通用模式（每个页面都按此调整，页面已有 class 名保持不变）：

1. 模板最外层内容（`v-else` 的 div 内）顶部加页面头部：

```vue
<div class="page-header">
  <span class="page-title">页面标题</span>
  <div class="page-actions"><!-- 原 .toolbar 里的主操作按钮移到这里 --></div>
</div>
```

2. 原 `.toolbar` 的 margin-bottom 样式删除（间距由 page-header 承担）；如果按钮上方有 `.hint` 说明文字，保留在 toolbar 行内右侧。
3. 所有 `el-dialog` 的固定宽度改为响应式：`width="480px"` → `width="min(480px, 92vw)"`，以此类推。
4. el-table 保持现状（操作列已是 link 按钮，符合规范）。

**各页面具体改动（文件均在 `apps/web/src/views/`）：**

- [ ] **步骤 1：servers/index.vue（151 行）**
  - 页面标题「服务器管理」；"新增服务器" primary 按钮移入 page-actions
  - `el-dialog width="480px"` → `width="min(480px, 92vw)"`
- [ ] **步骤 2：supervisor/index.vue（165 行）**
  - 页面标题「进程守护」；"新建进程" + "刷新"移入 page-actions
  - `el-dialog width="520px"` → `width="min(520px, 92vw)"`
- [ ] **步骤 3：crontab/index.vue（242 行）**
  - 页面标题「计划任务」；"新增计划任务" + "刷新"移入 page-actions
  - `el-dialog width="520px"` → `width="min(520px, 92vw)"`
- [ ] **步骤 4：ssl/index.vue（186 行）**
  - 页面标题「SSL 证书」；"上传证书" / "生成自签证书" / "刷新"移入 page-actions
  - 三个 dialog：640px / 480px / 420px 均改为 `min(Npx, 92vw)`
- [ ] **步骤 5：logs/index.vue（77 行）**
  - 页面标题「日志」；原 `.toolbar` 的一排控件（日志文件选择、自定义路径、读取、行数、自动刷新）移入 page-actions
  - `.log-box` 的样式定义删除，class 改为全局 `code-box`（保留 max-height:65vh，可在页面 style 里加 `.code-box { max-height: 65vh; }`）
- [ ] **步骤 6：disk/index.vue（137 行）**
  - 页面标题「磁盘管理」（该页无主操作按钮，page-actions 留空即可，或放"刷新"按钮如果已有）
  - `el-dialog width="440px"` → `width="min(440px, 92vw)"`
- [ ] **步骤 7：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/views
git commit -m "feat(web): 六个列表页统一页面头部与响应式对话框"
```

---

## 任务 10：软件商店精修

**文件：**
- 修改：`apps/web/src/views/store/index.vue`（278 行）

- [ ] **步骤 1：具体改动**
  - 顶部加页面头部：标题「软件商店」（无顶部按钮则 page-actions 留空）
  - 软件卡片栅格响应式：`el-col :span="6"` → `:xs="24" :sm="12" :lg="8" :xl="6"`
  - `.soft-card` 加统一高度与层级：卡片 body 改 flex 纵列，`.soft-desc` 保持 min-height:36px 打底对齐，按钮区 `margin-top: auto` 沉底对齐：

```scss
.soft-card {
  height: 100%;
  :deep(.el-card__body) { display: flex; flex-direction: column; height: 100%; }
  .soft-actions { margin-top: auto; padding-top: 12px; }
}
```

  - 若现有模板没有统一的 `.soft-actions` 容器，把各类型分支的按钮组外包一层 `<div class="soft-actions">`
  - 版本标签（el-tag）统一 `size="small"`，`effect="plain"`
- [ ] **步骤 2：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/views/store/index.vue
git commit -m "feat(web): 软件商店卡片栅格响应式与高度对齐"
```

---

## 任务 11：四个复杂页精修（databases / projects / files / terminal）

- [ ] **步骤 1：databases/index.vue（398 行）**
  - 顶部加页面头部：标题「数据库管理」（创建数据库按钮保留在 MySQL 列表视图的 toolbar 中，不上移）
  - Redis 统计卡 `el-col :span="6"` → `:xs="24" :sm="12" :lg="6"`
  - `el-dialog width="440px"` → `width="min(440px, 92vw)"`
  - el-page-header 样式微调：`.page-header` 类名与全局工具类冲突，重命名该页局部类为 `.db-page-header`（模板和 style 同步改）
- [ ] **步骤 2：projects/index.vue（210 行）**
  - 顶部加页面头部：标题「项目」；"创建项目" + "刷新"移入 page-actions，`.hint` 说明文字保留在卡片内表格上方
  - `el-dialog width="540px"` → `width="min(540px, 92vw)"`
  - `el-drawer size="60%"` → `:size="drawerSize"`，script 中加：

```ts
const drawerSize = computed(() => (window.innerWidth < 768 ? '100%' : '60%'))
```

（同时从 vue 导入 computed）
  - `.log-box` 样式删除，改用全局 `code-box`（保留 max-height:70vh）
- [ ] **步骤 3：files/index.vue（424 行）**
  - 顶部加页面头部：标题「文件管理」；右侧三个 small 按钮（新建文件/新建文件夹/刷新）移入 page-actions
  - `.toolbar` 保留路径输入和面包屑；`.path-input` 宽度 `320px` → `width: min(320px, 60vw)`
  - 8 个 dialog 宽度全部改为 `min(N, 92vw)`：70% → `min(900px, 92vw)`（查看、编辑两处），400px → `min(400px, 92vw)`（新建文件夹、新建文件、重命名、权限），440px → `min(440px, 92vw)`（复制、移动）
  - 操作列 7 个 link 按钮在窄屏拥挤：操作列 `width="320"` 改为 `:width="320"` 不变，按钮文字保持（移动端允许表格横向滚动，不做收起）
  - `.file-content` 样式删除，改用全局 `code-box`
- [ ] **步骤 4：terminal/index.vue（117 行）**
  - `.term-box` 高度 `calc(100vh - 220px)` 改为 `calc(100vh - 200px)`，min-height 400px 保持；加 `border-radius: var(--radius-card)` 已有则跳过
  - `.term-toolbar` 在手机下允许换行：`flex-wrap: wrap; gap: 8px`
- [ ] **步骤 5：构建验证 + Commit**

运行：`cd apps/web && npm run build`
预期：构建成功

```bash
git add apps/web/src/views
git commit -m "feat(web): 数据库/项目/文件/终端四个复杂页精修"
```

---

## 任务 12：README 与最终验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：README 更新**
  - 「功能特性」表格追加一行：`| 🎨 界面 | 亮色/暗色模式切换、响应式布局（支持移动端）、修改密码 |`
  - 「安全设计」列表追加：`- 🔐 支持在线修改管理员密码（scrypt 加盐哈希存储于 data/auth.json；已签发的 JWT 在 24h 有效期内仍然可用）`
  - 「快速开始」中默认凭据说明改为：默认账号 `admin`、默认密码 `123456`（`.env` 中 `ADMIN_PASSWORD` 显式设置时以 `.env` 为准）
- [ ] **步骤 2：全量验证**

运行：`cd server && npm test`
预期：全部 PASS

运行：`cd apps/web && npm run build`
预期：构建成功

- [ ] **步骤 3：视觉走查**

启动 `cd server && npm start` 与 `cd apps/web && npm run dev`，浏览器核对：亮色/暗色两种模式、桌面（>1024px）与手机（<768px）两种宽度下，12 个页面无错位、无溢出、无不可读文本。

- [ ] **步骤 4：Commit**

```bash
git add README.md
git commit -m "docs: 更新界面特性与默认凭据说明"
```

---

## 自检记录

- 规格第 1 节（设计层）→ 任务 4；第 2 节（外壳）→ 任务 6；第 3 节（登录页）→ 任务 7；第 4 节（逐页精修）→ 任务 8-11；第 5 节（暗色）→ 任务 4/5/6/8；第 6 节（响应式）→ 任务 6/8/9/10/11；第 7 节（修改密码）→ 任务 1/2/3/6；第 8 节（验证）→ 任务 12
- 无占位符；类型一致性：`createCredentials` 在任务 1 定义、任务 2 使用；`useThemeStore` 在任务 5 定义、任务 6/8 使用；`changePassword` 在任务 6 定义并使用
