# 服务器管理工具（宝塔风格）设计文档

- 日期：2026-08-17
- 状态：已批准（用户确认）
- 目录：`D:\yewu\linuxmgr`

## 1. 目标

在 `D:\yewu\linuxmgr` 目录下从零构建一个宝塔（BaoTa）风格的服务器管理 Web 工具，通过 SSH 管理真实的远程 Linux 服务器。

## 2. 关键决策（用户已确认）

| 决策点 | 选择 |
|---|---|
| 管理对象 | 远程 Linux 服务器（通过 SSH 连接） |
| 功能模块 | 监控大盘、多服务器管理、网站管理、进程与服务、文件管理、安全防护 |
| 技术栈 | Express 后端 + Vue 3 前端（Vite + TypeScript + Element Plus + Pinia），JWT 认证 |
| 前端风格 | 参照 [youlai/vue3-element-admin](https://gitcode.com/youlai/vue3-element-admin)：经典后台布局（左侧菜单 + 顶栏 + 多标签页），不照搬宝塔原版界面 |
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
7. **文件管理**：路径浏览、上传、下载、在线编辑、重命名、删除、chmod 权限修改。安全限制：禁止操作危险路径（`/etc/shadow`、`/etc/passwd` 等只读保护，宝塔同款防护思路）。
8. **安全防护**：防火墙端口管理（自动识别 firewalld / ufw）、SSH 登录日志查看（`/var/log/auth.log` 或 `/var/log/secure`）、IP 封禁/解封（firewalld rich rule 或 iptables）。

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
    utils/
      sshParser.js           # 解析 top/df/free 等命令输出为结构化数据
```

## 6. 前端结构

参照 [youlai/vue3-element-admin](https://gitcode.com/youlai/vue3-element-admin) 的项目结构与风格（不照搬宝塔原版界面）：

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

## 9. 测试策略

1. 单元测试（Node 内置 test runner）：JWT 签发/校验、AES 加解密、配置解析、sshParser 输出解析。
2. 集成测试：mock SSH 客户端（`ssh2` 接口替身）跑通监控、站点、文件等模块逻辑。
3. 冒烟验证：真实服务器 `43.240.221.112`（root，凭据在 `.env`），端到端验证登录 → 添加服务器 → 监控大盘 → 网站管理全流程。

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
- 数据库管理（MySQL/Redis 管理）
- 软件商店、Docker 管理
- FTP 管理
- 面板自身的自动更新
