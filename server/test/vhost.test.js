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
