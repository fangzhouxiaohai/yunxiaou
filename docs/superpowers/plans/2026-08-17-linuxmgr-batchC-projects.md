# 批次 C：项目菜单（PHP/Java/Python/Node）实现计划

> executing-plans 逐任务实现。

**目标：** 新增「项目」菜单：创建/管理 PHP、Java、Python、Node 四类项目（Nginx vhost 或 systemd 服务，前缀 `linuxmgr-`），支持启停/重启/状态/日志。

**架构：** 新路由 `server/src/routes/projects.js` + 本地 `data/projects.json`（JsonStore）；PHP 项目 → Nginx vhost（`/etc/nginx/conf.d/linuxmgr-*.conf` + `nginx -s reload`）；Node/Python/Java → systemd unit（`/etc/systemd/system/linuxmgr-*.service` + daemon-reload）。前端 `views/projects/index.vue` + 菜单。

**约束（8.1）：** 前缀隔离；不触碰已有配置；删除前备份 vhost 到 `data/backup/`；写操作二次确认 + 审计；nginx 只用 reload。

---

### 任务 C1：项目后端

**文件：**
- 创建：`server/src/routes/projects.js`
- 测试：`server/test/projects.test.js`
- 修改：`server/src/index.js`

- [ ] **步骤 1：编写失败的测试**（关键用例）

```js
// GET /api/servers/srv1/projects — 空列表 []
// POST 创建 node 项目 { name:'app1', type:'node', directory:'/www/app1', port:3001, entry:'node server.js' }
//   → 调用含 systemd unit 写入（linuxmgr-app1.service）、daemon-reload、systemctl start；data/projects.json 持久化
// POST 创建 php 项目 { name:'blog', type:'php', directory:'/www/blog', port:8080, phpVersion:'php81' }
//   → 调用含 /etc/nginx/conf.d/linuxmgr-blog.conf、fastcgi_pass unix:/var/run/php81-php-fpm.sock、nginx -s reload
// POST /projects/linuxmgr-app1/stop → systemctl stop linuxmgr-app1
// DELETE /projects/linuxmgr-app1 {confirm:true} → systemctl stop+disable+rm unit；node 项目不碰 nginx
// DELETE php 项目 → 备份 vhost 到 data/backup + rm + nginx -s reload
// 危险：entry 含 'rm -rf /' 被 exec 黑名单拦截（assertCommandSafe 抛错 → 502 或 400）
// 项目名/目录/端口校验：非法 → 400
```

mock 要点：scripted 按命令 key；`systemctl is-active linuxmgr-app1` 返回 active/inactive 控制状态。

- [ ] **步骤 2：运行测试验证失败**
- [ ] **步骤 3：实现 projects.js**

关键模板（heredoc 单引号防 bash 展开）：

```js
// systemd unit
const UNIT = `[Unit]
Description=linuxmgr <name> project
After=network.target

[Service]
Type=simple
WorkingDirectory=<dir>
ExecStart=<entry>
Environment=PORT=<port>
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target`;

// nginx vhost（php）
// fastcgi_pass 按 phpVersion 映射：
//   php74-83 → unix:/var/run/phpXX-php-fpm.sock（remi）
//   php8X (sury) → unix:/run/php/php8.X-fpm.sock
const VHOST = `server {
    listen <port>;
    server_name linuxmgr-<name>.local;
    root <dir>;
    index index.php index.html;
    location / { try_files $uri $uri/ =404; }
    location ~ \\.php$ {
        fastcgi_pass unix:<sock>;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}`;
```

路由：
- GET `/servers/:id/projects`：读 projects.json → 每项并行 `systemctl is-active linuxmgr-<name>`（php 项目同时检测 nginx 服务 active）→ { name(不带前缀显示), type, directory, port, entry, phpVersion, status, createdAt }
- POST `/servers/:id/projects`：校验（type whitelist、name ^[a-zA-Z0-9_-]{1,32}$、directory ^/[a-zA-Z0-9_/.-]{1,200}$ 且不在 PROTECTED、port 1-65535、entry 1-500 且 assertCommandSafe）；`mkdir -p <dir>`；按类型生成 unit/vhost（heredoc 写入）；systemd: daemon-reload + enable --now；nginx: nginx -s reload（reload 失败回滚 rm vhost）；projects.json 保存
- POST `/servers/:id/projects/:name/:action`（start/stop/restart）：仅 linuxmgr- 前缀；systemctl <action>
- DELETE `/servers/:id/projects/:name`（confirm）：stop+disable；php → cp vhost 到 data/backup/（本地）+ rm + reload；node 类 → rm unit；daemon-reload；projects.json 移除；审计
- GET `/servers/:id/projects/:name/logs`：`journalctl -u linuxmgr-<name> -n 200 --no-pager`（php 项目追加 nginx error log tail：/var/log/nginx/linuxmgr-<name>.error.log 若存在）
- 全部写操作 audit

- [ ] **步骤 4：运行测试验证通过（全量）**
- [ ] **步骤 5：Commit** `feat: 项目后端（PHP/Node/Python/Java 项目创建与 systemd/Nginx 管理）`

---

### 任务 C2：项目前端

**文件：**
- 创建：`apps/web/src/api/projects.ts`
- 创建：`apps/web/src/views/projects/index.vue`
- 修改：`apps/web/src/router/index.ts`、`apps/web/src/layout/index.vue`

- [ ] **步骤 1：API**：listProjects/createProject/controlProject/deleteProject/getProjectLogs
- [ ] **步骤 2：页面**：项目表格（名称/类型标签/端口/状态 tag/操作：启动停止重启、日志、删除）+ 创建对话框（类型选择 el-radio-group：PHP/Node/Python/Java；PHP 显示 phpVersion el-select（php74-83，来自 store 已装版本可后接）；Node/Python/Java 显示 entry 输入框）+ 日志 el-drawer（pre 输出 + 刷新）
- [ ] **步骤 3：菜单/路由**：/projects（图标 Box，标题 项目）
- [ ] **步骤 4：验证**：vue-tsc 0 错误
- [ ] **步骤 5：Commit** `feat: 项目前端页面与菜单`

---

### 任务 C3：批次 C 验证

- [ ] 重启后端；真实服务器只读验证：GET /projects（空列表）；不创建真实项目（写操作留给用户，避免动服务器）
- [ ] 前端浏览器验证页面渲染
- [ ] Commit `chore: 完成批次 C 端到端验证`

---

## 自检记录
- [ ] 规格覆盖：四类项目/启停/日志全部覆盖；8.1 前缀隔离与 reload 约束落实
