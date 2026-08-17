# 菜单改名 + 网站管理站点设置 + 文件管理多标签页 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 菜单改名 4 处；网站管理（原项目）新增 12 项站点设置（声明式 vhost 再生成）；文件管理支持多标签页。

**架构：** 后端新增纯函数 `buildVhost(project)` 生成 nginx 配置，所有设置变更走「校验 → 存记录 → 再生成 → nginx -t 失败回滚 → reload → 审计」；SSL 关联改为写 `sslDomain` 字段再生成。前端网站管理页加设置抽屉，文件管理页加标签栏（localStorage 按服务器持久化）。

**技术栈：** Node.js + Express + node:test + supertest；Vue 3 + TS + Element Plus。

**规格文档：** `docs/superpowers/specs/2026-08-17-site-settings-design.md`

---

## 文件结构

**后端：**
- 创建 `server/src/utils/vhost.js` — `buildVhost(project)` 纯函数 + `REWRITE_PRESETS` + `applyVhost({pool, config}, cfg, project)`（写入 + 校验 + 回滚 + htpasswd）
- 修改 `server/src/routes/projects.js` — 创建/删除改用 buildVhost；新增 settings/vhost/sitelogs 接口
- 修改 `server/src/routes/ssl.js` — `linkVhost` 改为写 sslDomain + applyVhost
- 创建 `server/test/vhost.test.js` — 纯函数测试
- 修改 `server/test/projects.test.js` — settings 接口测试

**前端：**
- 修改 `apps/web/src/layout/SideMenu.vue`、`apps/web/src/router/index.ts` — 菜单改名
- 修改 `apps/web/src/api/projects.ts` — settings 相关类型与接口函数
- 修改 `apps/web/src/views/projects/index.vue` — 页面改名、创建对话框加伪静态、操作列加「设置」
- 创建 `apps/web/src/views/projects/SettingsDrawer.vue` — 站点设置抽屉
- 修改 `apps/web/src/views/files/index.vue` — 多标签页
- 修改 `README.md` — 文案同步

---

## 任务 1：菜单改名

**文件：**
- 修改：`apps/web/src/layout/SideMenu.vue`、`apps/web/src/router/index.ts`、`apps/web/src/views/projects/index.vue`、`apps/web/src/views/terminal/index.vue`

- [ ] **步骤 1：SideMenu.vue 四处菜单文案**
  - `监控大盘` → `数据监控`（index /dashboard）
  - `项目` → `网站管理`（index /projects）
  - `终端` → `命令终端`（index /terminal）
  - `日志` → `日志管理`（index /logs）
- [ ] **步骤 2：router/index.ts 对应四条路由的 meta.title 同步改为新名字**
- [ ] **步骤 3：projects/index.vue**：`.page-title` 的 `项目` → `网站管理`；「创建项目」按钮 → `创建网站`；dialog title `创建项目` → `创建网站`；「项目日志」drawer title → `网站日志`；onDelete 确认文案中「删除项目」→「删除网站」。terminal/index.vue：`.term-title` 前缀 `终端` → `命令终端`
- [ ] **步骤 4：构建验证 + Commit**

运行：`cd apps/web && npm run build`，预期成功

```bash
git add apps/web/src/layout apps/web/src/router apps/web/src/views
git commit -m "feat(web): 菜单改名——数据监控/网站管理/命令终端/日志管理"
```

---

## 任务 2：vhost 生成纯函数（TDD）

**文件：**
- 创建：`server/src/utils/vhost.js`
- 测试：`server/test/vhost.test.js`

- [ ] **步骤 1：编写测试文件 server/test/vhost.test.js**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVhost, REWRITE_PRESETS } = require('../src/utils/vhost');

const base = { name: 'linuxmgr-blog', type: 'php', directory: '/www/blog', port: 8080, phpVersion: 'php82' };

test('PHP 项目基本 vhost：listen/server_name/root/index/php-fpm/专属日志', () => {
  const v = buildVhost(base);
  assert.ok(v.includes('listen 8080;'));
  assert.ok(v.includes('server_name linuxmgr-blog.local;'));
  assert.ok(v.includes('root /www/blog;'));
  assert.ok(v.includes('index index.php index.html;'));
  assert.ok(v.includes('fastcgi_pass unix:/var/run/php82-php-fpm.sock;'));
  assert.ok(v.includes('access_log /var/log/nginx/linuxmgr-blog.access.log;'));
  assert.ok(v.includes('error_log /var/log/nginx/linuxmgr-blog.error.log;'));
  assert.ok(v.startsWith('server {') && v.trimEnd().endsWith('}'));
});

test('多域名与旧 domain 字段兼容', () => {
  const v1 = buildVhost({ ...base, domains: ['a.com', 'www.a.com'] });
  assert.ok(v1.includes('server_name a.com www.a.com;'));
  const v2 = buildVhost({ ...base, domain: 'old.com' });
  assert.ok(v2.includes('server_name old.com;'));
});

test('运行目录与默认文档', () => {
  const v = buildVhost({ ...base, runDir: '/public', index: 'index.html index.htm' });
  assert.ok(v.includes('root /www/blog/public;'));
  assert.ok(v.includes('index index.html index.htm;'));
});

test('伪静态预设与自定义', () => {
  const tp = buildVhost({ ...base, rewrite: { preset: 'thinkphp' } });
  assert.ok(tp.includes(REWRITE_PRESETS.thinkphp));
  const custom = buildVhost({ ...base, rewrite: { preset: 'custom', custom: 'rewrite ^/old/(.*)$ /new/$1 last;' } });
  assert.ok(custom.includes('rewrite ^/old/(.*)$ /new/$1 last;'));
  const none = buildVhost({ ...base, rewrite: { preset: 'none' } });
  assert.ok(none.includes('try_files $uri $uri/ =404;'));
});

test('防盗链', () => {
  const v = buildVhost({ ...base, antiLeech: { enabled: true, allowEmpty: true, referers: ['a.com', '*.b.com'] } });
  assert.ok(v.includes('valid_referers none server_names a.com *.b.com;'));
  assert.ok(v.includes('if ($invalid_referer) { return 403; }'));
  const off = buildVhost({ ...base, antiLeech: { enabled: false, referers: [] } });
  assert.ok(!off.includes('valid_referers'));
});

test('重定向', () => {
  const v = buildVhost({ ...base, redirects: [{ from: '/old', to: 'https://a.com/new', type: 301 }] });
  assert.ok(v.includes('location = /old { return 301 https://a.com/new; }'));
});

