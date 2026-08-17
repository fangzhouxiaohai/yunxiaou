const express = require('express');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

// 普通软件（apt/yum 直接安装）
const PLAIN_SOFTWARE = [
  { name: 'nginx', display: 'Nginx', desc: 'Web 服务器/反向代理', versionCmd: 'nginx -v 2>&1', pkg: { apt: 'nginx', yum: 'nginx' } },
  { name: 'mysql', display: 'MySQL/MariaDB', desc: '关系型数据库（多版本管理见数据库页）', versionCmd: 'mysql --version', pkg: { apt: 'mysql-server', yum: 'mysql-server' } },
  { name: 'redis', display: 'Redis', desc: '内存键值数据库', versionCmd: 'redis-server --version', pkg: { apt: 'redis-server', yum: 'redis' } },
  { name: 'docker', display: 'Docker', desc: '容器引擎', versionCmd: 'docker --version', pkg: { apt: 'docker.io', yum: 'docker-ce' } },
  { name: 'node', display: 'Node.js', desc: 'JavaScript 运行时', versionCmd: 'node -v', pkg: { apt: 'nodejs', yum: 'nodejs' } },
  { name: 'python3', display: 'Python 3', desc: '脚本语言运行时', versionCmd: 'python3 --version', pkg: { apt: 'python3', yum: 'python3' } },
  { name: 'git', display: 'Git', desc: '版本控制', versionCmd: 'git --version', pkg: { apt: 'git', yum: 'git' } },
  { name: 'fail2ban', display: 'Fail2ban', desc: '暴力破解防护', versionCmd: 'fail2ban-server --version 2>&1', pkg: { apt: 'fail2ban', yum: 'fail2ban' } },
];

// PHP 多版本（CentOS 走 remi 源，Debian 走 sury 源）
const PHP_VERSIONS = [
  { name: 'php74', display: 'PHP 7.4', versionCmd: 'php74 -v 2>&1', pkg: { apt: 'php7.4-fpm', yum: 'php74-php-fpm' }, fpm: 'php74-php-fpm', repo: 'remi-php74' },
  { name: 'php80', display: 'PHP 8.0', versionCmd: 'php80 -v 2>&1', pkg: { apt: 'php8.0-fpm', yum: 'php80-php-fpm' }, fpm: 'php80-php-fpm', repo: 'remi-php80' },
  { name: 'php81', display: 'PHP 8.1', versionCmd: 'php81 -v 2>&1', pkg: { apt: 'php8.1-fpm', yum: 'php81-php-fpm' }, fpm: 'php81-php-fpm', repo: 'remi-php81' },
  { name: 'php82', display: 'PHP 8.2', versionCmd: 'php82 -v 2>&1', pkg: { apt: 'php8.2-fpm', yum: 'php82-php-fpm' }, fpm: 'php82-php-fpm', repo: 'remi-php82' },
  { name: 'php83', display: 'PHP 8.3', versionCmd: 'php83 -v 2>&1', pkg: { apt: 'php8.3-fpm', yum: 'php83-php-fpm' }, fpm: 'php83-php-fpm', repo: 'remi-php83' },
];

const JAVA_VERSIONS = ['8', '11', '17'];
const JAVA_PKG = {
  8: { apt: 'openjdk-8-jdk', yum: 'java-1.8.0-openjdk' },
  11: { apt: 'openjdk-11-jdk', yum: 'java-11-openjdk' },
  17: { apt: 'openjdk-17-jdk', yum: 'java-17-openjdk' },
};

const SUPERVISOR = { name: 'supervisor', display: '进程守护', desc: 'Supervisor 常驻进程管理', versionCmd: 'supervisord -v 2>&1', pkg: { apt: 'supervisor', yum: 'supervisor' } };
const COMPOSER = { name: 'composer', display: 'Composer', desc: 'PHP 依赖管理器（需先安装 PHP）' };
const DISK = { name: 'disk', display: '磁盘管理', desc: '磁盘分区与挂载工具' };

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

