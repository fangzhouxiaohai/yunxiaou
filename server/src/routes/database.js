const express = require('express');
const { encrypt, decrypt } = require('../crypto/cipher');
const { parseDatabases, parseRedisInfo, parseBatchResult } = require('../utils/dbParser');
const { audit } = require('../utils/audit');

const DB_NAME_RE = /^[a-zA-Z0-9_]{1,64}$/;
const USER_NAME_RE = /^[a-zA-Z0-9_]{1,32}$/;
const TABLE_RE = /^[a-zA-Z0-9_$]{1,64}$/;

function createDatabaseRouter({ config, pool, store }) {
  const router = express.Router();

  const findServer = (id) => store.read().find((s) => s.id === id);

  function passwordOf(server, field, res) {
    if (!server[field]) return null; // 未配置则用 sudo/无密码方式
    try {
      return decrypt(server[field], config.masterKey);
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return undefined; // 区分"未配置"(null) 与 "解密失败"(undefined)
    }
  }

  function sshCfgOf(server, res) {
    const pwd = passwordOf(server, 'passwordEnc', res);
    if (pwd === undefined) return null;
    return { host: server.host, port: server.port, username: server.username, password: pwd };
  }

  // mysql 认证参数：配置了密码用 -p，否则走 sudo（auth_socket）
  function mysqlAuth(server, res) {
    const pwd = passwordOf(server, 'mysqlPasswordEnc', res);
    if (pwd === undefined) return null; // 解密失败
    if (pwd) return `-u root -p'${pwd.replace(/'/g, "'\\''")}'`;
    return ''; // sudo 模式
  }

  // bash 转义：双引号内的 ` " $ \ 需转义，防止命令注入/命令替换（真实 bash 执行）
  function bashEscape(sql) {
    return sql
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$');
  }

  function mysqlCmd(server, sql, res) {
    const auth = mysqlAuth(server, res);
    if (auth === null) return null;
    if (auth) return `mysql ${auth} --default-character-set=utf8mb4 -N -e "${bashEscape(sql)}"`;
    return `sudo mysql --default-character-set=utf8mb4 -N -e "${bashEscape(sql)}"`;
  }

  function mysqldumpCmd(server, db, res) {
    const auth = mysqlAuth(server, res);
    if (auth === null) return null;
    if (auth) return `mysqldump ${auth} --single-transaction ${db}`;
    return `sudo mysqldump --single-transaction ${db}`;
  }

  // mysql -B batch 输出（带表头 tab 分隔），用于面板查询
  function mysqlBatchCmd(server, sql, res) {
    const auth = mysqlAuth(server, res);
    if (auth === null) return null;
    // 指定 utf8mb4，否则含中文的 SQL（注释、数据）经 SSH 写入会因客户端字符集不对而乱码
    if (auth) return `mysql ${auth} --default-character-set=utf8mb4 -B -e "${bashEscape(sql)}"`;
    return `sudo mysql --default-character-set=utf8mb4 -B -e "${bashEscape(sql)}"`;
  }

  // SQL 安全检查：只读放行；写操作需 confirm；无 WHERE 的全表 DELETE/UPDATE 直接拒绝
  function sqlSafety(sql) {
    const s = sql.trim().toLowerCase();
    if (!s) return { allowed: false, message: 'SQL 不能为空' };
    if (s.length > 10240) return { allowed: false, message: 'SQL 过长（最大 10KB）' };
    const isRead = /^(select|show|describe|desc|explain)\b/.test(s);
    const isWrite = /^(insert|update|delete|create|alter|drop|truncate|rename|grant|revoke|flush)\b/.test(s);
    if (!isRead && !isWrite) return { allowed: false, message: '不支持的 SQL 语句类型' };
    if (isWrite && /^(delete|update)\b/.test(s) && !/\bwhere\b/.test(s)) {
      return { allowed: false, message: '禁止无 WHERE 条件的全表 DELETE/UPDATE' };
    }
    if (isWrite) return { allowed: true, needConfirm: true };
    return { allowed: true, needConfirm: false };
  }

  router.get('/servers/:id/databases', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cmd = mysqlCmd(server, 'SHOW DATABASES', res);
    if (cmd === null) return;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const result = await pool.run(cfg, cmd);
      if (result.code !== 0) {
        // mysql 客户端不可用（未安装等）→ 结构化状态而非报错
        return res.json({
          code: 0,
          data: { available: false, message: result.stderr.trim() || 'MySQL 未安装或未运行' },
        });
      }
      res.json({ code: 0, data: { available: true, databases: parseDatabases(result.stdout) } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取数据库列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/databases', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { name, username, password } = req.body || {};
    if (!name || !DB_NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '数据库名不合法（字母/数字/下划线，1-64 位）' });
    if (username && !USER_NAME_RE.test(username)) return res.status(400).json({ code: 400, message: '用户名不合法' });
    if (!username || !password) return res.status(400).json({ code: 400, message: '请提供用户名和密码' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    const cmds = [
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      `CREATE USER IF NOT EXISTS '${username}'@'localhost' IDENTIFIED BY '${password.replace(/'/g, "'\\''")}'`,
      `GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'localhost'`,
      'FLUSH PRIVILEGES',
    ];
    try {
      for (const sql of cmds) {
        const cmd = mysqlCmd(server, sql, res);
        if (cmd === null) return;
        const result = await pool.run(cfg, cmd);
        if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      }
      audit(config.dataDir, { action: 'database.create', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { name, username } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `创建数据库失败: ${err.message}` });
    }
  });

  router.delete('/servers/:id/databases/:name', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const name = req.params.name;
    if (!DB_NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '数据库名不合法' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const backupDir = '/tmp/linuxmgr-db-backup';
      const dump = mysqldumpCmd(server, name, res);
      if (dump === null) return;
      const backupCmd = `mkdir -p ${backupDir} && ${dump} > ${backupDir}/${name}-$(date +%Y%m%d%H%M%S).sql`;
      const backup = await pool.run(cfg, backupCmd);
      if (backup.code !== 0) throw new Error(`备份失败: ${backup.stderr.slice(0, 200)}`);
      const cmd = mysqlCmd(server, `DROP DATABASE \`${name}\``, res);
      const drop = await pool.run(cfg, cmd);
      if (drop.code !== 0) throw new Error(drop.stderr.slice(0, 200));
      audit(config.dataDir, { action: 'database.drop', target: server.host, detail: name, result: 'success' });
      res.json({ code: 0, data: { dropped: name } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `删除数据库失败: ${err.message}` });
    }
  });

  // 修改库名：MySQL 无 RENAME DATABASE，实现为 建新库 → RENAME TABLE 逐表迁移 → 删旧库
  router.post('/servers/:id/databases/:name/rename', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const oldName = req.params.name;
    const newName = String(req.body?.newName || '');
    if (!DB_NAME_RE.test(oldName)) return res.status(400).json({ code: 400, message: '数据库名不合法' });
    if (!DB_NAME_RE.test(newName)) return res.status(400).json({ code: 400, message: '新数据库名不合法（字母/数字/下划线，1-64 位）' });
    if (oldName === newName) return res.status(400).json({ code: 400, message: '新名称与原名称相同' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      // 列旧库的表
      const listCmd = mysqlBatchCmd(server, `SHOW TABLES FROM \`${oldName}\``, res);
      if (listCmd === null) return;
      const listR = await pool.run(cfg, listCmd);
      if (listR.code !== 0) throw new Error(listR.stderr.slice(0, 200) || `退出码 ${listR.code}`);
      const tables = parseBatchResult(listR.stdout).rows.map((row) => row[0]);
      // 建新库
      const createSql = `CREATE DATABASE \`${newName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
      const createCmd = mysqlCmd(server, createSql, res);
      if (createCmd === null) return;
      const createR = await pool.run(cfg, createCmd);
      if (createR.code !== 0) throw new Error(`创建新库失败: ${createR.stderr.slice(0, 200)}`);
      // 逐表迁移（一条 RENAME TABLE 多对）
      if (tables.length > 0) {
        const pairs = tables.map((t) => `\`${oldName}\`.\`${t}\` TO \`${newName}\`.\`${t}\``).join(', ');
        const renameCmd = mysqlCmd(server, `RENAME TABLE ${pairs}`, res);
        if (renameCmd === null) return;
        const renameR = await pool.run(cfg, renameCmd, { timeoutMs: 120000 });
        if (renameR.code !== 0) throw new Error(`迁移表失败: ${renameR.stderr.slice(0, 200)}`);
      }
      // 删旧库
      const dropCmd = mysqlCmd(server, `DROP DATABASE \`${oldName}\``, res);
      if (dropCmd === null) return;
      const dropR = await pool.run(cfg, dropCmd);
      if (dropR.code !== 0) throw new Error(`删除旧库失败: ${dropR.stderr.slice(0, 200)}`);
      audit(config.dataDir, { action: 'database.rename', target: server.host, detail: `${oldName} -> ${newName}（${tables.length} 张表）`, result: 'success' });
      res.json({ code: 0, data: { renamed: newName, tables: tables.length } });
    } catch (err) {
      audit(config.dataDir, { action: 'database.rename', target: server.host, detail: `${oldName} -> ${newName}`, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `修改库名失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/redis', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const result = await pool.run(cfg, `redis-cli ${authPart} INFO`);
      if (result.code !== 0) {
        // redis-cli 不可用（未安装等）→ 结构化状态而非报错
        return res.json({
          code: 0,
          data: { available: false, message: result.stderr.trim() || 'Redis 未安装或未运行' },
        });
      }
      res.json({ code: 0, data: { available: true, ...parseRedisInfo(result.stdout) } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取 Redis 状态失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/redis/keys', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const result = await pool.run(cfg, `redis-cli ${authPart} --scan --count 100`);
      if (result.code !== 0) {
        return res.json({
          code: 0,
          data: { available: false, message: result.stderr.trim() || 'Redis 未安装或未运行' },
        });
      }
      const keys = result.stdout.split('\n').map((k) => k.trim()).filter(Boolean);
      res.json({ code: 0, data: { available: true, keys } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取 Redis 键列表失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/redis/flush', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const pwd = passwordOf(server, 'redisPasswordEnc', res);
    if (pwd === undefined) return;
    const authPart = pwd ? `-a '${pwd.replace(/'/g, "'\\''")}'` : '';
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const result = await pool.run(cfg, `redis-cli ${authPart} FLUSHDB`);
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 200) || `退出码 ${result.code}`);
      audit(config.dataDir, { action: 'redis.flush', target: server.host, result: 'success' });
      res.json({ code: 0, data: { flushed: true } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `清空 Redis 失败: ${err.message}` });
    }
  });

  // ===== MySQL 多版本管理 =====
  const MYSQL_AVAILABLE = [
    { version: '5.7', pkg: 'mysql57-community-server', rpm: 'https://repo.mysql.com/mysql57-community-release-el7-11.noarch.rpm' },
    { version: '8.0', pkg: 'mysql-community-server', rpm: 'https://repo.mysql.com/mysql80-community-release-el7-7.noarch.rpm' },
    { version: 'mariadb', pkg: 'mariadb-server', rpm: null },
  ];
  const SERVICE_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  const LIST_SERVICES_CMD = 'systemctl list-units --type=service --all 2>/dev/null | grep -Ei "mysql|mariadb"';

  function parseServices(output) {
    return output.split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { service: parts[0].replace('.service', ''), loaded: parts[1] || '', active: parts[2] || '', state: parts[3] || '' };
      });
  }

  router.get('/servers/:id/mysql/versions', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const [svc, cli] = await Promise.all([
        pool.run(cfg, LIST_SERVICES_CMD),
        pool.run(cfg, 'mysql --version'),
      ]);
      const instances = parseServices(svc.stdout || '');
      const cliVersion = cli.code === 0 ? cli.stdout.trim().split('\n')[0] : '';
      if (instances.length > 0 && cliVersion && instances.length === 1) {
        instances[0].version = cliVersion;
      }
      res.json({ code: 0, data: { instances, available: MYSQL_AVAILABLE, client: cliVersion } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取 MySQL 版本信息失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/mysql/install', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const version = String(req.body?.version || '');
    const target = MYSQL_AVAILABLE.find((v) => v.version === version);
    if (!target) return res.status(400).json({ code: 400, message: `版本必须为 ${MYSQL_AVAILABLE.map((v) => v.version).join('/')}` });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      // 多实例并存自动配置风险高：已有实例时拒绝自动安装（8.1 约束）
      const svc = await pool.run(cfg, LIST_SERVICES_CMD);
      if (parseServices(svc.stdout || '').length > 0) {
        return res.status(400).json({ code: 400, message: '服务器已存在 MySQL 实例，自动安装多实例可能影响现有服务；请在人工确认后手动安装' });
      }
      const cmds = [];
      if (target.rpm) cmds.push(`rpm -Uvh ${target.rpm}`);
      cmds.push(`yum install -y ${target.pkg}`);
      cmds.push('systemctl enable --now mysqld');
      for (const cmd of cmds) {
        const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'mysql.install', target: server.host, detail: version, result: 'success' });
      res.json({ code: 0, data: { installed: version, service: 'mysqld' } });
    } catch (err) {
      audit(config.dataDir, { action: 'mysql.install', target: server.host, detail: version, result: 'fail', detail2: err.message });
      if (res.headersSent) return;
      res.status(502).json({ code: 502, message: `安装失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/mysql/switch', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const service = String(req.body?.service || '');
    if (!SERVICE_RE.test(service)) return res.status(400).json({ code: 400, message: '服务名不合法' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const svc = await pool.run(cfg, LIST_SERVICES_CMD);
      const instances = parseServices(svc.stdout || '');
      if (instances.length === 0) return res.status(400).json({ code: 400, message: '未发现 MySQL 实例' });
      if (!instances.some((i) => i.service === service)) {
        return res.status(400).json({ code: 400, message: `未找到服务 ${service}` });
      }
      for (const inst of instances) {
        if (inst.service !== service) {
          const r = await pool.run(cfg, `systemctl stop ${inst.service}`);
          if (r.code !== 0) throw new Error(`停止 ${inst.service} 失败: ${r.stderr.slice(0, 200)}`);
        }
      }
      const start = await pool.run(cfg, `systemctl start ${service}`);
      if (start.code !== 0) throw new Error(start.stderr.slice(0, 200) || `退出码 ${start.code}`);
      audit(config.dataDir, { action: 'mysql.switch', target: server.host, detail: service, result: 'success' });
      res.json({ code: 0, data: { defaultService: service } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `切换失败: ${err.message}` });
    }
  });

  // ===== MySQL root 密码管理 =====

  // 查看当前保存的 root 密码（未配置时 password 为 null，表示走 sudo/auth_socket）
  router.get('/servers/:id/mysql/root-password', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!server.mysqlPasswordEnc) return res.json({ code: 0, data: { configured: false, password: null } });
    const pwd = passwordOf(server, 'mysqlPasswordEnc', res);
    if (pwd === undefined) return;
    res.json({ code: 0, data: { configured: true, password: pwd } });
  });

  // 重置 root 密码：ALTER USER → 成功后更新面板保存的凭据
  router.post('/servers/:id/mysql/root-password/reset', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 64) {
      return res.status(400).json({ code: 400, message: '密码长度需在 8-64 位之间' });
    }
    if (/['"\\]/.test(newPassword)) return res.status(400).json({ code: 400, message: '密码不能包含引号或反斜杠' });
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    const sql = `ALTER USER 'root'@'localhost' IDENTIFIED BY '${newPassword}'; FLUSH PRIVILEGES`;
    const cmd = mysqlCmd(server, sql, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      // 更新面板保存的凭据，保证后续操作使用新密码
      const list = store.read();
      const target = list.find((s) => s.id === server.id);
      if (target) {
        target.mysqlPasswordEnc = encrypt(newPassword, config.masterKey);
        store.write(list);
      }
      audit(config.dataDir, { action: 'mysql.root-password.reset', target: server.host, result: 'success' });
      res.json({ code: 0, data: { reset: true } });
    } catch (err) {
      audit(config.dataDir, { action: 'mysql.root-password.reset', target: server.host, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `重置 root 密码失败: ${err.message}` });
    }
  });

  // ===== 数据库面板=====

  function validateDbAndTable(db, table, res) {
    if (!db || !DB_NAME_RE.test(db)) {
      res.status(400).json({ code: 400, message: '数据库名不合法' });
      return false;
    }
    if (table && !TABLE_RE.test(table)) {
      res.status(400).json({ code: 400, message: '表名不合法' });
      return false;
    }
    return true;
  }

  router.get('/servers/:id/databases/:db/tables', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, null, res)) return;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    // 走 information_schema 同时取表备注
    const sql = `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='${sqlEscape(req.params.db)}' ORDER BY TABLE_NAME`;
    const cmd = mysqlBatchCmd(server, sql, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      const result = parseBatchResult(r.stdout);
      res.json({ code: 0, data: result.rows.map((row) => ({ name: row[0], comment: row[1] || '' })) });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取表列表失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/databases/:db/tables/:table/structure', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    // SHOW FULL COLUMNS 比 DESCRIBE 多出 Collation/Privileges/Comment，前端按需展示（含字段注释）
    const cmd = mysqlBatchCmd(server, `SHOW FULL COLUMNS FROM \`${req.params.db}\`.\`${req.params.table}\``, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      res.json({ code: 0, data: parseBatchResult(r.stdout) });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取表结构失败: ${err.message}` });
    }
  });

  router.get('/servers/:id/databases/:db/tables/:table/rows', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const offset = (page - 1) * limit;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    try {
      const [countR, rowsR] = await Promise.all([
        pool.run(cfg, mysqlCmd(server, `SELECT COUNT(*) FROM \`${req.params.db}\`.\`${req.params.table}\``, res)),
        pool.run(cfg, mysqlBatchCmd(server, `SELECT * FROM \`${req.params.db}\`.\`${req.params.table}\` LIMIT ${limit} OFFSET ${offset}`, res)),
      ]);
      if (countR.code !== 0) throw new Error(countR.stderr.slice(0, 200) || `退出码 ${countR.code}`);
      if (rowsR.code !== 0) throw new Error(rowsR.stderr.slice(0, 200) || `退出码 ${rowsR.code}`);
      const total = parseInt(countR.stdout.trim(), 10) || 0;
      res.json({ code: 0, data: { ...parseBatchResult(rowsR.stdout), total, page, limit } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `获取数据失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/sql', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { db, sql } = req.body || {};
    if (!db || !DB_NAME_RE.test(db)) return res.status(400).json({ code: 400, message: '数据库名不合法' });
    const safety = sqlSafety(sql || '');
    if (!safety.allowed) return res.status(400).json({ code: 400, message: safety.message });
    if (safety.needConfirm && req.body?.confirm !== true) {
      return res.status(400).json({ code: 400, message: '写操作需确认（confirm: true）' });
    }
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    const cmd = mysqlBatchCmd(server, `USE \`${db}\`; ${sql}`, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd, { timeoutMs: 60000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      if (safety.needConfirm) {
        audit(config.dataDir, { action: 'sql.exec', target: server.host, detail: `${db}: ${sql.slice(0, 120)}`, result: 'success' });
      }
      res.json({ code: 0, data: parseBatchResult(r.stdout) });
    } catch (err) {
      res.status(502).json({ code: 502, message: `SQL 执行失败: ${err.message}` });
    }
  });

  // ===== 表/字段/行管理（Navicat 风格基础操作）=====

  // SQL 字符串字面量转义（MySQL 默认模式下 \ 与 ' 都需转义）
  function sqlEscape(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
  }

  // 值 → SQL 字面量：null/undefined → NULL，其余按字符串引用（MySQL 隐式类型转换）
  function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${sqlEscape(v)}'`;
  }

  const COLUMN_TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'varchar', 'char', 'text', 'mediumtext', 'longtext', 'datetime', 'date', 'time', 'timestamp', 'decimal', 'float', 'double', 'json'];
  const NUMERIC_TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'float', 'double'];
  const LENGTHLESS_TYPES = ['text', 'mediumtext', 'longtext', 'datetime', 'date', 'time', 'timestamp', 'json'];
  const ENGINES = ['InnoDB', 'MyISAM'];
  const CHARSETS = ['utf8mb4', 'utf8', 'latin1', 'gbk'];

  // 校验并拼出列定义；非法输入返回 { error }
  function buildColumnDef(col) {
    if (!col || !TABLE_RE.test(col.name || '')) return { error: `字段名不合法: ${col && col.name}` };
    const type = String(col.type || '').toLowerCase();
    if (!COLUMN_TYPES.includes(type)) return { error: `不支持的字段类型: ${col.type}` };
    let def = `\`${col.name}\` ${type}`;
    if (!LENGTHLESS_TYPES.includes(type)) {
      if (col.length !== undefined && col.length !== null && String(col.length) !== '') {
        const len = String(col.length);
        if (!/^\d{1,5}(,\d{1,2})?$/.test(len)) return { error: `长度不合法: ${len}` };
        if (type === 'decimal' ? /,/.test(len) || /^\d+$/.test(len) : /^\d+$/.test(len)) {
          def += `(${len})`;
        } else {
          return { error: `长度不合法: ${len}` };
        }
      } else if (type === 'varchar' || type === 'char') {
        return { error: `${type} 必须指定长度` };
      }
    }
    def += col.nullable ? ' NULL' : ' NOT NULL';
    if (col.autoIncrement) def += ' AUTO_INCREMENT';
    if (col.defaultValue !== undefined && col.defaultValue !== null && String(col.defaultValue) !== '') {
      const dv = String(col.defaultValue);
      if (NUMERIC_TYPES.includes(type) && /^-?\d+(\.\d+)?$/.test(dv)) {
        def += ` DEFAULT ${dv}`;
      } else if (/^(current_timestamp|null)$/i.test(dv) && ['timestamp', 'datetime'].includes(type)) {
        def += ` DEFAULT ${dv.toUpperCase()}`;
      } else {
        def += ` DEFAULT '${sqlEscape(dv)}'`;
      }
    }
    if (col.comment) def += ` COMMENT '${sqlEscape(col.comment)}'`;
    return { def, name: col.name };
  }

  // 拼 WHERE：使用 <=> 空值安全比较；条件为空返回 null（调用方拒绝）
  function buildWhere(where) {
    const keys = Object.keys(where || {});
    if (keys.length === 0) return null;
    for (const k of keys) {
      if (!TABLE_RE.test(k)) return null;
    }
    return keys.map((k) => `\`${k}\` <=> ${sqlLiteral(where[k])}`).join(' AND ');
  }

  // 校验 SET 子句的键，返回 "k=v, ..."；非法返回 null
  function buildSet(data) {
    const keys = Object.keys(data || {});
    if (keys.length === 0) return null;
    for (const k of keys) {
      if (!TABLE_RE.test(k)) return null;
    }
    return keys.map((k) => `\`${k}\` = ${sqlLiteral(data[k])}`).join(', ');
  }

  // 执行单条写 SQL：构造命令、执行、审计、响应；失败时返回 false 并已响应
  async function execWriteSql(server, cfg, sql, res, auditAction, auditDetail) {
    const cmd = mysqlCmd(server, sql, res);
    if (cmd === null) return false;
    const r = await pool.run(cfg, cmd, { timeoutMs: 60000 });
    if (r.code !== 0) {
      res.status(502).json({ code: 502, message: r.stderr.slice(0, 300) || `退出码 ${r.code}` });
      return false;
    }
    audit(config.dataDir, { action: auditAction, target: server.host, detail: auditDetail, result: 'success' });
    return true;
  }

  // 创建表
  router.post('/servers/:id/databases/:db/tables', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const { table, columns, engine = 'InnoDB', charset = 'utf8mb4', comment } = req.body || {};
    if (!validateDbAndTable(req.params.db, table, res)) return;
    if (!Array.isArray(columns) || columns.length === 0) return res.status(400).json({ code: 400, message: '至少需要一个字段' });
    if (columns.length > 100) return res.status(400).json({ code: 400, message: '字段数量过多' });
    if (!ENGINES.includes(engine)) return res.status(400).json({ code: 400, message: '存储引擎仅支持 InnoDB/MyISAM' });
    if (!CHARSETS.includes(charset)) return res.status(400).json({ code: 400, message: '字符集不支持' });
    const defs = [];
    const names = new Set();
    for (const col of columns) {
      const r = buildColumnDef(col);
      if (r.error) return res.status(400).json({ code: 400, message: r.error });
      if (names.has(r.name)) return res.status(400).json({ code: 400, message: `字段名重复: ${r.name}` });
      names.add(r.name);
      defs.push(r.def);
    }
    const pk = columns.filter((c) => c.primary).map((c) => `\`${c.name}\``);
    if (pk.length > 0) defs.push(`PRIMARY KEY (${pk.join(', ')})`);
    let sql = `CREATE TABLE \`${req.params.db}\`.\`${table}\` (${defs.join(', ')}) ENGINE=${engine} DEFAULT CHARSET=${charset}`;
    if (comment) sql += ` COMMENT='${sqlEscape(comment)}'`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'table.create', `${req.params.db}.${table}`)) {
      res.json({ code: 0, data: { table } });
    }
  });

  // 删除表
  router.delete('/servers/:id/databases/:db/tables/:table', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    const sql = `DROP TABLE \`${req.params.db}\`.\`${req.params.table}\``;
    if (await execWriteSql(server, cfg, sql, res, 'table.drop', `${req.params.db}.${req.params.table}`)) {
      res.json({ code: 0, data: { dropped: req.params.table } });
    }
  });

  // 修改表名
  router.post('/servers/:id/databases/:db/tables/:table/rename', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const newName = String(req.body?.newName || '');
    if (!TABLE_RE.test(newName)) return res.status(400).json({ code: 400, message: '新表名不合法（字母/数字/下划线/$，1-64 位）' });
    if (req.params.table === newName) return res.status(400).json({ code: 400, message: '新名称与原名称相同' });
    const sql = `RENAME TABLE \`${req.params.db}\`.\`${req.params.table}\` TO \`${req.params.db}\`.\`${newName}\``;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'table.rename', `${req.params.db}.${req.params.table} -> ${newName}`)) {
      res.json({ code: 0, data: { renamed: newName } });
    }
  });

  // 读取表备注（information_schema）
  router.get('/servers/:id/databases/:db/tables/:table/comment', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    const sql = `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='${sqlEscape(req.params.db)}' AND TABLE_NAME='${sqlEscape(req.params.table)}'`;
    const cmd = mysqlCmd(server, sql, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      res.json({ code: 0, data: { comment: r.stdout.trim() } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `读取表备注失败: ${err.message}` });
    }
  });

  // 修改表备注
  router.put('/servers/:id/databases/:db/tables/:table/comment', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const comment = String(req.body?.comment ?? '');
    if (comment.length > 2048) return res.status(400).json({ code: 400, message: '备注过长' });
    const sql = `ALTER TABLE \`${req.params.db}\`.\`${req.params.table}\` COMMENT='${sqlEscape(comment)}'`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'table.comment', `${req.params.db}.${req.params.table}`)) {
      res.json({ code: 0, data: { comment } });
    }
  });

  // 添加字段
  router.post('/servers/:id/databases/:db/tables/:table/columns', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const { column, after } = req.body || {};
    const r = buildColumnDef(column);
    if (r.error) return res.status(400).json({ code: 400, message: r.error });
    let sql = `ALTER TABLE \`${req.params.db}\`.\`${req.params.table}\` ADD COLUMN ${r.def}`;
    if (after) {
      if (!TABLE_RE.test(after)) return res.status(400).json({ code: 400, message: 'after 字段名不合法' });
      sql += ` AFTER \`${after}\``;
    }
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'column.add', `${req.params.db}.${req.params.table}.${r.name}`)) {
      res.json({ code: 0, data: { column: r.name } });
    }
  });

  // 修改字段（可改名）
  router.put('/servers/:id/databases/:db/tables/:table/columns/:col', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    if (!TABLE_RE.test(req.params.col)) return res.status(400).json({ code: 400, message: '字段名不合法' });
    const r = buildColumnDef(req.body?.column);
    if (r.error) return res.status(400).json({ code: 400, message: r.error });
    const sql = `ALTER TABLE \`${req.params.db}\`.\`${req.params.table}\` CHANGE COLUMN \`${req.params.col}\` ${r.def}`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'column.modify', `${req.params.db}.${req.params.table}.${req.params.col} -> ${r.name}`)) {
      res.json({ code: 0, data: { column: r.name } });
    }
  });

  // 删除字段
  router.delete('/servers/:id/databases/:db/tables/:table/columns/:col', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    if (!TABLE_RE.test(req.params.col)) return res.status(400).json({ code: 400, message: '字段名不合法' });
    const sql = `ALTER TABLE \`${req.params.db}\`.\`${req.params.table}\` DROP COLUMN \`${req.params.col}\``;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'column.drop', `${req.params.db}.${req.params.table}.${req.params.col}`)) {
      res.json({ code: 0, data: { dropped: req.params.col } });
    }
  });

  // 插入行
  router.post('/servers/:id/databases/:db/tables/:table/rows', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const data = req.body?.data || {};
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ code: 400, message: '请提供至少一个字段值' });
    for (const k of keys) {
      if (!TABLE_RE.test(k)) return res.status(400).json({ code: 400, message: `字段名不合法: ${k}` });
    }
    const sql = `INSERT INTO \`${req.params.db}\`.\`${req.params.table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map((k) => sqlLiteral(data[k])).join(', ')})`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'row.insert', `${req.params.db}.${req.params.table}`)) {
      res.json({ code: 0, data: { inserted: true } });
    }
  });

  // 更新行：where 传原行全部列值（<=> 空值安全比较）
  router.put('/servers/:id/databases/:db/tables/:table/rows', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const where = buildWhere(req.body?.where);
    if (where === null) return res.status(400).json({ code: 400, message: 'where 条件不能为空且字段名必须合法' });
    const set = buildSet(req.body?.data);
    if (set === null) return res.status(400).json({ code: 400, message: '请提供至少一个要修改的字段' });
    const sql = `UPDATE \`${req.params.db}\`.\`${req.params.table}\` SET ${set} WHERE ${where}`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'row.update', `${req.params.db}.${req.params.table}`)) {
      res.json({ code: 0, data: { updated: true } });
    }
  });

  // 删除行
  router.delete('/servers/:id/databases/:db/tables/:table/rows', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    if (!validateDbAndTable(req.params.db, req.params.table, res)) return;
    const where = buildWhere(req.body?.where);
    if (where === null) return res.status(400).json({ code: 400, message: 'where 条件不能为空且字段名必须合法' });
    const sql = `DELETE FROM \`${req.params.db}\`.\`${req.params.table}\` WHERE ${where}`;
    const cfg = sshCfgOf(server, res);
    if (cfg === null) return;
    if (await execWriteSql(server, cfg, sql, res, 'row.delete', `${req.params.db}.${req.params.table}`)) {
      res.json({ code: 0, data: { deleted: true } });
    }
  });

  return router;
}

module.exports = createDatabaseRouter;