test('IP 访问限制与密码访问', () => {
  const v = buildVhost({ ...base, access: { allow: ['1.2.3.4', '10.0.0.0/8'], deny: [] }, basicAuth: { enabled: true, username: 'u' } });
  assert.ok(v.includes('allow 1.2.3.4;'));
  assert.ok(v.includes('allow 10.0.0.0/8;'));
  assert.ok(v.includes('deny all;'));
  assert.ok(v.includes('auth_basic "Restricted";'));
  assert.ok(v.includes('auth_basic_user_file /etc/nginx/linuxmgr-htpasswd-linuxmgr-blog;'));
  const denyOnly = buildVhost({ ...base, access: { allow: [], deny: ['5.6.7.8'] } });
  assert.ok(denyOnly.includes('deny 5.6.7.8;'));
  assert.ok(!denyOnly.includes('deny all;'));
});

test('非 PHP 项目开启反向代理', () => {
  const node = { name: 'linuxmgr-app', type: 'node', directory: '/www/app', port: 3001, proxy: { enabled: true, target: '' } };
  const v = buildVhost(node);
  assert.ok(v.includes('proxy_pass http://127.0.0.1:3001;'));
  assert.ok(v.includes('proxy_set_header Host $host;'));
  assert.ok(!v.includes('fastcgi_pass'));
  const custom = buildVhost({ ...node, proxy: { enabled: true, target: 'http://127.0.0.1:9000' } });
  assert.ok(custom.includes('proxy_pass http://127.0.0.1:9000;'));
});

