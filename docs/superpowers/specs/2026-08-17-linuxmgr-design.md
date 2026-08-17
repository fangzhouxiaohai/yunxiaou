# 云小U 服务器管理工具设计文档

- 日期：2026-08-17
- 状态：已批准（用户确认）
- 产品名：云小U（用户命名）
- 目录：`D:\yewu\linuxmgr`

## 1. 目标

在 `D:\yewu\linuxmgr` 目录下从零构建一个服务器管理 Web 工具（产品名：**云小U**），通过 SSH 管理真实的远程 Linux 服务器。

## 2. 关键决策（用户已确认）

| 决策点 | 选择 |
|---|---|
| 管理对象 | 远程 Linux 服务器（通过 SSH 连接） |
| 功能模块 | 监控大盘、多服务器管理、网站管理、进程与服务、文件管理、安全防护、数据库管理、软件商店 |
| 技术栈 | Express 后端 + Vue 3 前端（Vite + TypeScript + Element Plus + Pinia），JWT 认证 |
| 前端风格 | 参照 [youlai/vue3-element-admin](https://gitcode.com/youlai/vue3-element-admin)：经典后台布局（左侧菜单 + 顶栏 + 多标签页） |
| 测试环境 | 真实 Linux 服务器 `43.240.221.112`（SSH 端口 22，用户 root）；凭据存放于 `.env`，不提交 git |
| 凭据存储 | 本地 JSON + AES-256-GCM 加密，主密钥来自环境变量 `MASTER_KEY` |
| 架构 | 方案 B：长连接池（常驻 SSH 连接 + 自动重连） |

## 3. 总体架构

- **单体应用**：Express 后端运行在用户本机（Windows），Vue 3 SPA 前端（Vite + TypeScript + Element Plus 构建），JWT 认证。
- **SSH 长连接池**：后端用 `ssh2` 为每台服务器维护常驻连接：
  - 心跳保活（每 60 秒发送 keepalive）
  - 断线自动重连（最多重试 2 次）
  - 空闲 10 分钟回收
  - 每服务器并发命令队列（默认最多 4 条并行执行）
- **数据存储**：本地 `data/` 目录下 JSON 文件：
  - `servers.json`：服务器列表（密码 AES-256-GCM 加密存储）
  - `sites.json`：站点配置
  - 主密钥来自环境变量 `MASTER_KEY`（未设置时开发模式使用默认值并输出警告）

## 4. 功能模块与构建顺序

### P1（第一里程碑）
1. **认证**：JWT 登录。单管理员账号，用户名/密码来自 `.env`（`ADMIN_USER` / `ADMIN_PASSWORD`）。所有 API（除登录外）需携带 JWT，过期时间 24 小时。
2. **多服务器管理**：服务器 CRUD（名称、主机、SSH 端口、用户名、加密密码）、连接测试、列表展示。
3. **SSH 连接池**：`ConnectionPool` 核心模块（见第 5 节）。
4. **监控大盘**：CPU 使用率、内存、磁盘、网络流量、系统负载、运行时长、系统信息（发行版/内核）。前端轮询（默认 3 秒），ECharts 实时图表。

### P2（第二里程碑）
5. **网站管理**：Nginx 站点列表、创建站点（自动生成 vhost 配置 + 站点目录）、启停（禁用/启用 vhost）、删除、伪静态规则、SSL 证书（自签或用户上传）。
   - 前置条件：目标服务器已安装 Nginx（站点列表/创建前自动检测 `nginx -v`，未安装时返回提示并给出安装指引，不自动安装）。
6. **进程与服务**：进程列表（ps）、systemd 服务状态查看、服务启停（systemctl start/stop/restart）。

### P3（第三里程碑）
7. **文件管理**：路径浏览、上传、下载、在线编辑、重命名、删除、chmod 权限修改。安全限制：禁止操作危险路径（`/etc/shadow`、`/etc/passwd` 等只读保护，主流面板同款防护思路）。
8. **安全防护**：防火墙端口管理（自动识别 firewalld / ufw）、SSH 登录日志查看（`/var/log/auth.log` 或 `/var/log/secure`）、IP 封禁/解封（firewalld rich rule 或 iptables）。

### P1 补充（用户新增需求，随 P1 交付）
9. **数据库管理**：
   - MySQL/MariaDB：数据库列表（`SHOW DATABASES`）、创建数据库、删除数据库、创建用户并授权（`CREATE USER` + `GRANT`）、导入（上传 .sql 执行）、导出（`mysqldump` 下载）。
   - Redis：状态信息（`redis-cli INFO`：内存、连接数、命中率）、键列表（`SCAN`，分页）、键数量（`DBSIZE`）、清空当前库（`FLUSHDB`，需二次确认）。
   - 通过 SSH 执行 mysql/redis CLI 实现，不引入数据库直连依赖。
   - MySQL root 密码与 Redis 密码在服务器记录中可选配置（AES-256-GCM 加密存储，独立字段 `mysqlPasswordEnc` / `redisPasswordEnc`）；未配置时 MySQL 尝试 `sudo mysql`（auth_socket），Redis 尝试无密码连接。
10. **软件商店**：收录 Nginx、MySQL/MariaDB、Redis、Docker、Node.js、Python、Git、Fail2ban 共 8 个软件：
    - 安装状态检测（`command -v` + 版本命令，如 `nginx -v`、`node -v`）
    - 一键安装（自动识别 apt / yum 包管理器），安装过程流式输出日志
    - 版本查看、卸载（可选，二次确认）

## 5. 后端结构

```
server/
  src/
    index.js                 # Express 入口，挂载路由、静态资源、全局错误处理
    config.js                # 环境变量读取（端口、JWT 密钥、MASTER_KEY、管理员凭据）
    auth/
      jwt.js                 # 签发 / 校验 JWT
      middleware.js          # requireAuth 中间件
    ssh/
      connectionPool.js      # 长连接池：连接、保活、重连、回收、并发队列
      exec.js                # 命令执行封装（超时 15s、输出大小截断、退出码检查）
    crypto/
      cipher.js              # AES-256-GCM 加密 / 解密
    store/
      jsonStore.js           # JSON 文件读写（原子写入：临时文件 + rename）
    routes/
      auth.js                # POST /api/auth/login
      servers.js             # GET/POST/PUT/DELETE /api/servers、POST /api/servers/:id/test
      monitor.js             # GET /api/servers/:id/monitor
      sites.js               # GET/POST/PUT/DELETE /api/servers/:id/sites
      processes.js           # GET /api/servers/:id/processes、POST /api/servers/:id/services/:name/:action
      files.js               # GET/POST/PUT/DELETE /api/servers/:id/files
      security.js            # GET/POST/DELETE /api/servers/:id/firewall、GET /api/servers/:id/logins
      database.js            # GET/POST/DELETE /api/servers/:id/databases、导入导出；/api/servers/:id/redis 状态/键/清空
      store.js               # GET /api/servers/:id/store（状态检测）、POST /api/servers/:id/store/:name/install
    utils/
      sshParser.js           # 解析 top/df/free 等命令输出为结构化数据
      dbParser.js            # 解析 SHOW DATABASES / redis INFO 输出为结构化数据
```

## 6. 前端结构

参照 [youlai/vue3-element-admin](https://gitcode.com/youlai/vue3-element-admin) 的项目结构与风格：

```
apps/web/
  src/
    api/                     # 请求封装（axios + JWT 拦截器 + 统一错误处理）
    assets/                  # 样式（Sass 变量、全局样式）
    layout/                  # 整体布局：侧边菜单 + 顶栏（面包屑/用户区）+ 多标签页
    router/                  # Vue Router：静态路由 + 登录守卫
    stores/                  # Pinia：user（登录态）、app（标签页/主题）、server（当前选中服务器）
    views/
      login/index.vue        # 登录页
      dashboard/index.vue    # 监控大盘（ECharts 图表）
      servers/index.vue      # 服务器列表
      sites/index.vue        # 网站管理
      processes/index.vue    # 进程与服务
      files/index.vue        # 文件管理
      security/index.vue     # 安全防护
      databases/index.vue    # 数据库管理（MySQL + Redis）
      store/index.vue        # 软件商店
    utils/                   # 工具函数
    App.vue / main.ts
```

- 技术栈：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router + ECharts。
- 布局：左侧折叠菜单、顶部面包屑 + 用户下拉、多标签页缓存（经典中后台风格），支持暗色主题。
- 所有 API 调用统一走 `api/request.ts`：自动附加 `Authorization: Bearer <token>`，401 时跳转登录页，错误统一 `ElMessage` 提示。
- 顶部服务器切换器（全局 Pinia 状态），切换后各管理页面针对该服务器操作。

## 7. API 约定

- 统一响应格式：`{ code: 0, data: {...} }` 成功；`{ code: 非0, message: '中文错误信息' }` 失败。
- HTTP 状态码：200 成功；401 未认证；403 无权限；404 不存在；500 服务器错误。
- SSH 命令超时默认 15 秒；连接失败、认证失败、命令超时均返回明确中文错误信息。

## 8. 安全设计

- JWT 密钥来自环境变量 `JWT_SECRET`（开发模式有默认值并警告）。
- SSH 密码加密存储：AES-256-GCM，随机 IV，密文 + IV + authTag 存为 Base64。
- 所有命令通过参数化拼接执行，禁止直接拼接用户输入的 shell 命令；站点名/文件名等做白名单校验（`^[a-zA-Z0-9._-]+$`）。
- 文件管理危险路径保护：`/etc/shadow`、`/etc/passwd`、`/etc/sudoers`、`/root/.ssh/` 默认禁止修改，可在配置中调整。
- 登录失败限速：同一 IP 连续失败 5 次锁定 15 分钟。

### 8.1 不破坏服务器现有项目（硬性约束）

目标服务器上运行着其他项目，**所有操作必须以不影响现有项目为前提**，具体规则：

1. **网站管理（Nginx）**：
   - 只允许在独立目录新增本工具自己的配置文件（如 `/etc/nginx/conf.d/linuxmgr-*.conf`，统一前缀 `linuxmgr-`），**绝不修改/删除任何已有配置文件**；
   - 变更后使用 `nginx -s reload`（热加载），**禁止 restart**；
   - 删除站点只清理本工具创建的文件（先备份到 `data/backup/` 再删），不触碰其他站点；
   - 站点根目录只创建新目录，不向已有目录写入。
2. **防火墙**：只增删**本工具自己添加**的规则（规则带 `linuxmgr` 注释标记），**禁止清空/重置防火墙**（如 `iptables -F`、`firewalld --complete-reload` 之外的整体重置）。
3. **文件管理**：危险路径保护（见上文）+ **删除操作默认移入回收站**（服务器 `/tmp/linuxmgr-trash/`，按服务器+时间戳分目录），不直接删除；覆盖/写入已有文件前先备份原文件。
4. **进程与服务**：服务启停需前端二次确认；禁止操作保护列表内的系统进程/服务（`sshd`、`nginx` 主进程、`systemd` 核心、PID 1 等），保护列表可配置。
5. **命令执行层黑名单**：`exec.js` 统一拦截危险命令关键字（`rm -rf /`、`mkfs`、`dd`、`shutdown`、`reboot`、`halt`、`:(){` 等），命中即拒绝执行并返回错误。
6. **审计日志**：所有写操作（增/删/改/启停）记录到 `data/audit.log`：时间、操作人、目标服务器、操作类型、命令摘要、结果。
7. **冒烟测试约束**：真实服务器验证时优先只读操作；测试站点使用 `linuxmgr-test.local` 域名，验证完毕后完整清理（删除站点、移除防火墙规则、清空回收站），确保服务器恢复原状。
8. **数据库**：删除数据库前自动 `mysqldump` 备份到服务器 `/tmp/linuxmgr-db-backup/`；删除数据库、清空 Redis（`FLUSHDB`）需前端二次确认；只通过 mysql/redis CLI 操作，不修改 MySQL/Redis 全局配置文件。
9. **软件商店**：仅通过系统包管理器（apt/yum）安装；安装/卸载前前端二次确认；禁止执行来源不明的脚本（`curl | bash`、`wget | sh` 等被 exec 黑名单拦截）。

## 9. 测试策略

1. 单元测试（Node 内置 test runner）：JWT 签发/校验、AES 加解密、配置解析、sshParser / dbParser 输出解析。
2. 集成测试：mock SSH 客户端（`ssh2` 接口替身）跑通监控、数据库、软件商店等模块逻辑。
3. 冒烟验证：真实服务器 `43.240.221.112`（root，凭据在 `.env`），端到端验证登录 → 添加服务器 → 监控大盘 → 数据库列表（只读）→ 软件状态检测（只读）→ 网站管理全流程；遵守 8.1 第 7 条约束，验证后完整清理测试痕迹。

## 10. 运行方式

```bash
# 后端（server/ 目录）
npm install
MASTER_KEY=xxx JWT_SECRET=xxx ADMIN_USER=admin ADMIN_PASSWORD=xxx npm start

# 前端（apps/web 目录）
npm install
npm run dev   # Vite dev server（端口 5173），代理 /api 到后端（3000）
```

- `.env`（gitignore）：`MASTER_KEY`、`JWT_SECRET`、`ADMIN_USER`、`ADMIN_PASSWORD`、测试服务器凭据 `TEST_SERVER_HOST/PORT/USER/PASSWORD`。
- 生产形态：后端 `express.static` 托管前端构建产物，单端口运行。

## 11. 范围外（第一版不做）

- 多用户/角色权限系统（单管理员）
- Docker 容器管理（软件商店提供 Docker 安装，容器编排不在范围）
- FTP 管理
- 面板自身的自动更新
- PostgreSQL 数据库管理

## 12. P2 扩展批次（用户新增需求，2026-08-17 确认）

交付顺序按依赖：**A（商店扩充）→ B（数据库面板）→ C（项目菜单）→ D（工具菜单）**，每批独立验证。用户已确认：交互式 Web 终端、MySQL 多版本共存+切换。

### 批次 A：软件商店扩充与版本管理

1. **PHP 多版本**（支持并存多版本）：
   - 版本清单：7.4 / 8.0 / 8.1 / 8.2 / 8.3（CentOS 7 走 remi 源：`yum install php74-php-fpm` 等；Debian/Ubuntu 走 sury 源：`apt install php8.2-fpm`）
   - 检测：`phpXX -v`（remi 风格命令 php74/php80/php81/php82）与 `php -v`（默认 CLI）
   - 安装/卸载独立进行；安装后自动启用对应 php-fpm 服务
2. **Composer**：检测 `composer --version`；安装 = 官方安装脚本（`php -r` + curl 下载——注意：curl|bash 被黑名单拦截，改为下载到 /usr/local/bin/composer 两步执行）；需 PHP 已安装
3. **Java 环境管理器**：检测 `java -version`；可选安装 OpenJDK 8/11/17（yum/apt 包名映射）；默认版本切换用 `alternatives --set java`（CentOS）或 `update-alternatives`（Debian）
4. **进程守护管理器（Supervisor）**：检测 `supervisord -v`；安装 supervisor；`supervisorctl status` 进程列表；配置管理：创建/删除 program 配置（`/etc/supervisord.d/*.ini`，统一 `linuxmgr-` 前缀，reload 生效）
5. **磁盘管理挂载工具**：`lsblk` 块设备/分区列表、`df -h` 挂载点列表、挂载已有文件系统（`mount /dev/x /mnt/linuxmgr-*`，目标目录统一 `linuxmgr-` 前缀）、卸载（`umount`，二次确认）。**不提供格式化**（mkfs 在黑名单中，保持拦截）
6. **MySQL 多版本共存+切换**：
   - 可安装版本：MySQL 5.7 / 8.0 / MariaDB 10.x；多版本并存用**端口隔离**（默认 3306，额外版本自动分配 3307/3308）与独立数据目录
   - 检测：已装实例列表（二进制 + systemd 服务名 + 端口 + 数据目录）
   - 切换默认：停止非默认实例 + 启动目标实例（前端二次确认 + 审计）；`3306` 端口始终由默认版本占用

### 批次 B：数据库管理面板（模仿 phpMyAdmin 5.2）

- 库列表 → 点击进入库 → 表列表（`SHOW TABLES`）→ 表结构（`DESCRIBE`/`SHOW CREATE TABLE`）→ 数据浏览（`SELECT * LIMIT 100` + 分页）→ 执行 SQL（textarea + 结果表格）
- 保留现有创建/删除库功能；全部走 mysql CLI（sudo 或 root 凭据）
- 危险操作（DROP TABLE、DELETE/UPDATE 无 WHERE 等）二次确认；SQL 执行结果统一表格渲染

### 批次 C：项目菜单（替代网站管理）

- 菜单改名"项目"，支持 **PHP / Java / Python / Node** 四类项目
- 创建项目：项目名（`linuxmgr-` 前缀目录）、源码目录、运行端口、启动命令/入口文件、PHP 版本选择（关联批次 A 多版本）
- 运行时管理：PHP 项目 → php-fpm + Nginx vhost（沿用 P2 网站模块思路）；Node/Python/Java → 生成 systemd service（`/etc/systemd/system/linuxmgr-<name>.service`，前缀隔离，`systemctl daemon-reload`）+ 启停/重启/状态
- 项目列表：状态（运行/停止）、端口、类型、启停按钮、日志入口（关联批次 D 日志）

### 批次 D：工具菜单

1. **日志**：选择日志文件（/var/log/nginx/error.log 等常用列表 + 自定义路径）、tail 实时查看（轮询或 SSE）、搜索过滤
2. **计划任务**：crontab 列表/新增/删除（`crontab -l`/`-e` 文件方式：`/var/spool/cron/root` 追加，统一 `linuxmgr-` 注释标记）、执行记录
3. **文件管理**：沿用 P1 设计（原 P3 模块提前）；危险路径保护 + 回收站
4. **SSL 证书**：证书列表（Nginx vhost 关联）、上传证书（crt/key 文本）、自签生成（openssl）、Let's Encrypt 留待后续
5. **Web 终端**：交互式——后端 `ws` + `ssh2 shell` 双向流；前端 xterm.js 终端组件；认证复用 JWT（WebSocket 握手带 token）；命令执行安全提示（终端是用户主动操作，黑名单不拦截但记录审计）

### 批次 A-D 通用约束

- 所有写操作沿用 8.1 约束：`linuxmgr-` 前缀隔离、二次确认、审计日志
- 新增/修改的文件配置一律不触碰已有配置
