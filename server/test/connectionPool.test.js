const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionPool } = require('../src/ssh/connectionPool');
const { FakeClient } = require('./helpers/fakeClient');

const CFG = { host: '10.0.0.1', port: 22, username: 'root', password: 'p' };

function makePool(overrides = {}) {
  let instance = null;
  const pool = new ConnectionPool({
    clientFactory: () => {
      instance = new FakeClient();
      return instance;
    },
    connectTimeoutMs: 1000,
    reconnectAttempts: 1,
    ...overrides,
  });
  return { pool, getClient: () => instance };
}

test('getConnection 建立连接并复用同一客户端', async () => {
  const { pool, getClient } = makePool();
  const entry1 = await pool.getConnection(CFG);
  const client1 = getClient();
  assert.equal(entry1.ready, true);
  const entry2 = await pool.getConnection(CFG);
  assert.equal(getClient(), client1, '应复用同一连接');
  assert.equal(client1.connectCount, 1);
  pool.closeKey(CFG);
});

test('连接断开后自动重连', async () => {
  const { pool, getClient } = makePool();
  const entry = await pool.getConnection(CFG);
  const client1 = getClient();
  pool.release(entry); // busy 归零后断开才会触发后台重连
  client1.emit('close');
  await new Promise((r) => setTimeout(r, 30));
  const client2 = getClient();
  assert.notEqual(client2, client1, '重连后应使用新客户端');
  assert.equal(client2.connectCount, 1);
  assert.equal(entry.ready, true, '条目应恢复就绪');
  pool.closeKey(CFG);
});

test('并发超过 maxConcurrent 时排队', async () => {
  const { pool, getClient } = makePool({ maxConcurrent: 2 });
  const results = await Promise.all([
    pool.run(CFG, 'a'),
    pool.run(CFG, 'b'),
    pool.run(CFG, 'c'),
    pool.run(CFG, 'd'),
  ]);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.code === 0));
  assert.ok(getClient().maxInFlight <= 2, '同时执行的命令不应超过 2 条');
  pool.closeKey(CFG);
});

test('空闲超时后销毁连接', async () => {
  const { pool, getClient } = makePool({ idleTimeoutMs: 30 });
  const entry = await pool.getConnection(CFG);
  const client = getClient();
  pool.release(entry); // 释放后开始计时空闲回收
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(client.destroyed, true, '空闲连接应被回收');
  pool.closeKey(CFG);
});

test('run 执行命令并返回输出', async () => {
  const { pool, getClient } = makePool();
  const result = await pool.run(CFG, 'uptime');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'out:uptime');
  assert.equal(getClient().execCount, 1);
  pool.closeKey(CFG);
});

test('连接失败抛出明确错误', async () => {
  const { pool } = makePool();
  // 用永不 ready 的客户端模拟连接失败
  const badPool = new ConnectionPool({
    clientFactory: () => {
      const c = new FakeClient({ connectDelay: 1000 });
      c.connect = () => { /* 永不 ready */ };
      return c;
    },
    connectTimeoutMs: 50,
    reconnectAttempts: 1,
  });
  await assert.rejects(badPool.getConnection(CFG), /SSH 连接失败/);
  pool.closeKey(CFG);
});