test('SSL 关联与自定义片段', () => {
  const v = buildVhost({ ...base, sslDomain: 'a.com', customSnippet: 'client_max_body_size 50m;' });
  assert.ok(v.includes('# linuxmgr-ssl-a.com'));
  assert.ok(v.includes('listen 443 ssl;'));
  assert.ok(v.includes('ssl_certificate /etc/nginx/ssl/linuxmgr-a.com.crt;'));
  assert.ok(v.includes('client_max_body_size 50m;'));
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd server && npx node --test test/vhost.test.js`
预期：FAIL，报错 `Cannot find module '../src/utils/vhost'`

- [ ] **步骤 3：创建 server/src/utils/vhost.js**

```js
// nginx vhost 生成（纯函数，可单测）+ 应用（写入/校验/回滚）
// 约定：只生成/操作 linuxmgr- 前缀的配置文件

const PHP_SOCK = {
  php74: '/var/run/php74-php-fpm.sock',
  php80: '/var/run/php80-php-fpm.sock',
  php81: '/var/run/php81-php-fpm.sock',
  php82: '/var/run/php82-php-fpm.sock',
  php83: '/var/run/php83-php-fpm.sock',
};

const REWRITE_PRESETS = {
  thinkphp: 'if (!-e $request_filename) {\n        rewrite ^(.*)$ /index.php?s=$1 last;\n    }',
  laravel: 'try_files $uri $uri/ /index.php?$query_string;',
  wordpress: 'try_files $uri $uri/ /index.php?$args;',
  typecho: 'if (!-e $request_filename) {\n        rewrite ^(.*)$ /index.php$1 last;\n    }',
  emlog: 'if (!-e $request_filename) {\n        rewrite ^(.*)$ /index.php last;\n    }',
  discuz: 'rewrite ^([^\\.]*)/forum-(\\w+)-([0-9]+)\\.html$ $1/forum.php?mod=forumdisplay&fid=$2&page=$3 last;\n    if (!-e $request_filename) {\n        rewrite ^(.*)$ /index.php last;\n    }',
};

function indent(text, pad = '    ') {
  return String(text).split('\n').map((l) => (l.trim() ? pad + l.trim() : '')).join('\n');
}

// 生成完整 server 块。project 字段见规格「项目记录扩展字段」
function buildVhost(p) {
  const domains = (Array.isArray(p.domains) && p.domains.length ? p.domains : [p.domain].filter(Boolean));
  const serverName = domains.length ? domains.join(' ') : `${p.name}.local`;
  const lines = [
    'server {',
    `    listen ${p.port};`,
  ];
  if (p.sslDomain) {
    lines.push(`    # linuxmgr-ssl-${p.sslDomain}`);
    lines.push('    listen 443 ssl;');
    lines.push(`    ssl_certificate /etc/nginx/ssl/linuxmgr-${p.sslDomain}.crt;`);
    lines.push(`    ssl_certificate_key /etc/nginx/ssl/linuxmgr-${p.sslDomain}.key;`);
  }
  lines.push(`    server_name ${serverName};`);
  lines.push(`    access_log /var/log/nginx/${p.name}.access.log;`);
  lines.push(`    error_log /var/log/nginx/${p.name}.error.log;`);

  const allow = Array.isArray(p.access?.allow) ? p.access.allow : [];
  const deny = Array.isArray(p.access?.deny) ? p.access.deny : [];
  for (const ip of allow) lines.push(`    allow ${ip};`);
  for (const ip of deny) lines.push(`    deny ${ip};`);
  if (allow.length) lines.push('    deny all;');

  if (p.basicAuth?.enabled) {
    lines.push('    auth_basic "Restricted";');
    lines.push(`    auth_basic_user_file /etc/nginx/linuxmgr-htpasswd-${p.name};`);
  }

  const isPhp = p.type === 'php';
  if (!isPhp && p.proxy?.enabled) {
    const target = p.proxy.target || `http://127.0.0.1:${p.port}`;
    lines.push('    location / {');
    lines.push(`        proxy_pass ${target};`);
    lines.push('        proxy_set_header Host $host;');
    lines.push('        proxy_set_header X-Real-IP $remote_addr;');
    lines.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    lines.push('    }');
  } else if (isPhp) {
    const root = `${p.directory}${p.runDir || ''}`;
    lines.push(`    root ${root};`);
    lines.push(`    index ${p.index || 'index.php index.html'};`);
    if (p.antiLeech?.enabled) {
      const refs = ['server_names', ...(p.antiLeech.referers || [])];
      if (p.antiLeech.allowEmpty) refs.unshift('none');
      lines.push('    location ~* \\.(gif|jpg|jpeg|png|bmp|swf|flv|mp4|ico|webp)$ {');
      lines.push(`        valid_referers ${refs.join(' ')};`);
      lines.push('        if ($invalid_referer) { return 403; }');
      lines.push('    }');
    }
    lines.push('    location / {');
    const rw = p.rewrite || { preset: 'none' };
    if (rw.preset === 'custom' && rw.custom) lines.push(indent(rw.custom, '        '));
    else if (rw.preset && rw.preset !== 'none' && REWRITE_PRESETS[rw.preset]) lines.push(indent(REWRITE_PRESETS[rw.preset], '        '));
    else lines.push('        try_files $uri $uri/ =404;');
    lines.push('    }');
    lines.push('    location ~ \\.php$ {');
    lines.push(`        fastcgi_pass unix:${PHP_SOCK[p.phpVersion] || PHP_SOCK.php82};`);
    lines.push('        fastcgi_index index.php;');
    lines.push('        include fastcgi_params;');
    lines.push('        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;');
    lines.push('    }');
  }

  for (const r of Array.isArray(p.redirects) ? p.redirects : []) {
    lines.push(`    location = ${r.from} { return ${r.type} ${r.to}; }`);
  }

  if (p.customSnippet) lines.push(indent(p.customSnippet));
  lines.push('}');
  return lines.join('\n');
}

// 写入 vhost → nginx -t → 失败还原旧配置。返回 throws Error
async function applyVhost({ pool }, cfg, project) {
  const confPath = `/etc/nginx/conf.d/${project.name}.conf`;
  const vhost = buildVhost(project);
  const backup = await pool.run(cfg, `cat ${confPath} 2>/dev/null || true`);
  const w = await pool.run(cfg, `cat > ${confPath} <<'LINUXMGR_EOF'\n${vhost}\nLINUXMGR_EOF`);
  if (w.code !== 0) throw new Error(`写入 vhost 失败: ${w.stderr.slice(0, 200)}`);
  const t = await pool.run(cfg, 'nginx -t && nginx -s reload');
  if (t.code !== 0) {
    if (backup.stdout && backup.stdout.includes('server {')) {
      await pool.run(cfg, `cat > ${confPath} <<'LINUXMGR_EOF'\n${backup.stdout}\nLINUXMGR_EOF`);
    } else {
      await pool.run(cfg, `rm -f ${confPath}`);
    }
    await pool.run(cfg, 'nginx -s reload');
    throw new Error(`Nginx 配置校验失败，已还原旧配置: ${t.stderr.slice(0, 200)}`);
  }
}

// 密码访问：生成 htpasswd（密码经 base64 传递避免 shell 注入）
async function applyBasicAuth({ pool, config }, cfg, project) {
  const path = `/etc/nginx/linuxmgr-htpasswd-${project.name}`;
  if (!project.basicAuth?.enabled) {
    await pool.run(cfg, `rm -f ${path}`);
    return;
  }
  const { decrypt } = require('../crypto/cipher');
  const pass = decrypt(project.basicAuth.passwordEnc, config.masterKey);
  const b64 = Buffer.from(String(pass), 'utf8').toString('base64');
  const cmd = `echo "${project.basicAuth.username}:$(openssl passwd -apr1 "$(echo ${b64} | base64 -d)")" > ${path}`;
  const r = await pool.run(cfg, cmd);
  if (r.code !== 0) throw new Error(`生成密码访问文件失败: ${r.stderr.slice(0, 200)}`);
}

module.exports = { buildVhost, applyVhost, applyBasicAuth, REWRITE_PRESETS, PHP_SOCK };
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd server && npx node --test test/vhost.test.js`
预期：9/9 PASS

- [ ] **步骤 5：Commit**

```bash
git add server/src/utils/vhost.js server/test/vhost.test.js
git commit -m "feat(server): vhost 声明式生成纯函数与预设伪静态规则"
```

---

## 任务 3：projects.js 接入 buildVhost + 创建接口伪静态预设

**文件：**
- 修改：`server/src/routes/projects.js`
- 测试：`server/test/projects.test.js`（追加）

- [ ] **步骤 1：追加测试**

```js
test('创建 PHP 项目带伪静态预设', async () => {
  const { app, calls } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'tp5', type: 'php', directory: '/www/tp5', port: 8081, phpVersion: 'php74', rewritePreset: 'thinkphp' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('/index.php?s=$1'), 'vhost 应含 thinkphp 伪静态');
  assert.ok(joined.includes('linuxmgr-tp5.access.log'), 'vhost 应含专属日志');
});

test('创建 PHP 项目传非法伪静态预设返回 400', async () => {
  const { app } = setup({ default: OK });
  const res = await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'bad', type: 'php', directory: '/www/bad', port: 8082, phpVersion: 'php74', rewritePreset: 'evil' });
  assert.equal(res.status, 400);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd server && npx node --test test/projects.test.js`
预期：新增 2 个测试 FAIL（vhost 不含伪静态）

- [ ] **步骤 3：修改 server/src/routes/projects.js**

顶部加：

```js
const { buildVhost, applyVhost, REWRITE_PRESETS } = require('../utils/vhost');
```

删除文件内 `PHP_SOCK` 常量与 `nginxVhost` 函数（已被 utils/vhost.js 取代；`PHP_SOCK` 的引用改从 utils 导入：把 `const { PHP_SOCK } = require('../utils/vhost')` 合入上面那行）。

创建接口的校验区（`if (type === 'php' && !PHP_SOCK[phpVersion])` 之后）加：

```js
    if (type === 'php' && req.body.rewritePreset && !REWRITE_PRESETS[req.body.rewritePreset]) {
      return res.status(400).json({ code: 400, message: '伪静态预设不合法' });
    }
```

创建接口 PHP 分支改为：

```js
      if (type === 'php') {
        const project0 = {
          name: fullName, type, directory, port: portNum,
          phpVersion, domain: domain || undefined,
          domains: domain ? [domain] : [],
          rewrite: { preset: req.body.rewritePreset || 'none' },
        };
        await applyVhost({ pool }, cfg, project0);
      } else {
```

（原 systemd 分支不变。）项目记录写入处（`const project = { ... }`）加两个字段：

```js
        domains: domain ? [domain] : [],
        rewrite: type === 'php' ? { preset: req.body.rewritePreset || 'none' } : undefined,
```

删除接口：`if (project.type === 'php')` 的 vhost 清理分支条件改为「PHP 项目或开过反向代理的非 PHP 项目都要清 vhost」：

```js
      const vhostName = name.replace('linuxmgr-', '');
      cmds.push(
        `mkdir -p /tmp/linuxmgr-backup && cp /etc/nginx/conf.d/linuxmgr-${vhostName}.conf /tmp/linuxmgr-backup/ 2>/dev/null || true`,
        `rm -f /etc/nginx/conf.d/linuxmgr-${vhostName}.conf`,
        `rm -f /etc/nginx/linuxmgr-htpasswd-${name}`,
        'nginx -s reload'
      );
      if (project.type !== 'php') {
        cmds.push(`rm -f /etc/systemd/system/${name}.service`);
      }
```

（即：vhost 清理对所有类型执行——没生成过 vhost 时 `rm -f` 无害；systemd 清理仅非 PHP。）

- [ ] **步骤 4：运行完整测试**

运行：`cd server && npm test`
预期：全部 PASS（原有「创建 PHP 项目」测试仍过：vhost 仍写同一路径、仍含 socket、仍 reload）

- [ ] **步骤 5：Commit**

```bash
git add server/src/routes/projects.js server/test/projects.test.js
git commit -m "feat(server): 项目创建接入声明式 vhost，PHP 支持创建时选伪静态预设"
```

---

## 任务 4：站点设置接口（GET/PUT settings，校验 + 再生成 + 回滚）

**文件：**
- 修改：`server/src/routes/projects.js`
- 测试：`server/test/projects.test.js`（追加）

- [ ] **步骤 1：追加测试**

```js
async function createPhp(app) {
  await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'blog', type: 'php', directory: '/www/blog', port: 8080, phpVersion: 'php82', domain: 'a.com' });
}