function createStoreRouter({ config, pool, store }) {
  const router = express.Router();

  const findServer = (id) => store.read().find((s) => s.id === id);
  const sshCfg = (server, res) => {
    try {
      return {
        host: server.host, port: server.port, username: server.username,
        password: decrypt(server.passwordEnc, config.masterKey),
      };
    } catch {
      res.status(500).json({ code: 500, message: '凭据解密失败：MASTER_KEY 与保存时不一致' });
      return null;
    }
  };

  async function detectPkgManager(cfg) {
    const r = await pool.run(cfg, 'command -v apt-get >/dev/null 2>&1 && echo apt || echo yum');
    return r.stdout.trim() === 'apt' ? 'apt' : 'yum';
  }

  async function runOk(cfg, command) {
    const r = await pool.run(cfg, command);
    return r.code === 0 && r.stdout.trim() !== '';
  }

  function parseJavaVersion(output) {
    const m = output.match(/version "(\d+)(?:\.(\d+))?/);
    if (!m) return '';
    const major = parseInt(m[1], 10);
    if (major === 1) return `1.${m[2] || '0'}`;
    return String(major);
  }

  function parseAlternativesPaths(output) {
    return output.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  // 解析 php -v 输出版本号 → 对应条目名（如 8.1 → php81）
  function phpNameFromVersion(output) {
    const m = output.match(/^PHP (\d+)\.(\d+)/);
    if (!m) return '';
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (major === 7 && minor === 4) return 'php74';
    if (major === 8) return `php8${minor}`;
    return '';
  }

  // 设置默认 php 的命令（alternatives 切换 `php` 命令指向）
  function setDefaultPhpCmd(phpName, pkg) {
    if (pkg === 'apt') return `update-alternatives --set php /usr/bin/${phpName}`;
    return `alternatives --set php /usr/bin/${phpName}`;
  }

  router.get('/servers/:id/store', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      // 并行检测（连接池内部限流 maxConcurrent=4）
      const [plainResults, phpResults, supervisordOut, javaOut, altOut, phpDefaultOut] = await Promise.all([
        Promise.all(PLAIN_SOFTWARE.map(async (soft) => {
          const r = await pool.run(cfg, soft.versionCmd);
          const installed = r.code === 0 && r.stdout.trim() !== '';
          return {
            name: soft.name, display: soft.display, desc: soft.desc, type: 'plain',
            installed,
            version: installed ? r.stdout.trim().split('\n')[0] : '',
            package: soft.pkg[pkg],
          };
        })),
        Promise.all(PHP_VERSIONS.map(async (php) => {
          const r = await pool.run(cfg, php.versionCmd);
          const installed = r.code === 0 && r.stdout.trim() !== '';
          return {
            name: php.name, display: php.display, desc: `PHP-FPM（${php.repo}）`, type: 'php',
            installed,
            version: installed ? r.stdout.trim().split('\n')[0] : '',
            package: php.pkg[pkg],
            fpm: php.fpm,
          };
        })),
        pool.run(cfg, SUPERVISOR.versionCmd),
        pool.run(cfg, 'java -version 2>&1'),
        pool.run(cfg, 'alternatives --list java 2>&1'),
        pool.run(cfg, 'php -v 2>&1'),
      ]);

      // 当前默认 php 版本（PATH 中 `php` 命令指向）
      const defaultPhp = phpDefaultOut.code === 0 ? phpNameFromVersion(phpDefaultOut.stdout) : '';

      const supervisorInstalled = supervisordOut.code === 0 && supervisordOut.stdout.trim() !== '';
      const javaInstalled = javaOut.code === 0 && javaOut.stdout.trim() !== '';
      const altPaths = javaInstalled ? parseAlternativesPaths(altOut.stdout) : [];

      const javaItem = {
        name: 'java', display: 'Java 环境', desc: 'OpenJDK 8/11/17 安装与默认版本切换', type: 'java',
        installed: javaInstalled,
        version: javaInstalled ? javaOut.stdout.trim().split('\n')[0] : '',
        defaultVersion: javaInstalled ? parseJavaVersion(javaOut.stdout) : '',
        installedVersions: altPaths
          .map((p) => p.match(/java-(?:1\.)?(\d+)/))
          .filter(Boolean)
          .map((m) => m[1]),
        versions: JAVA_VERSIONS,
        package: '',
      };

      const items = [
        ...plainResults,
        ...phpResults.map((p) => ({ ...p, isDefault: p.installed && p.name === defaultPhp })),
        javaItem,
        {
          name: 'composer', display: 'Composer', desc: COMPOSER.desc, type: 'composer',
          installed: await runOk(cfg, 'composer --version'),
          version: '',
          package: '',
        },
        {
          name: 'supervisor', display: SUPERVISOR.display, desc: SUPERVISOR.desc, type: 'supervisor',
          installed: supervisorInstalled,
          version: supervisorInstalled ? supervisordOut.stdout.trim().split('\n')[0] : '',
          package: SUPERVISOR.pkg[pkg],
        },
        {
          name: 'disk', display: DISK.display, desc: DISK.desc, type: 'disk',
          installed: true, version: '', package: '',
        },
      ];
      res.json({ code: 0, data: items });
    } catch (err) {
      res.status(502).json({ code: 502, message: `软件状态检测失败: ${err.message}` });
    }
  });

  async function installPhp(cfg, php, pkg, res) {
    if (pkg === 'apt') {
      const steps = [
        'apt-get install -y lsb-release apt-transport-https ca-certificates wget',
        'wget -qO /etc/apt/trusted.gpg.d/php.gpg https://packages.sury.org/php/apt.gpg',
        `echo "deb https://packages.sury.org/php/ $(lsb_release -sc) main" > /etc/apt/sources.list.d/php.list`,
        `apt-get update && apt-get install -y ${php.pkg.apt}`,
        `systemctl enable --now ${php.fpm}`,
      ];
      for (const cmd of steps) {
        const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
    } else {
      const steps = [
        'rpm -q remi-release >/dev/null 2>&1 || yum install -y https://rpms.remirepo.net/enterprise/remi-release-7.rpm',
        `yum-config-manager --enable ${php.repo}`,
        `yum install -y ${php.pkg.yum}`,
        `systemctl enable --now ${php.fpm}`,
      ];
      for (const cmd of steps) {
        const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
    }
    // 若当前没有任何默认 php，则新安装的版本自动成为默认（PATH 中 `php` 指向）
    const check = await pool.run(cfg, 'command -v php >/dev/null 2>&1 && echo yes || echo no');
    if (check.stdout.trim() !== 'yes') {
      const setCmd = setDefaultPhpCmd(php.name, pkg);
      const r = await pool.run(cfg, setCmd);
      if (r.code !== 0) throw new Error(`设置默认 PHP 失败: ${r.stderr.slice(0, 200)}`);
    }
  }

  async function installComposer(cfg, res) {
    const phpCheck = await pool.run(cfg, 'command -v php');
    if (phpCheck.code !== 0) {
      res.status(400).json({ code: 400, message: '请先安装 PHP 再安装 Composer' });
      return false;
    }
    const steps = [
      'curl -sS -o /tmp/linuxmgr-composer-setup.php https://getcomposer.org/installer',
      'php /tmp/linuxmgr-composer-setup.php --install-dir=/usr/local/bin --filename=composer',
      'rm -f /tmp/linuxmgr-composer-setup.php',
    ];
    for (const cmd of steps) {
      const r = await pool.run(cfg, cmd, { timeoutMs: 300000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
    }
    return true;
  }

  async function installJava(cfg, version, pkg, res) {
    if (!JAVA_VERSIONS.includes(version)) {
      res.status(400).json({ code: 400, message: `Java 版本必须为 ${JAVA_VERSIONS.join('/')}` });
      return false;
    }
    const cmd = pkg === 'apt'
      ? `apt-get install -y ${JAVA_PKG[version].apt}`
      : `yum install -y ${JAVA_PKG[version].yum}`;
    const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
    if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
    return true;
  }

  async function switchJava(cfg, version, pkg, res) {
    const listCmd = pkg === 'apt' ? 'update-alternatives --list java' : 'alternatives --list java 2>&1';
    const list = await pool.run(cfg, listCmd);
    if (list.code !== 0) throw new Error('无法读取 Java alternatives 列表');
    const path = list.stdout.split('\n')
      .map((l) => l.trim())
      .find((p) => new RegExp(`java-(?:1\\.)?${version}(?:$|[.-])`).test(p));
    if (!path) {
      res.status(400).json({ code: 400, message: `未找到 Java ${version} 的安装路径，请先安装` });
      return false;
    }
    const setCmd = pkg === 'apt'
      ? `update-alternatives --set java '${path}'`
      : `alternatives --set java '${path}'`;
    const r = await pool.run(cfg, setCmd);
    if (r.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
    return true;
  }

  router.post('/servers/:id/store/:name/install', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '软件名不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);

      const php = PHP_VERSIONS.find((p) => p.name === name);
      if (php) {
        await installPhp(cfg, php, pkg, res);
        audit(config.dataDir, { action: 'store.install', target: server.host, detail: php.name, result: 'success' });
        return res.json({ code: 0, data: { installed: php.name, package: php.pkg[pkg] } });
      }
      if (name === 'composer') {
        const ok = await installComposer(cfg, res);
        if (!ok) return;
        audit(config.dataDir, { action: 'store.install', target: server.host, detail: 'composer', result: 'success' });
        return res.json({ code: 0, data: { installed: 'composer' } });
      }
      if (name === 'java') {
        const version = String(req.body?.version || '8');
        const ok = await installJava(cfg, version, pkg, res);
        if (!ok) return;
        audit(config.dataDir, { action: 'store.install', target: server.host, detail: `java-${version}`, result: 'success' });
        return res.json({ code: 0, data: { installed: `java-${version}` } });
      }
      if (name === 'disk') {
        return res.status(400).json({ code: 400, message: '磁盘工具无需安装' });
      }

      if (name === 'supervisor') {
        // CentOS/RHEL 7 的 supervisor 包在 EPEL 源：先确保 epel-release
        const steps = pkg === 'apt'
          ? [
              'apt-get install -y supervisor',
              'systemctl enable --now supervisor',
            ]
          : [
              'rpm -q epel-release >/dev/null 2>&1 || yum install -y epel-release',
              'yum install -y supervisor',
              'systemctl enable --now supervisord',
            ];
        for (const cmd of steps) {
          const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
          if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
        }
        audit(config.dataDir, { action: 'store.install', target: server.host, detail: 'supervisor', result: 'success' });
        return res.json({ code: 0, data: { installed: 'supervisor' } });
      }

      const soft = PLAIN_SOFTWARE.find((s) => s.name === name);
      if (!soft) return res.status(400).json({ code: 400, message: '未知软件' });
      const installCmd = pkg === 'apt'
        ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${soft.pkg.apt}`
        : `yum install -y ${soft.pkg.yum}`;
      const result = await pool.run(cfg, installCmd, { timeoutMs: 600000 });
      if (result.code !== 0) throw new Error(result.stderr.slice(0, 300) || `退出码 ${result.code}`);
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: soft.name, result: 'success' });
      res.json({ code: 0, data: { installed: soft.name, package: soft.pkg[pkg] } });
    } catch (err) {
      audit(config.dataDir, { action: 'store.install', target: server.host, detail: name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `安装失败: ${err.message}` });
    }
  });

  router.post('/servers/:id/store/java/switch', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const version = String(req.body?.version || '');
    if (!JAVA_VERSIONS.includes(version)) {
      return res.status(400).json({ code: 400, message: `Java 版本必须为 ${JAVA_VERSIONS.join('/')}` });
    }
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const ok = await switchJava(cfg, version, pkg, res);
      if (!ok) return;
      audit(config.dataDir, { action: 'store.java.switch', target: server.host, detail: `java-${version}`, result: 'success' });
      res.json({ code: 0, data: { defaultVersion: version } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `切换失败: ${err.message}` });
    }
  });

  // 设置指定 PHP 版本为默认（PATH 中 `php` 命令指向）
  router.post('/servers/:id/store/php/default', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    const phpName = String(req.body?.version || '');
    const php = PHP_VERSIONS.find((p) => p.name === phpName);
    if (!php) return res.status(400).json({ code: 400, message: '无效的 PHP 版本' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      const r = await pool.run(cfg, setDefaultPhpCmd(php.name, pkg));
      if (r.code !== 0) {
        // alternatives 未注册时尝试直接建立软链
        const ln = await pool.run(cfg, `ln -sf /usr/bin/${php.name} /usr/local/bin/php`);
        if (ln.code !== 0) throw new Error(r.stderr.slice(0, 200) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'store.php.default', target: server.host, detail: php.name, result: 'success' });
      res.json({ code: 0, data: { defaultPhp: php.name } });
    } catch (err) {
      res.status(502).json({ code: 502, message: `设置默认 PHP 失败: ${err.message}` });
    }
  });

  // 卸载软件（confirm 必需）
  router.post('/servers/:id/store/:name/uninstall', async (req, res) => {
    const server = findServer(req.params.id);
    if (!server) return res.status(404).json({ code: 404, message: '服务器不存在' });
    if (req.body?.confirm !== true) return res.status(400).json({ code: 400, message: '危险操作需确认（confirm: true）' });
    const name = req.params.name;
    if (!NAME_RE.test(name)) return res.status(400).json({ code: 400, message: '软件名不合法' });
    const cfg = sshCfg(server, res);
    if (!cfg) return;
    try {
      const pkg = await detectPkgManager(cfg);
      let cmds = [];
      let detail = name;

      const php = PHP_VERSIONS.find((p) => p.name === name);
      if (php) {
        cmds = [
          `systemctl disable --now ${php.fpm}`,
          pkg === 'apt' ? `apt-get remove -y ${php.pkg.apt}` : `yum remove -y ${php.pkg.yum}`,
        ];
      } else if (name === 'composer') {
        cmds = ['rm -f /usr/local/bin/composer'];
      } else if (name === 'java') {
        // 卸载当前默认版本
        const javaOut = await pool.run(cfg, 'java -version 2>&1');
        if (javaOut.code !== 0) return res.status(400).json({ code: 400, message: 'Java 未安装' });
        const ver = parseJavaVersion(javaOut.stdout);
        const verNum = ver.startsWith('1.') ? ver.slice(2) : ver;
        const pkgName = JAVA_PKG[verNum] ? JAVA_PKG[verNum][pkg] : '';
        if (!pkgName) return res.status(400).json({ code: 400, message: '无法确定默认 Java 版本的包名' });
        cmds = [pkg === 'apt' ? `apt-get remove -y ${pkgName}` : `yum remove -y ${pkgName}`];
        detail = `java-${verNum}`;
      } else if (name === 'supervisor') {
        cmds = [
          'systemctl disable --now supervisord',
          pkg === 'apt' ? 'apt-get remove -y supervisor' : 'yum remove -y supervisor',
        ];
      } else if (name === 'disk') {
        return res.status(400).json({ code: 400, message: '磁盘工具无需卸载' });
      } else {
        const soft = PLAIN_SOFTWARE.find((s) => s.name === name);
        if (!soft) return res.status(400).json({ code: 400, message: '未知软件' });
        cmds = [pkg === 'apt' ? `apt-get remove -y ${soft.pkg.apt}` : `yum remove -y ${soft.pkg.yum}`];
      }

      for (const cmd of cmds) {
        const r = await pool.run(cfg, cmd, { timeoutMs: 600000 });
        if (r.code !== 0) throw new Error(r.stderr.slice(0, 300) || `退出码 ${r.code}`);
      }
      audit(config.dataDir, { action: 'store.uninstall', target: server.host, detail, result: 'success' });
      res.json({ code: 0, data: { uninstalled: name } });
    } catch (err) {
      audit(config.dataDir, { action: 'store.uninstall', target: server.host, detail: name, result: 'fail', detail2: err.message });
      res.status(502).json({ code: 502, message: `卸载失败: ${err.message}` });
    }
  });

  return router;
}

module.exports = createStoreRouter;
