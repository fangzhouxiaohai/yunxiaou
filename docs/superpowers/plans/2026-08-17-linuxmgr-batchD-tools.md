# 批次 D：工具菜单（日志/计划任务/文件管理/SSL/Web 终端）实现计划

> executing-plans 逐任务实现。

**目标：** 新增 5 个工具：日志查看、计划任务、文件管理、SSL 证书、交互式 Web 终端。

**架构：** 新路由 `routes/logs.js`、`routes/crontab.js`、`routes/files.js`、`routes/ssl.js`、`routes/terminal.js`（ws + ssh2 shell）；前端新页面 views/logs、views/crontab、views/files、views/ssl、views/terminal（xterm.js）。

**新依赖：** `ws`（后端）、`xterm` + `xterm-addon-fit`（前端）。

**约束（8.1）：** 危险路径保护（/etc/shadow 等禁改）；删除走回收站 `/tmp/linuxmgr-trash/`；crontab 行带 `linuxmgr-` 注释标记；SSL 文件前缀隔离；终端是用户主动操作（审计记录连接）。

---

### 任务 D1：日志与计划任务后端

**文件：**
- 创建：`server/src/routes/logs.js`、`server/src/routes/crontab.js`
- 测试：`server/test/logs.test.js`、`server/test/crontab.test.js`
- 修改：`server/src/index.js`

- [ ] **步骤 1：日志路由**

```js
// GET /servers/:id/logs/files — 常用日志路径列表（存在性检测）：
//   /var/log/nginx/error.log, /var/log/nginx/access.log, /var/log/mysql/error.log,
//   /var/log/php-fpm/error.log, /var/log/messages, /var/log/secure, /var/log/auth.log,
//   /var/log/syslog, journalctl 最近服务列表（journalctl --no-pager -n 0 简化为跳过）
//   返回 [{ path, exists, size }]
// GET /servers/:id/logs/read?path=&lines=200
//   路径校验：^/var/log/[a-zA-Z0-9_/.-]+$ 或 /tmp/linuxmgr- 前缀；禁 ../；lines 1-1000
//   命令：tail -n <lines> <path>（不存在 → 400）
```

- [ ] **步骤 2：计划任务路由**

```js
// GET /servers/:id/crontabs — crontab -l 2>/dev/null 解析为 [{ line, expression, command, ours }]
//   ours = 行包含 'linuxmgr-' 注释标记
// POST /servers/:id/crontabs — { expression, command }
//   expression 校验：/^(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)\s+(\d+|\*|\*\/\d+|[0-9,-]+)$/
//   command：assertCommandSafe + 长度 ≤ 500
//   写入：crontab -l 2>/dev/null; echo "# linuxmgr-<uuid前8> <timestamp>"; echo "<expression> <command>" | crontab -
//   注意：管道 crontab - 是标准用法（不在 exec 黑名单）
// DELETE /servers/:id/crontabs/:id — 按 linuxmgr- 标记行号删除（只删 ours 行）：
//   crontab -l | grep -v '^# linuxmgr-<id> ' | crontab -（grep -v 过滤）
//   全部写操作审计
```

- [ ] **步骤 3：挂载 + 测试 + Commit** `feat: 日志查看与计划任务管理`

---

### 任务 D2：文件管理与 SSL 后端

**文件：**
- 创建：`server/src/routes/files.js`、`server/src/routes/ssl.js`
- 测试：`server/test/files.test.js`、`server/test/ssl.test.js`
- 修改：`server/src/index.js`

- [ ] **步骤 1：文件路由**

```js
// GET /servers/:id/files?path=/www — ls -la --time-style=long-iso <path> 解析：
//   [{ name, type: dir|file|link, size, mtime, mode, owner }]（跳过 . ..）
//   路径校验：^/[a-zA-Z0-9_/.-]{1,200}$（禁 /、/etc、/proc、/sys 等保护路径的写操作）
// POST /servers/:id/files/read { path } — cat（≤1MB 截断），危险路径禁止读取 /etc/shadow 等
// POST /servers/:id/files/write { path, content } — 写（保护路径禁止；> 512KB 拒绝）
// POST /servers/:id/files/mkdir { path } — mkdir -p
// POST /servers/:id/files/delete { path, confirm } — mv 到 /tmp/linuxmgr-trash/<basename>-<ts>（不直接删除）
// POST /servers/:id/files/rename { path, newName } — mv
// POST /servers/:id/files/chmod { path, mode } — chmod（mode 校验 ^[0-7]{3,4}$）
// 保护路径（读写禁）：/etc/shadow /etc/passwd /etc/sudoers /etc/ssh /root/.ssh /boot /proc /sys /dev
```

- [ ] **步骤 2：SSL 路由**