test('读取设置：旧字段合并默认值', async () => {
  const { app } = setup({ default: OK });
  await createPhp(app);
  const res = await request(app).get('/api/servers/srv1/projects/linuxmgr-blog/settings').set(await auth(app));
  assert.equal(res.status, 200);
  const s = res.body.data.settings;
  assert.deepEqual(s.domains, ['a.com']);
  assert.equal(s.rewrite.preset, 'none');
  assert.equal(s.index, 'index.php index.html');
  assert.ok(Array.isArray(res.body.data.phpVersions));
});

test('保存设置：再生成 vhost 并持久化', async () => {
  const { app, stores, calls } = setup({ default: OK });
  await createPhp(app);
  calls.length = 0;
  const res = await request(app).put('/api/servers/srv1/projects/linuxmgr-blog/settings').set(await auth(app))
    .send({ settings: { domains: ['a.com', 'b.com'], rewrite: { preset: 'laravel' }, antiLeech: { enabled: true, allowEmpty: true, referers: ['a.com'] } } });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('server_name a.com b.com;'));
  assert.ok(joined.includes('valid_referers none server_names a.com;'));
  const saved = JSON.parse(fs.readFileSync(stores.projects.file, 'utf8'))[0];
  assert.equal(saved.rewrite.preset, 'laravel');
});

test('保存设置：nginx 校验失败回滚且不保存', async () => {
  const { app, stores, calls } = setup({
    'nginx -t && nginx -s reload': () => ({ code: 1, stdout: '', stderr: 'emerg: bad' }),
    default: OK,
  });
  await request(app).post('/api/servers/srv1/projects').set(await auth(app))
    .send({ name: 'blog', type: 'php', directory: '/www/blog', port: 8080, phpVersion: 'php82' });
  // 创建时 nginx -t 也会失败 → 创建本身失败；改用手动造记录
  stores.projects.write([{ name: 'linuxmgr-blog', type: 'php', directory: '/www/blog', port: 8080, phpVersion: 'php82', createdAt: new Date().toISOString() }]);
  calls.length = 0;
  const res = await request(app).put('/api/servers/srv1/projects/linuxmgr-blog/settings').set(await auth(app))
    .send({ settings: { rewrite: { preset: 'wordpress' } } });
  assert.equal(res.status, 502);
  assert.ok(res.body.message.includes('已还原'));
  const saved = JSON.parse(fs.readFileSync(stores.projects.file, 'utf8'))[0];
  assert.ok(!saved.rewrite || saved.rewrite.preset !== 'wordpress', '失败时不应保存新设置');
});

