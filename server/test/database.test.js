const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/index');
const { loadConfig } = require('../src/config');
const { JsonStore } = require('../src/store/jsonStore');
const { encrypt } = require('../src/crypto/cipher');

function makePool(scripted) {
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const handler = scripted[command] || scripted.default;
      if (handler) return handler();
      return { code: 0, stdout: '', stderr: '' };
    },
    closeKey: () => {},
  };
  return { pool, calls };
}

const DB_OUTPUT = `Database\ninformation_schema\nmysql\nperformance_schema\nsys\napp_blog\n`;

function setup(scripted = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-db-'));
  const { config } = loadConfig({
    JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir,
  });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  stores.servers.write([{
    id: 'srv1', name: '测试机', host: '10.0.0.1', port: 22, username: 'root',
    passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString(),
  }]);
  const { pool, calls } = makePool(scripted);
  const app = createApp({ config, pool, stores });
  return { app, config, stores, pool, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

test('数据库列表', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: DB_OUTPUT, stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, true);
  assert.ok(res.body.data.databases.includes('app_blog'));
  assert.ok(calls.some((c) => c.includes('SHOW DATABASES')));
});

test('MySQL 未安装时返回 unavailable 而非报错', async () => {
  const { app } = setup({
    default: () => ({ code: 127, stdout: '', stderr: 'bash: mysql: command not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
  assert.ok(res.body.data.message.includes('mysql'));
});

test('创建数据库+用户+授权', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases').set(await auth(app))
    .send({ name: 'app_new', username: 'app_new_user', password: 'DbPass123!' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('CREATE DATABASE IF NOT EXISTS \\`app_new\\`'));
  assert.ok(joined.includes('CREATE USER'));
  assert.ok(joined.includes('GRANT ALL PRIVILEGES ON \\`app_new\\`.*'));
});

test('删除数据库前自动备份', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).delete('/api/servers/srv1/databases/app_old').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mysqldump'), '删除前应备份');
  assert.ok(joined.includes('/tmp/linuxmgr-db-backup'));
  assert.ok(joined.includes('DROP DATABASE \\`app_old\\`'));
});

test('删除数据库未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).delete('/api/servers/srv1/databases/app_old').set(await auth(app))
    .send({ confirm: false });
  assert.equal(res.status, 400);
});

test('Redis 状态', async () => {
  const { app } = setup({
    default: () => ({
      code: 0,
      stdout: 'redis_version:7.0.15\nconnected_clients:3\nused_memory:1048576\nkeyspace_hits:10\nkeyspace_misses:2\ndb0:keys=5,expires=0,avg_ttl=0\n',
      stderr: '',
    }),
  });
  const res = await request(app).get('/api/servers/srv1/redis').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.version, '7.0.15');
  assert.equal(res.body.data.totalKeys, 5);
});

