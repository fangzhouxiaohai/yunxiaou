# 菜单改名 + 网站管理站点设置 + 文件管理多标签页 设计

日期：2026-08-17
状态：已获用户批准
范围：A. 菜单改名（4 处）；B. 网站管理低成本站点设置组（12 项）；C. 文件管理多标签页

## A. 菜单改名

修改 `apps/web/src/layout/SideMenu.vue`、`apps/web/src/router/index.ts`（meta.title）、相关页面内标题：

- 监控大盘 → 数据监控
- 项目 → 网站管理（含页面标题、创建对话框等相关文案）
- 终端 → 命令终端
- 日志 → 日志管理

路由路径不变（/dashboard /projects /terminal /logs 保持不变，仅改显示名）。

## B. 网站管理：站点设置（低成本组）

### 核心架构：声明式 vhost 再生成

- 新增 `server/src/utils/vhost.js`：纯函数 `buildVhost(project)`，从项目记录生成完整 nginx server 块
- 任何设置变更流程：校验入参 → 保存项目记录 → 重新生成 vhost 写入 `/etc/nginx/conf.d/linuxmgr-<name>.conf` → `nginx -t` → 失败则还原旧配置并报错 → `nginx -s reload` → 审计日志
- SSL 模块的 `linkVhost`（server/src/routes/ssl.js:53-70）从字符串拼接改为：设置项目记录 `sslDomain` 字段并触发再生成；自动续期脚本逻辑不动
- 兼容：旧项目记录无新字段，读取设置时合并默认值；旧 vhost 中已被 ssl 模块追加的 443 段，在首次保存设置时由 `sslDomain` 重建

### 项目记录扩展字段

- `domains: string[]` — 域名列表（server_name 支持多个；旧 `domain` 字段迁移为 `domains[0]`）；空则回退 `linuxmgr-<name>.local`
- `runDir: string` — 运行目录（如 `/public`，仅 PHP）
- `index: string` — 默认文档顺序，默认 `index.php index.html`
- `rewrite: { preset, custom }` — 伪静态；preset ∈ `none | thinkphp | laravel | wordpress | typecho | emlog | discuz`，custom 为自定义规则文本（禁止 `}`）
- `antiLeech: { enabled, allowEmpty, referers[] }` — 防盗链（valid_referers）
- `redirects: [{ from, to, type }]` — 重定向；from 必须以 `/` 开头，type ∈ 301/302
- `proxy: { enabled, target }` — 反向代理（仅 node/python/java）；开启后 vhost 为 proxy_pass http://127.0.0.1:<port> 或自定义 target；关闭时非 PHP 项目无 vhost（保持现状）
- `access: { allow[], deny[] }` — IP 白/黑名单，支持 CIDR
- `basicAuth: { enabled, username, passwordEnc }` — 密码访问；密码 MASTER_KEY 加密存储，htpasswd 文件用 `openssl passwd -apr1` 生成到 `/etc/nginx/linuxmgr-htpasswd-<name>`
- `sslDomain: string|undefined` — 关联证书域名，再生成时自动带 443 ssl 段
- `phpVersion` — 已有字段改为可修改（仅 PHP；可选值来自服务器 `ls /var/run/php*-php-fpm.sock` 检测）
- `customSnippet: string` — 自定义配置片段，追加进 server 块（禁止 `}`）

vhost 模板固定声明项目专属日志：`access_log /var/log/nginx/linuxmgr-<name>.access.log; error_log /var/log/nginx/linuxmgr-<name>.error.log;`

### 接口

- `GET /servers/:id/projects/:name/settings` — 设置（默认值合并）+ 可用 PHP 版本列表 + 证书状态
- `PUT /servers/:id/projects/:name/settings` — 校验 → 保存 → 再生成 → 失败回滚 → 审计
- `GET /servers/:id/projects/:name/vhost` — 生成的完整配置文本（只读预览）
- `GET /servers/:id/projects/:name/sitelogs?type=access|error&lines=N` — 项目日志 tail
- `POST /servers/:id/projects` — PHP 类型新增可选入参 `rewritePreset`

### 前端

- 网站管理页（原项目页）：每行操作列加「设置」按钮，打开 el-drawer（桌面 70% / 手机 100%）：左侧竖排设置菜单 + 右侧表单区
- 设置菜单项：域名管理 / 网站目录（运行目录） / 伪静态 / 默认文档 / 访问限制（IP 黑白名单 + 密码访问） / 防盗链 / 重定向 / 反向代理 / PHP版本 / SSL / 配置文件 / 网站日志
- 按项目类型隐藏不适用项：伪静态、运行目录、PHP版本仅 PHP；反向代理仅非 PHP
- 创建项目对话框：PHP 类型增加「伪静态」预设下拉

### 安全约束

- 全部入参严格正则校验（域名、IP/CIDR、URL、路径）
- rewrite.custom 与 customSnippet 禁止 `}` 字符，防止逃逸出 server 块
- 写操作全部审计；nginx -t 失败自动回滚
- 只动 `linuxmgr-` 前缀文件，不修改服务器任何已有配置

## C. 文件管理多标签页

修改 `apps/web/src/views/files/index.vue`：

- 工具栏上方加标签栏：标签 = 文件夹图标 + 目录名（路径最后一段，根目录显示「根目录」）+ 关闭 ×，末尾「+」新增标签
- 每个标签独立记住自己的当前路径；切换标签即切换到该目录并刷新列表；标签内导航（点文件夹、面包屑、路径输入）更新该标签的路径与标签名
- 「+」新开标签默认定位到 `/`
- 至少保留一个标签（最后一个不可关闭）；关闭当前标签后切到左侧相邻标签
- 标签列表按服务器持久化到 localStorage（key：`linuxmgr_files_tabs_<服务器id>`），切换菜单或刷新后保留
- 切换标签时重置文件选中状态，避免跨目录误操作

## 验证

- 后端：`cd server && npm test` 全过（vhost 生成纯函数、settings 接口校验/回滚均有测试）
- 前端：`cd apps/web && npm run build` 通过
- 真实服务器验证（如可用）：创建 PHP 项目带伪静态、改设置、查看配置与日志

## 非目标（YAGNI）

- 中成本组（流量限制、防跨站 open_basedir、子目录绑定）与高成本组（防篡改、网站告警、网站配额、FTP/WebDav/文件同步）本期不做
- 非 PHP 项目未开启反向代理时不生成 vhost（保持现状）
- SSL 证书上传/自签/续期逻辑不变，仅改 vhost 关联方式