test('设置校验：非法域名/IP/重定向/自定义规则', async () => {
  const { app } = setup({ default: OK });
  await createPhp(app);
  const put = (settings) => request(app).put('/api/servers/srv1/projects/linuxmgr-blog/settings').set(auth(app) as never);
  const cases = [
    { domains: ['bad domain!'] },
    { access: { allow: ['not-an-ip'], deny: [] } },
    { redirects: [{ from: 'no-slash', to: 'https://a.com', type: 301 }] },
    { rewrite: { preset: 'custom', custom: 'rewrite x y; } evil' } },
    { customSnippet: '}' },
  ];
  for (const settings of cases) {
    const res = await request(app).put('/api/servers/srv1/projects/linuxmgr-blog/settings').set(await auth(app)).send({ settings });
    assert.equal(res.status, 400, JSON.stringify(settings));
  }
});
```

注意：上面 `put` 辅助行是草稿，直接逐条写完整 request 调用即可（参考循环内的写法）。

- [ ] **步骤 2：运行测试验证失败**

运行：`cd server && npx node --test test/projects.test.js`
预期：4 个新测试 FAIL（404）

- [ ] **步骤 3：projects.js 新增 settings 接口**

顶部加：

```js
const { applyBasicAuth } = require('../utils/vhost');
```

在日志接口之前插入：

```js
  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  const REDIRECT_URL_RE = /^https?:\/\/[^\s]{1,200}$|^\/[^\s]{0,200}$/;
  const PATH_RE = /^\/[^\s]{0,200}$/;
  const RUNDIR_RE = /^\/[a-zA-Z0-9_\/.-]{0,100}$/;
  const INDEX_RE = /^[a-zA-Z0-9_. ]{1,100}$/;
  const USERNAME_RE = /^[a-zA-Z0-9_]{1,32}$/;
  const PRESETS = ['none', 'thinkphp', 'laravel', 'wordpress', 'typecho', 'emlog', 'discuz', 'custom'];

  function defaultSettings(p) {
    return {
      domains: Array.isArray(p.domains) && p.domains.length ? p.domains : [p.domain].filter(Boolean),
      runDir: p.runDir || '',
      index: p.index || 'index.php index.html',
      rewrite: p.rewrite || { preset: 'none' },
      antiLeech: p.antiLeech || { enabled: false, allowEmpty: true, referers: [] },
      redirects: Array.isArray(p.redirects) ? p.redirects : [],
      proxy: p.proxy || { enabled: false, target: '' },
      access: p.access || { allow: [], deny: [] },
      basicAuth: p.basicAuth ? { enabled: p.basicAuth.enabled, username: p.basicAuth.username } : { enabled: false, username: '' },
      customSnippet: p.customSnippet || '',
      sslDomain: p.sslDomain || '',
      phpVersion: p.phpVersion || '',
    };
  }

  // 校验并规范化输入；返回 { error } 或 { settings }
  function validateSettings(input, project) {
    const s = input || {};
    const out = {};
    if (s.domains !== undefined) {
      if (!Array.isArray(s.domains) || s.domains.length > 10) return { error: '域名列表不合法（最多 10 个）' };
      for (const d of s.domains) if (!DOMAIN_RE.test(d)) return { error: `域名不合法: ${d}` };
      out.domains = s.domains;
    }
    if (s.runDir !== undefined) {
      if (!RUNDIR_RE.test(s.runDir)) return { error: '运行目录不合法' };
      out.runDir = s.runDir;
    }
    if (s.index !== undefined) {
      if (!INDEX_RE.test(s.index)) return { error: '默认文档不合法' };
      out.index = s.index;
    }
    if (s.rewrite !== undefined) {
      const rw = s.rewrite || {};
      if (!PRESETS.includes(rw.preset)) return { error: '伪静态预设不合法' };
      if (rw.preset === 'custom') {
        if (!rw.custom || String(rw.custom).length > 2000) return { error: '自定义伪静态规则不能为空且不超过 2000 字' };
        if (String(rw.custom).includes('}')) return { error: '自定义规则不能包含 } 字符' };
      }
      out.rewrite = { preset: rw.preset, custom: rw.preset === 'custom' ? String(rw.custom) : undefined };
    }
    if (s.antiLeech !== undefined) {
      const a = s.antiLeech || {};
      const referers = Array.isArray(a.referers) ? a.referers : [];
      for (const r of referers) if (!/^(\*\.)?[a-zA-Z0-9.-]{1,100}$/.test(r)) return { error: `防盗链域名不合法: ${r}` };
      out.antiLeech = { enabled: !!a.enabled, allowEmpty: a.allowEmpty !== false, referers };
    }
    if (s.redirects !== undefined) {
      if (!Array.isArray(s.redirects) || s.redirects.length > 20) return { error: '重定向规则不合法（最多 20 条）' };
      for (const r of s.redirects) {
        if (!PATH_RE.test(r.from || '')) return { error: `重定向来源路径不合法: ${r.from}` };
        if (!REDIRECT_URL_RE.test(r.to || '')) return { error: `重定向目标不合法: ${r.to}` };
        if (![301, 302].includes(Number(r.type))) return { error: '重定向类型必须为 301 或 302' };
      }
      out.redirects = s.redirects.map((r) => ({ from: r.from, to: r.to, type: Number(r.type) }));
    }
    if (s.proxy !== undefined) {
      const pr = s.proxy || {};
      if (pr.target && !/^https?:\/\/[a-zA-Z0-9.:-]{1,100}$/.test(pr.target)) return { error: '反向代理目标不合法' };
      out.proxy = { enabled: !!pr.enabled, target: pr.target || '' };
    }
    if (s.access !== undefined) {
      const ac = s.access || {};
      const allow = Array.isArray(ac.allow) ? ac.allow : [];
      const deny = Array.isArray(ac.deny) ? ac.deny : [];
      for (const ip of [...allow, ...deny]) if (!IP_RE.test(ip)) return { error: `IP 不合法: ${ip}` };
      out.access = { allow, deny };
    }
    if (s.basicAuth !== undefined) {
      const b = s.basicAuth || {};
      if (b.enabled) {
        if (!USERNAME_RE.test(b.username || '')) return { error: '密码访问用户名不合法' };
        const had = project.basicAuth?.enabled && project.basicAuth?.username === b.username;
        if (!b.password && !had) return { error: '启用密码访问必须设置密码' };
        out.basicAuth = {
          enabled: true,
          username: b.username,
          passwordEnc: b.password ? encrypt(String(b.password), config.masterKey) : project.basicAuth.passwordEnc,
        };
      } else {
        out.basicAuth = { enabled: false, username: b.username || '' };
      }
    }
    if (s.customSnippet !== undefined) {
      if (String(s.customSnippet).length > 2000) return { error: '自定义片段不超过 2000 字' };
      if (String(s.customSnippet).includes('}')) return { error: '自定义片段不能包含 } 字符' };
      out.customSnippet = String(s.customSnippet);
    }
    if (s.phpVersion !== undefined) {
      if (project.type === 'php' && s.phpVersion && !PHP_SOCK[s.phpVersion]) return { error: 'PHP 版本不合法' };
      if (project.type === 'php' && s.phpVersion) out.phpVersion = s.phpVersion;
    }
    return { settings: out };
  }

  router.get('/servers/:id/projects/:name/settings', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    let phpVersions = [];
    if (project.type === 'php') {
      const r = await pool.run(cfg, 'ls /var/run/php*-php-fpm.sock 2>/dev/null');
      phpVersions = (r.stdout || '').split('\n')
        .map((l) => l.trim().match(/php(\d+)-php-fpm\.sock/))
        .filter(Boolean).map((m) => `php${m[1]}`);
    }
    res.json({ code: 0, data: { settings: defaultSettings(project), phpVersions, sslDomain: project.sslDomain || '' } });
  });

  router.put('/servers/:id/projects/:name/settings', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const list = projectStore.read();
    const project = list.find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const { error, settings } = validateSettings(req.body?.settings, project);
    if (error) return res.status(400).json({ code: 400, message: error });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const next = { ...project, ...settings };
      const needsVhost = next.type === 'php' || next.proxy?.enabled;
      if (needsVhost) {
        await applyBasicAuth({ pool, config }, cfg, next);
        await applyVhost({ pool }, cfg, next);
      } else if (project.type !== 'php' && project.proxy?.enabled && !next.proxy?.enabled) {
        // 关闭反向代理：删除 vhost
        await pool.run(cfg, `rm -f /etc/nginx/conf.d/${name}.conf`);
        await pool.run(cfg, 'nginx -s reload');
        await applyBasicAuth({ pool, config }, cfg, next);
      }
      projectStore.write(list.map((p) => (p.name === name ? next : p)));
      audit(config.dataDir, { action: 'project.settings', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { settings: defaultSettings(next) } });
    } catch (err) {
      audit(config.dataDir, { action: 'project.settings', target: server.host, detail: name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `保存设置失败: ${err.message}` });
    }
  });
