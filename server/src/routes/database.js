const express = require('express');
const { decrypt } = require('../crypto/cipher');
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
    if (auth) return `mysql ${auth} -N -e "${bashEscape(sql)}"`;
    return `sudo mysql -N -e "${bashEscape(sql)}"`;
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
    if (auth) return `mysql ${auth} -B -e "${bashEscape(sql)}"`;
    return `sudo mysql -B -e "${bashEscape(sql)}"`;
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
        return res.status(400).json({ code: 400, message: '服务器已存在 MySQL/MariaDB 实例，自动安装多实例可能影响现有服务；请在人工确认后手动安装' });
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
      if (instances.length === 0) return res.status(400).json({ code: 400, message: '未发现 MySQL/MariaDB 实例' });
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

  // ===== 数据库面板（phpMyAdmin 风格）=====

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
    const cmd = mysqlBatchCmd(server, `SHOW TABLES FROM \`${req.params.db}\``, res);
    if (cmd === null) return;
    try {
      const r = await pool.run(cfg, cmd);
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      const result = parseBatchResult(r.stdout);
      res.json({ code: 0, data: result.rows.map((row) => row[0]) });
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
    const cmd = mysqlBatchCmd(server, `DESCRIBE \`${req.params.db}\`.\`${req.params.table}\``, res);
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
    const cmd = mysqlBatchCmd(server, sql, res);
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

  return router;
}

module.exports = createDatabaseRouter;
