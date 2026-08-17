// 交互式 Web 终端：WebSocket + ssh2 shell（独立连接，不占用连接池）
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');
const { verifyToken } = require('../auth/jwt');
const { decrypt } = require('../crypto/cipher');
const { audit } = require('../utils/audit');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WS_PATH = '/api/terminal/ws';

function setupTerminal({ config, store, httpServer }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token');
    const serverId = url.searchParams.get('serverId');
    try {
      verifyToken(token || '', config.jwtSecret);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { serverId });
    });
  });

  wss.on('connection', (ws, req, { serverId }) => {
    const server = store.read().find((s) => s.id === serverId);
    if (!server) {
      ws.close(4004, 'server not found');
      return;
    }
    let password;
    try {
      password = decrypt(server.passwordEnc, config.masterKey);
    } catch {
      ws.close(4005, 'decrypt failed');
      return;
    }

    const client = new Client();
    const streamRef = { current: null };
    const idleTimer = setTimeout(() => {
      try { ws.close(4006, 'idle timeout'); } catch { /* noop */ }
    }, IDLE_TIMEOUT_MS);

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          try { ws.close(4007, err.message); } catch { /* noop */ }
          return;
        }
        streamRef.current = stream;
        stream.on('data', (d) => {
          if (ws.readyState === ws.OPEN) ws.send(d.toString());
        });
        stream.on('close', () => {
          try { ws.close(); } catch { /* noop */ }
        });
        stream.on('error', () => {
          try { ws.close(); } catch { /* noop */ }
        });
        audit(config.dataDir, { action: 'terminal.connect', target: server.host, result: 'success' });
        ws.send(`\r\n\x1b[32m[云小U] 已连接 ${server.host}\x1b[0m\r\n`);
      });
    });
    client.on('error', (err) => {
      try { ws.close(4008, err.message.slice(0, 100)); } catch { /* noop */ }
    });
    client.on('close', () => {
      try { ws.close(); } catch { /* noop */ }
    });
    client.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
    });

    ws.on('message', (data) => {
      const msg = data.toString();
      if (msg.startsWith('{')) {
        try {
          const obj = JSON.parse(msg);
          if (obj.resize && streamRef.current && typeof streamRef.current.setWindow === 'function') {
            streamRef.current.setWindow(obj.resize.rows, obj.resize.cols);
          }
          return;
        } catch { /* 非 JSON 按输入处理 */ }
      }
      if (streamRef.current) streamRef.current.write(msg);
    });

    ws.on('close', () => {
      clearTimeout(idleTimer);
      if (streamRef.current) {
        try { streamRef.current.end(); } catch { /* noop */ }
      }
      try { client.end(); } catch { /* noop */ }
    });
  });

  return wss;
}

module.exports = { setupTerminal };