```

`encrypt` 需在顶部导入：`const { encrypt, decrypt } = require('../crypto/cipher');`（替换现有只导入 decrypt 的行）。

- [ ] **步骤 4：运行完整测试**

运行：`cd server && npm test`
预期：全部 PASS

- [ ] **步骤 5：Commit**

```bash
git add server/src/routes/projects.js server/test/projects.test.js
git commit -m "feat(server): 站点设置接口（校验/再生成/回滚/审计）"
```

---

## 任务 5：vhost 预览 + 网站日志接口 + SSL 关联改造

**文件：**
- 修改：`server/src/routes/projects.js`、`server/src/routes/ssl.js`
- 测试：`server/test/projects.test.js`（追加）

- [ ] **步骤 1：追加测试**

```js
test('查看生成的 vhost 配置', async () => {
  const { app } = setup({ default: OK });
  await createPhp(app);
  const res = await request(app).get('/api/servers/srv1/projects/linuxmgr-blog/vhost').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.includes('server {'));
  assert.ok(res.body.data.includes('fastcgi_pass unix:/var/run/php82-php-fpm.sock;'));
});

test('网站日志读取', async () => {
  const { app } = setup({
    default: OK,
  });
  await createPhp(app);
  const res = await request(app).get('/api/servers/srv1/projects/linuxmgr-blog/sitelogs?type=access&lines=100').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data, 'string');
  const bad = await request(app).get('/api/servers/srv1/projects/linuxmgr-blog/sitelogs?type=evil').set(await auth(app));
  assert.equal(bad.status, 400);
});
```

- [ ] **步骤 2：运行测试验证失败** — `cd server && npx node --test test/projects.test.js`，预期 2 个新测试 FAIL（404）

- [ ] **步骤 3：projects.js 新增两个接口**（settings 接口之后）：

```js
  router.get('/servers/:id/projects/:name/vhost', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    if (project.type !== 'php' && !project.proxy?.enabled) {
      return res.json({ code: 0, data: '# 该项目未启用反向代理，无 Nginx 配置' });
    }
    res.json({ code: 0, data: buildVhost(project) });
  });

  router.get('/servers/:id/projects/:name/sitelogs', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name) || !name.startsWith('linuxmgr-')) return res.status(400).json({ code: 400, message: '只能操作本工具创建的项目' });
    const project = projectStore.read().find((p) => p.name === name);
    if (!project) return res.status(404).json({ code: 404, message: '项目不存在' });
    const type = req.query.type === 'error' ? 'error' : req.query.type === 'access' ? 'access' : null;
    if (!type) return res.status(400).json({ code: 400, message: 'type 必须为 access 或 error' });
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 1000);
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const r = await pool.run(cfg, `tail -n ${lines} /var/log/nginx/${name}.${type}.log 2>/dev/null || true`);
      res.json({ code: 0, data: r.stdout || '' });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取网站日志失败: ${err.message}` });
    }
  });
```

- [ ] **步骤 4：ssl.js linkVhost 改造**

`server/src/routes/ssl.js` 顶部加：

```js
const { applyVhost } = require('../utils/vhost');
```

`linkVhost` 函数整个替换为：

```js
  // 将证书关联到项目：写 sslDomain 字段并重新生成 vhost
  async function linkVhost(cfg, server, domain) {
    if (!projectStore) return { linked: false, reason: '项目存储不可用' };
    const list = projectStore.read();
    const project = list.find((p) => (Array.isArray(p.domains) && p.domains.length ? p.domains : [p.domain].filter(Boolean)).includes(domain));
    if (!project) return { linked: false, reason: '未找到该域名的项目' };
    if (project.type !== 'php' && !project.proxy?.enabled) {
      return { linked: false, reason: '该项目无 Nginx 配置（未启用反向代理）' };
    }
    if (project.sslDomain === domain) return { linked: true, reason: '已关联' };
    const next = { ...project, sslDomain: domain };
    try {
      await applyVhost({ pool }, cfg, next);
    } catch (err) {
      return { linked: false, reason: err.message };
    }
    projectStore.write(list.map((p) => (p.name === project.name ? next : p)));
    return { linked: true, reason: '已关联并 reload' };
  }
```

- [ ] **步骤 5：运行完整测试 + Commit**

运行：`cd server && npm test`，预期全部 PASS

```bash
git add server/src/routes/projects.js server/src/routes/ssl.js server/test/projects.test.js
git commit -m "feat(server): vhost 预览与网站日志接口，SSL 关联改为声明式再生成"
```

---

## 任务 6：前端 API + 网站管理设置抽屉 + 创建对话框伪静态

**文件：**
- 修改：`apps/web/src/api/projects.ts`
- 创建：`apps/web/src/views/projects/SettingsDrawer.vue`
- 修改：`apps/web/src/views/projects/index.vue`

- [ ] **步骤 1：api/projects.ts 追加**

```ts
export interface SiteSettings {
  domains: string[]
  runDir: string
  index: string
  rewrite: { preset: string; custom?: string }
  antiLeech: { enabled: boolean; allowEmpty: boolean; referers: string[] }
  redirects: { from: string; to: string; type: number }[]
  proxy: { enabled: boolean; target: string }
  access: { allow: string[]; deny: string[] }
  basicAuth: { enabled: boolean; username: string; password?: string }
  customSnippet: string
  sslDomain: string
  phpVersion: string
}

export interface SettingsResult {
  settings: SiteSettings
  phpVersions: string[]
  sslDomain: string
}

export function getProjectSettings(serverId: string, name: string) {
  return request.get(`/servers/${serverId}/projects/${name}/settings`) as Promise<SettingsResult>
}

export function saveProjectSettings(serverId: string, name: string, settings: Partial<SiteSettings>) {
  return request.put(`/servers/${serverId}/projects/${name}/settings`, { settings }) as Promise<{ settings: SiteSettings }>
}

export function getProjectVhost(serverId: string, name: string) {
  return request.get(`/servers/${serverId}/projects/${name}/vhost`) as Promise<string>
}

export function getSiteLogs(serverId: string, name: string, type: 'access' | 'error', lines = 200) {
  return request.get(`/servers/${serverId}/projects/${name}/sitelogs`, { params: { type, lines } }) as Promise<string>
}
```

`Project` 接口加 `domain?: string`。`ProjectPayload` 加 `domain?: string; rewritePreset?: string`。

