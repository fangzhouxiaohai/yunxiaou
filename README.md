# 云小U — 服务器管理工具

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
