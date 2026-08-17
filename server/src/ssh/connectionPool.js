const { Client } = require('ssh2');
const { run } = require('./exec');

class ConnectionPool {
  constructor(opts = {}) {
    this.clientFactory = opts.clientFactory || (() => new Client());
    this.maxConcurrent = opts.maxConcurrent || 4;
    this.idleTimeoutMs = opts.idleTimeoutMs || 10 * 60 * 1000;
    this.reconnectAttempts = opts.reconnectAttempts || 2;
    this.connectTimeoutMs = opts.connectTimeoutMs || 15000;
    this.logger = opts.logger || console;
    this.entries = new Map(); // key -> entry
  }

  keyFor(cfg) {
    return `${cfg.host}:${cfg.port}:${cfg.username}`;
  }

  async getConnection(cfg) {
    const key = this.keyFor(cfg);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        cfg,
        client: null,
        ready: false,
        busy: 0,
        closing: false,
        connectAttempts: 0,
        idleTimer: null,
        waiters: [],
        lastUsed: 0,
      };
      this.entries.set(key, entry);
    }
    if (!entry.ready) await this.connect(entry);
    while (entry.busy >= this.maxConcurrent) {
      await new Promise((resolve) => entry.waiters.push(resolve));
    }
    entry.busy += 1;
    entry.lastUsed = Date.now();
    this.clearIdleTimer(entry);
    return entry;
  }

  async connect(entry) {
    if (entry.connectingPromise) return entry.connectingPromise;
    entry.connectingPromise = this.doConnect(entry).finally(() => {
      entry.connectingPromise = null;
    });
    return entry.connectingPromise;
  }

  async doConnect(entry) {
    while (entry.connectAttempts <= this.reconnectAttempts) {
      entry.connectAttempts += 1;
      try {
        const client = this.clientFactory();
        const ok = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), this.connectTimeoutMs);
          client.once('ready', () => { clearTimeout(timer); resolve(true); });
          client.once('error', () => { clearTimeout(timer); resolve(false); });
          client.connect({
            host: entry.cfg.host,
            port: entry.cfg.port,
            username: entry.cfg.username,
            password: entry.cfg.password,
            keepaliveInterval: 60000,
            readyTimeout: this.connectTimeoutMs,
          });
        });
        if (!ok) {
          try { client.destroy(); } catch { /* noop */ }
          continue;
        }
        entry.client = client;
        entry.ready = true;
        entry.connectAttempts = 0;
        client.on('close', () => this.onClose(entry));
        client.on('error', () => { /* 错误由 close 统一处理 */ });
        return;
      } catch (err) {
        this.logger.warn(`[pool] connect failed ${entry.key}: ${err.message}`);
      }
    }
    throw new Error(`SSH 连接失败（已重试 ${this.reconnectAttempts} 次）: ${entry.key}`);
  }

  onClose(entry) {
    entry.ready = false;
    entry.client = null;
    if (entry.closing) {
      entry.closing = false;
      return;
    }
    this.logger.warn(`[pool] connection closed: ${entry.key}`);
    if (entry.busy === 0) {
      this.connect(entry).catch((err) => {
        this.logger.warn(`[pool] reconnect failed: ${err.message}`);
      });
    }
  }

  release(entry) {
    entry.busy -= 1;
    entry.lastUsed = Date.now();
    const waiter = entry.waiters.shift();
    if (waiter) waiter();
    this.scheduleIdleReap(entry);
  }

  scheduleIdleReap(entry) {
    this.clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.busy === 0 && entry.ready && Date.now() - entry.lastUsed >= this.idleTimeoutMs) {
        this.logger.info(`[pool] idle reap: ${entry.key}`);
        entry.closing = true;
        try { entry.client.destroy(); } catch { /* noop */ }
      }
    }, this.idleTimeoutMs);
  }

  clearIdleTimer(entry) {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  async run(cfg, command, opts) {
    const entry = await this.getConnection(cfg);
    try {
      return await run(entry.client, command, opts);
    } finally {
      this.release(entry);
    }
  }

  // 通过 SFTP 上传本地文件到远端（复用池内连接）
  async sftpPut(cfg, localPath, remotePath) {
    const entry = await this.getConnection(cfg);
    try {
      await new Promise((resolve, reject) => {
        entry.client.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.fastPut(localPath, remotePath, (err2) => (err2 ? reject(err2) : resolve()));
        });
      });
    } finally {
      this.release(entry);
    }
  }

  closeKey(cfg) {
    const key = this.keyFor(cfg);
    const entry = this.entries.get(key);
    if (entry) {
      this.clearIdleTimer(entry);
      entry.closing = true;
      if (entry.client) {
        try { entry.client.destroy(); } catch { /* noop */ }
      }
      this.entries.delete(key);
    }
  }

  closeAll() {
    for (const entry of this.entries.values()) {
      this.clearIdleTimer(entry);
      entry.closing = true;
      if (entry.client) {
        try { entry.client.destroy(); } catch { /* noop */ }
      }
    }
    this.entries.clear();
  }
}

module.exports = { ConnectionPool };