- [ ] **步骤 2：创建 SettingsDrawer.vue**

组件契约：
- Props：`serverId: string`、`project: Project | null`
- v-model：`modelValue: boolean`（抽屉显隐）
- 打开时（watch modelValue → true 且 project 有值）调用 `getProjectSettings` 加载
- 布局：el-drawer size `min(860px, 100vw)`，内部 flex：左侧 el-menu（vertical，宽度 160px），右侧内容区 padding 16px
- 菜单项（key → 标题）：
  - `domain` 域名管理
  - `dir` 网站目录（仅 php）
  - `rewrite` 伪静态（仅 php）
  - `indexDoc` 默认文档（仅 php）
  - `access` 访问限制
  - `leech` 防盗链（仅 php）
  - `redirect` 重定向
  - `proxy` 反向代理（仅非 php）
  - `php` PHP版本（仅 php）
  - `ssl` SSL
  - `config` 配置文件
  - `log` 网站日志
- 每个设置区一个局部 reactive 副本，「保存」按钮只 PUT 该区对应字段（Partial）
- 各区内容：
  - domain：el-select multiple filterable allow-create（输入即创建），保存 `domains`
  - dir：el-input `runDir`（占位 `/public`），下方灰色提示「部分框架需指定二级运行目录，如 ThinkPHP5、Laravel」
  - rewrite：el-select 预设（none/thinkphp/laravel/wordpress/typecho/emlog/discuz/custom 中文标签：不使用/ThinkPHP/Laravel/WordPress/Typecho/Emlog/Discuz/自定义），preset=custom 时显示 el-input textarea（rows 6）编辑 `rewrite.custom`
  - indexDoc：el-input `index`（占位 `index.php index.html`）
  - access：两个 el-select multiple filterable allow-create（白名单 allow、黑名单 deny，占位「输入 IP 或 CIDR 回车」）+ 分割线 + basicAuth 开关、用户名、密码（show-password，占位「留空则不修改」）
  - leech：开关 + allowEmpty 开关（允许空 Referer）+ referers el-select multiple allow-create
  - redirect：表格化编辑：每行 from（el-input）/ to（el-input）/ type（el-select 301/302）/ 删除按钮，底部「添加规则」
  - proxy：开关 + target el-input（占位「留空默认 http://127.0.0.1:项目端口」）
  - php：el-select，选项来自 `phpVersions`，保存 `phpVersion`
  - ssl：只读展示当前 `sslDomain`（无则显示「未关联」），按钮「去 SSL 证书页管理」（router.push('/ssl')）
  - config：「刷新预览」按钮 + pre.code-box 展示 `getProjectVhost` 结果 + customSnippet textarea + 保存
  - log：type el-radio-group（access/error）+ 行数 el-select（100/200/500/1000）+「读取」按钮 + pre.code-box 展示
- 保存成功 ElMessage.success('已保存并生效')；失败由 request 拦截器提示
- 风格参照项目现有页面：code-box 类、按钮层级

- [ ] **步骤 3：projects/index.vue 接入**

- 操作列「日志」前加：`<el-button link type="primary" @click="onSettings(row)">设置</el-button>`
- 模板末尾（log drawer 后）加：`<SettingsDrawer v-model="settingsVisible" :server-id="serverStore.currentId || ''" :project="currentProject" />`
- script：导入 SettingsDrawer；加 `const settingsVisible = ref(false)`、`const currentProject = ref<Project | null>(null)`、`function onSettings(row: Project) { currentProject.value = row; settingsVisible.value = true }`
- 创建对话框：PHP 版本表单项后加：

```vue
        <el-form-item v-if="form.type === 'php'" label="伪静态">
          <el-select v-model="form.rewritePreset">
            <el-option label="不使用" value="none" />
            <el-option label="ThinkPHP" value="thinkphp" />
            <el-option label="Laravel" value="laravel" />
            <el-option label="WordPress" value="wordpress" />
            <el-option label="Typecho" value="typecho" />
            <el-option label="Emlog" value="emlog" />
            <el-option label="Discuz" value="discuz" />
          </el-select>
        </el-form-item>
```

- form reactive 加 `rewritePreset: 'none'`；onCreate 的 php 分支加 `payload.rewritePreset = form.rewritePreset`

- [ ] **步骤 4：构建验证 + Commit**

运行：`cd apps/web && npm run build`，预期成功（vue-tsc 0 错误）

```bash
git add apps/web/src/api/projects.ts apps/web/src/views/projects
git commit -m "feat(web): 网站管理设置抽屉与创建时伪静态预设选择"
```

---

## 任务 7：文件管理多标签页

**文件：**
- 修改：`apps/web/src/views/files/index.vue`

- [ ] **步骤 1：标签状态（script setup 顶部，serverStore 声明之后）**

```ts
interface FileTab { id: number; path: string }
const tabs = ref<FileTab[]>([{ id: 1, path: '/' }])
const activeTabId = ref(1)
let nextTabId = 2

const currentPath = computed({
  get: () => tabs.value.find((t) => t.id === activeTabId.value)?.path || '/',
  set: (p: string) => {
    const tab = tabs.value.find((t) => t.id === activeTabId.value)
    if (tab) tab.path = p
  },
})

function tabLabel(tab: FileTab) {
  if (tab.path === '/') return '根目录'
  return tab.path.split('/').filter(Boolean).pop() || '根目录'
}

function persistTabs() {
  if (!serverStore.currentId) return
  localStorage.setItem(`linuxmgr_files_tabs_${serverStore.currentId}`, JSON.stringify({ tabs: tabs.value, activeTabId: activeTabId.value, nextTabId }))
}

function restoreTabs() {
  if (!serverStore.currentId) return
  try {
    const raw = localStorage.getItem(`linuxmgr_files_tabs_${serverStore.currentId}`)
    if (!raw) return
    const data = JSON.parse(raw)
    if (Array.isArray(data.tabs) && data.tabs.length) {
      tabs.value = data.tabs
      activeTabId.value = data.activeTabId || data.tabs[0].id
      nextTabId = data.nextTabId || data.tabs.length + 1
    }
  } catch { /* 损坏则使用默认 */ }
}

function addTab() {
  tabs.value.push({ id: nextTabId++, path: '/' })
  activeTabId.value = tabs.value[tabs.value.length - 1].id
  persistTabs()
  load()
}

function closeTab(id: number) {
  if (tabs.value.length <= 1) return
  const idx = tabs.value.findIndex((t) => t.id === id)
  tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)].id
    load()
  }
  persistTabs()
}

function switchTab(id: number) {
  if (activeTabId.value === id) return
  activeTabId.value = id
  persistTabs()
  load()
}
```