test('Redis 未安装时返回 unavailable 而非报错', async () => {
  const { app } = setup({
    default: () => ({ code: 127, stdout: '', stderr: 'bash: redis-cli: command not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/redis').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.available, false);
  assert.ok(res.body.data.message.includes('redis-cli'));
});

test('Redis 清空需确认且审计', async () => {
  const { app, calls, config } = setup({ default: () => ({ code: 0, stdout: 'OK', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/redis/flush').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('FLUSHDB')));
  const auditLog = fs.readFileSync(path.join(config.dataDir, 'audit.log'), 'utf8');
  assert.ok(auditLog.includes('redis.flush'));
});

test('MySQL 版本列表（已装实例 + 可安装版本）', async () => {
  const { app } = setup({
    'mysql --version': () => ({ code: 0, stdout: 'mysql  Ver 8.0.40 for Linux on x86_64', stderr: '' }),
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mysqld.service loaded active running\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/mysql/versions').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.instances.length, 1);
  assert.equal(res.body.data.instances[0].service, 'mysqld');
  assert.equal(res.body.data.instances[0].state, 'running');
  assert.ok(res.body.data.instances[0].version.includes('8.0'), '应带 mysql 客户端版本');
  assert.ok(res.body.data.available.length >= 2, '应列出可安装版本');
});

test('安装 MySQL 8.0（官方源）', async () => {
  const { app, calls } = setup({
    'rpm -Uvh https://repo.mysql.com/mysql80-community-release-el7-7.noarch.rpm': () => ({ code: 0, stdout: '', stderr: '' }),
    'yum install -y mysql-community-server': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl enable --now mysqld': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mysql-community-server'), '应安装 MySQL 官方包');
});

test('已存在 MySQL 实例时拒绝自动安装', async () => {
  const { app } = setup({
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mysqld.service loaded active running\n', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: true });
  assert.equal(res.status, 400);
});

test('安装 MySQL 未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 127, stdout: '', stderr: 'not found' }) });
  const res = await request(app).post('/api/servers/srv1/mysql/install').set(await auth(app))
    .send({ version: '8.0', confirm: false });
  assert.equal(res.status, 400);
});

test('切换默认 MySQL 实例（停其他启目标）', async () => {
  const { app, calls } = setup({
    'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"': () => ({ code: 0, stdout: 'mariadb.service loaded active running\nmysqld.service loaded inactive dead\n', stderr: '' }),
    'systemctl stop mariadb': () => ({ code: 0, stdout: '', stderr: '' }),
    'systemctl start mysqld': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).post('/api/servers/srv1/mysql/switch').set(await auth(app))
    .send({ service: 'mysqld', confirm: true });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('systemctl stop mariadb'), '应停止其他实例');
  assert.ok(joined.includes('systemctl start mysqld'), '应启动目标实例');
});

// ===== 数据库面板（phpMyAdmin 风格）=====

const BATCH_TABLES = 'Tables_in_app_blog\nposts\nusers\n';
const BATCH_DESCRIBE = 'Field\tType\tNull\tKey\tDefault\tExtra\nid\tint\tNO\tPRI\tNULL\t\nname\tvarchar(255)\tYES\t\tNULL\t\n';
const BATCH_SELECT = 'id\tname\n1\thello\n2\tworld\n';

test('表列表', async () => {
  const { app } = setup({
    'sudo mysql -B -e "SHOW TABLES FROM \\`app_blog\\`"': () => ({ code: 0, stdout: BATCH_TABLES, stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases/app_blog/tables').set(await auth(app));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.includes('posts'));
  assert.ok(res.body.data.includes('users'));
});

test('表结构', async () => {
  const { app } = setup({
    'sudo mysql -B -e "DESCRIBE \\`app_blog\\`.\\`posts\\`"': () => ({ code: 0, stdout: BATCH_DESCRIBE, stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases/app_blog/tables/posts/structure').set(await auth(app));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.columns, ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra']);
  assert.equal(res.body.data.rows[0][0], 'id');
});

test('数据浏览分页', async () => {
  const { app, calls } = setup({
    'sudo mysql -B -e "SELECT * FROM \\`app_blog\\`.\\`posts\\` LIMIT 10 OFFSET 10"': () => ({ code: 0, stdout: BATCH_SELECT, stderr: '' }),
    'sudo mysql -N -e "SELECT COUNT(*) FROM \\`app_blog\\`.\\`posts\\`"': () => ({ code: 0, stdout: '42\n', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).get('/api/servers/srv1/databases/app_blog/tables/posts/rows?page=2&limit=10').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 42);
  assert.deepEqual(res.body.data.columns, ['id', 'name']);
  assert.equal(res.body.data.rows.length, 2);
});

test('执行只读 SQL', async () => {
  const { app } = setup({
    'sudo mysql -B -e "USE \\`app_blog\\`; SELECT * FROM posts LIMIT 5"': () => ({ code: 0, stdout: BATCH_SELECT, stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/sql').set(await auth(app))
    .send({ db: 'app_blog', sql: 'SELECT * FROM posts LIMIT 5' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.rows.length, 2);
});

test('执行写 SQL 未确认时拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/sql').set(await auth(app))
    .send({ db: 'app_blog', sql: 'DELETE FROM posts WHERE id=1' });
  assert.equal(res.status, 400);
});

test('危险 SQL 无 WHERE 的 DELETE 即使确认也拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/sql').set(await auth(app))
    .send({ db: 'app_blog', sql: 'DELETE FROM posts', confirm: true });
  assert.equal(res.status, 400);
});

test('危险 SQL DROP TABLE 需确认', async () => {
  const { app, calls } = setup({
    'sudo mysql -B -e "DROP TABLE \\`app_blog\\`.\\`old_posts\\`"': () => ({ code: 0, stdout: '', stderr: '' }),
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/sql').set(await auth(app))
    .send({ db: 'app_blog', sql: 'DROP TABLE old_posts', confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('DROP TABLE')));
});

test('创建表生成 CREATE TABLE 语句', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases/app_blog/tables').set(await auth(app))
    .send({
      table: 'posts',
      columns: [
        { name: 'id', type: 'int', primary: true, autoIncrement: true },
        { name: 'title', type: 'varchar', length: 200, nullable: false, defaultValue: '', comment: '标题' },
        { name: 'created_at', type: 'datetime', nullable: true },
      ],
    });
  assert.equal(res.status, 200, res.body.message);
  const sql = calls.join(' ');
  assert.ok(sql.includes('CREATE TABLE \\`app_blog\\`.\\`posts\\`'));
  assert.ok(sql.includes('\\`id\\` int NOT NULL AUTO_INCREMENT'));
  assert.ok(sql.includes('\\`title\\` varchar(200) NOT NULL'));
  assert.ok(sql.includes("COMMENT '标题'"));
  assert.ok(sql.includes('PRIMARY KEY (\\`id\\`)'));
  assert.ok(sql.includes('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'));
});

test('创建表缺长度 varchar 拒绝', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases/app_blog/tables').set(await auth(app))
    .send({ table: 't1', columns: [{ name: 'name', type: 'varchar' }] });
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.includes('CREATE TABLE')));
});

test('创建表非法类型拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases/app_blog/tables').set(await auth(app))
    .send({ table: 't1', columns: [{ name: 'x', type: 'varchar(200); DROP TABLE x;--' }] });
  assert.equal(res.status, 400);
});

test('删除表需确认且确认后执行 DROP TABLE', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const noConfirm = await request(app).delete('/api/servers/srv1/databases/app_blog/tables/posts').set(await auth(app));
  assert.equal(noConfirm.status, 400);
  const res = await request(app).delete('/api/servers/srv1/databases/app_blog/tables/posts').set(await auth(app))
    .send({ confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('DROP TABLE \\`app_blog\\`.\\`posts\\`')));
});

test('添加/修改/删除字段生成对应 ALTER 语句', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const a = await auth(app);
  let res = await request(app).post('/api/servers/srv1/databases/app_blog/tables/posts/columns').set(a)
    .send({ column: { name: 'views', type: 'int', nullable: false, defaultValue: '0' }, after: 'title' });
  assert.equal(res.status, 200, res.body.message);
  assert.ok(calls.some((c) => c.includes('ADD COLUMN \\`views\\` int NOT NULL DEFAULT 0 AFTER \\`title\\`')));

  res = await request(app).put('/api/servers/srv1/databases/app_blog/tables/posts/columns/views').set(a)
    .send({ column: { name: 'view_count', type: 'bigint', nullable: true } });
  assert.equal(res.status, 200, res.body.message);
  assert.ok(calls.some((c) => c.includes('CHANGE COLUMN \\`views\\` \\`view_count\\` bigint NULL')));

  res = await request(app).delete('/api/servers/srv1/databases/app_blog/tables/posts/columns/view_count').set(a)
    .send({ confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('DROP COLUMN \\`view_count\\`')));
});

test('插入行转义单引号与反斜杠', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(await auth(app))
    .send({ data: { title: "it's a \\test", views: null } });
  assert.equal(res.status, 200, res.body.message);
  const sql = calls.find((c) => c.includes('INSERT INTO'));
  assert.ok(sql.includes("\\`title\\`, \\`views\\`"));
  assert.ok(sql.includes("VALUES ('it''s a \\\\\\\\test', NULL)"));
});

test('更新行使用空值安全比较且拒绝空 where', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const a = await auth(app);
  const bad = await request(app).put('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(a)
    .send({ where: {}, data: { title: 'x' } });
  assert.equal(bad.status, 400);
  const res = await request(app).put('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(a)
    .send({ where: { id: '3', note: null }, data: { title: 'new' } });
  assert.equal(res.status, 200, res.body.message);
  const sql = calls.find((c) => c.includes('UPDATE'));
  assert.ok(sql.includes("SET \\`title\\` = 'new'"));
  assert.ok(sql.includes("\\`id\\` <=> '3' AND \\`note\\` <=> NULL"));
});

test('删除行需确认且带 where', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const a = await auth(app);
  const noConfirm = await request(app).delete('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(a)
    .send({ where: { id: '3' } });
  assert.equal(noConfirm.status, 400);
  const res = await request(app).delete('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(a)
    .send({ confirm: true, where: { id: '3' } });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('DELETE FROM \\`app_blog\\`.\\`posts\\` WHERE \\`id\\` <=> ')));
});

test('行操作非法字段名拒绝', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).put('/api/servers/srv1/databases/app_blog/tables/posts/rows').set(await auth(app))
    .send({ where: { 'id` OR 1=1 --': '1' }, data: { title: 'x' } });
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.includes('UPDATE')));
});