```js
// GET /servers/:id/ssl — openssl x509 读取 nginx vhost 中 linuxmgr- 证书信息：
//   ls /etc/nginx/ssl/linuxmgr-*.crt 2>/dev/null 解析域名列表；openssl x509 -in <crt> -noout -subject -dates -issuer
//   返回 [{ domain, subject, notBefore, notAfter, issuer }]
// POST /servers/:id/ssl/upload { domain, cert, key } — 写入 /etc/nginx/ssl/linuxmgr-<domain>.crt/.key
//   （domain ^[a-zA-Z0-9.-]{1,100}$；cert/key PEM 校验 ^-----BEGIN ；长度限制 64KB）；审计
// POST /servers/:id/ssl/selfsigned { domain } — openssl req -x509 -newkey rsa:2048 -nodes -days 365
//   -keyout .../linuxmgr-<domain>.key -out .../linuxmgr-<domain>.crt -subj "/CN=<domain>"
//   若存在同域 linuxmgr- 项目 vhost → 追加 ssl 配置段（listen 443 ssl + cert 路径）并 nginx -s reload
//   不触碰非 linuxmgr- 配置
```

- [ ] **步骤 3：挂载 + 测试 + Commit** `feat: 文件管理与 SSL 证书管理`

---

### 任务 D3：交互式 Web 终端

**文件：**
- 依赖：`npm install ws`（server）、`npm install xterm @xterm/addon-fit`（apps/web）
- 创建：`server/src/routes/terminal.js`（WebSocket + ssh2 shell）
- 创建：`apps/web/src/views/terminal/index.vue`（xterm.js）
- 修改：`server/src/index.js`（http server 升级 ws）、`apps/web/src/router/index.ts`、`layout/index.vue`

- [ ] **步骤 1：后端 WebSocket**

```js
// 独立 http server（端口 +1 或复用 3000 升级）：用 server 的 upgrade 事件挂 /api/terminal/ws
// 认证：ws url query token（JWT verify）
// 流程：verify token → 读服务器记录（query serverId）→ 解密密码 → new ssh2 Client().connect
//   → client.shell({ term: 'xterm-256color' }) → 双向：ws.on('message') → stream.write；
//   stream.on('data') → ws.send；close/error 清理
// 超时：15s 内未连接成功关闭；空闲 30min 自动断开
// 审计：terminal.connect 记录（target server + user）
// 实现细节：ssh2 shell 的 stream 需在 on('ready') 后调用；ws 帧二进制/文本兼容（xterm 发字符串）
```

- [ ] **步骤 2：前端终端页**

```vue
// xterm.js：Terminal({ cursorBlink: true, fontSize: 13, theme: 深色 }) + FitAddon
// 挂载到 div；new WebSocket(`ws://${location.host}/api/terminal/ws?token=...&serverId=...`)
//   ws.onmessage → term.write(data)；term.onData(d => ws.send(d))
// resize → fit + ws.send JSON { resize: {cols, rows} }（后端 stream.setWindow）
// 断开显示重连按钮；顶部显示当前服务器名
// ws 路径注意：dev 下 vite 代理 ws → 后端（vite proxy ws: true 或直接连 3000 端口；用 /api 代理 ws:true）
```

- [ ] **步骤 3：菜单/路由**（/terminal，图标 Monitor）
- [ ] **步骤 4：验证**：vue-tsc 0 错误；后端 ws 测试（mock ssh2 Client 可省略——手动验证为主）
- [ ] **步骤 5：Commit** `feat: 交互式 Web 终端（WebSocket + xterm.js）`

---

### 任务 D4：前端页面（日志/计划任务/文件/SSL）+ 验证

**文件：**
- 创建：`apps/web/src/api/logs.ts`、`crontab.ts`、`files.ts`、`ssl.ts`
- 创建：`apps/web/src/views/logs/index.vue`、`views/crontab/index.vue`、`views/files/index.vue`、`views/ssl/index.vue`
- 修改：`router/index.ts`、`layout/index.vue`

- [ ] **步骤 1：日志页**：常用日志下拉 + 自定义路径输入 + tail 文本区（3s 轮询刷新）+ 行数选择
- [ ] **步骤 2：计划任务页**：crontab 表格（表达式/命令/ours 标记）+ 新增对话框（表达式校验提示 + 命令输入）+ 删除（仅 ours）
- [ ] **步骤 3：文件管理页**：面包屑路径导航 + 表格（名称/类型/大小/修改时间）+ 操作（进入目录/查看/编辑/重命名/删除/新建目录/chmod 对话框）+ 编辑 dialog（textarea）+ 危险路径提示
- [ ] **步骤 4：SSL 页**：证书表格（域名/主题/有效期/颁发者）+ 上传 dialog（cert/key textarea）+ 自签按钮（域名输入）
- [ ] **步骤 5：验证**：vue-tsc；真实服务器只读验证（日志文件列表/tail、crontab -l、ls /www、ssl 列表）
- [ ] **步骤 6：Commit** `feat: 工具菜单前端页面` + `chore: 完成批次 D 端到端验证`

---

## 自检记录
- [ ] 规格覆盖：批次 D 全部 5 项（日志/计划任务/文件/SSL/终端）
- [ ] 约束：回收站/前缀隔离/危险路径保护/审计全覆盖