注意：原文件 `const currentPath = ref('/')` 需删除（被上面的 computed 代理取代），其余引用 `currentPath.value` 的代码全部不用改。script 顶部已有 `computed` 导入则无需再加。

`load()` 成功后加一行 `persistTabs()`（在 `pathInput.value = currentPath.value` 之后）。

`onMounted(load)` 改为：

```ts
onMounted(() => {
  restoreTabs()
  load()
})
```

并加服务器切换时恢复标签（script 中）：

```ts
watch(() => serverStore.currentId, () => {
  tabs.value = [{ id: 1, path: '/' }]
  activeTabId.value = 1
  nextTabId = 2
  restoreTabs()
  load()
})
```

（`watch` 需从 vue 导入。）

- [ ] **步骤 2：标签栏模板（page-header 之后、el-card 之前插入）**

```vue
    <div class="tab-bar">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeTabId }"
        @click="switchTab(tab.id)"
      >
        <el-icon><Folder /></el-icon>
        <span class="tab-name">{{ tabLabel(tab) }}</span>
        <el-icon v-if="tabs.length > 1" class="tab-close" @click.stop="closeTab(tab.id)"><Close /></el-icon>
      </div>
      <el-icon class="tab-add" @click="addTab"><Plus /></el-icon>
    </div>
```

图标导入加 `Close, Plus`。

- [ ] **步骤 3：样式（style 块追加）**

```scss
.tab-bar {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 12px;
  .tab-item {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 6px; cursor: pointer;
    background: var(--bg-card); border: 1px solid var(--border);
    font-size: 13px; color: var(--text-2);
    max-width: 220px;
    .tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    &:hover { color: var(--brand); border-color: var(--brand); }
    &.active { color: var(--brand); border-color: var(--brand); background: var(--el-color-primary-light-9); }
  }
  .tab-close { font-size: 12px; border-radius: 50%; &:hover { background: var(--border); color: var(--text-1); } }
  .tab-add {
    padding: 6px; border-radius: 6px; cursor: pointer; color: var(--text-3);
    border: 1px dashed var(--border);
    &:hover { color: var(--brand); border-color: var(--brand); }
  }
}
```

- [ ] **步骤 4：构建验证 + Commit**

运行：`cd apps/web && npm run build`，预期成功（vue-tsc 0 错误）

```bash
git add apps/web/src/views/files/index.vue
git commit -m "feat(web): 文件管理多标签页（按服务器持久化）"
```

---

## 任务 8：README 与最终验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：README 更新**
  - 「功能特性」表格中 `🚀 项目` 行改为：`| 🌐 网站管理 | PHP（Nginx+php-fpm）/ Node / Python / Java 站点创建、systemd 服务管理、启停/重启/日志；**站点设置**：多域名、运行目录、伪静态（ThinkPHP/Laravel/WordPress 等预设，创建时可选）、默认文档、IP 黑白名单、密码访问、防盗链、重定向、反向代理、PHP 版本切换、SSL 关联、配置预览、网站日志 |`
  - `📁 文件管理` 行说明末尾加「、多标签页」
  - 功能特性表中 `📊 监控大盘` → `📊 数据监控`
- [ ] **步骤 2：全量验证**

运行：`cd server && npm test`，预期全部 PASS
运行：`cd apps/web && npm run build`，预期成功

- [ ] **步骤 3：真实服务器验证（如该环境可用，否则留待人工）**

对可用服务器只读验证：创建带伪静态的 PHP 项目 → 保存各项设置 → vhost 预览 → 网站日志读取 → SSL 关联。涉及写操作的部分需用户确认后执行。

- [ ] **步骤 4：Commit**

```bash
git add README.md
git commit -m "docs: 网站管理站点设置与文件多标签页说明"
```

---

## 任务 9：登录页升级为左右分栏布局

**文件：**
- 修改：`apps/web/src/views/login/index.vue`

- [ ] **步骤 1：调整模板与样式**

在现有登录页（上轮已重做：品牌区 + 渐变光晕背景 + rise 动画）基础上升级为左右分栏：

- `.login-page` 内改为一个 `login-panel` 容器（flex，宽 min(880px, 94vw)，高 min(560px, 82vh)，12px 圆角、大投影、overflow hidden、rise 动画）
- 左侧 `.brand-side`（flex 1，深蓝渐变背景 + 双层 radial-gradient 光晕 + 细网格纹理 background-image: repeating-linear-gradient 半透明线）：产品名「云小U」（28px 700）、副标题「服务器管理面板」、三条特性列表（多服务器集中管理 / 网站与数据库一站式运维 / 安全可靠 · 操作留痕），每条前置小圆点；文字白色系
- 右侧 `.form-side`（宽 400px，背景 var(--bg-card)，padding 40px 36px，flex 居中）：标题「欢迎登录」（20px 600）+ 副提示（13px text-3）+ 原有表单（大号输入框带前缀图标、全宽登录按钮）
- 响应式：`@media (max-width: 767px)` 时 `.brand-side { display: none }`，`.login-panel` 高度自适应，`.form-side` 宽度 100%
- 登录逻辑（onSubmit / userStore.login）不动

- [ ] **步骤 2：构建验证 + Commit**

运行：`cd apps/web && npm run build`，预期成功

```bash
git add apps/web/src/views/login/index.vue
git commit -m "feat(web): 登录页升级左右分栏布局"
```

---

## 自检记录

- 规格 A（菜单改名）→ 任务 1；规格 B（站点设置）→ 任务 2-6（vhost 纯函数 2、创建接入 3、settings 接口 4、预览/日志/SSL 5、前端 6）；规格 C（文件多标签）→ 任务 7；验证 → 任务 8
- 类型一致性：`buildVhost`/`applyVhost`/`applyBasicAuth`/`REWRITE_PRESETS`/`PHP_SOCK` 在任务 2 定义，任务 3/4/5 使用；`defaultSettings` 返回的字段名与 `SiteSettings` TS 接口一致（domains/runDir/index/rewrite/antiLeech/redirects/proxy/access/basicAuth/customSnippet/sslDomain/phpVersion）
- `encrypt` 导入在任务 4 步骤 3 显式说明；任务 5 测试依赖任务 4 的 `createPhp` helper（同文件内）
