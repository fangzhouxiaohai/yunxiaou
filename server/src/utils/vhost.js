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
    else if (rw.preset && rw.preset !== 'none' && REWRITE_PRESETS[rw.preset]) lines.push(REWRITE_PRESETS[rw.preset]);
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
  const t = await pool.run(cfg, 'nginx -t');
  if (t.code !== 0) {
    if (backup.stdout && backup.stdout.includes('server {')) {
      await pool.run(cfg, `cat > ${confPath} <<'LINUXMGR_EOF'\n${backup.stdout}\nLINUXMGR_EOF`);
    } else {
      await pool.run(cfg, `rm -f ${confPath}`);
    }
    await pool.run(cfg, 'nginx -s reload');
    throw new Error(`Nginx 配置校验失败，已还原旧配置: ${t.stderr.slice(0, 200)}`);
  }
  // 配置已校验合法，reload 失败单独报错、不回滚
  const rl = await pool.run(cfg, 'nginx -s reload');
  if (rl.code !== 0) throw new Error(`Nginx reload 失败（配置已校验通过）: ${rl.stderr.slice(0, 200)}`);
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
