const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDatabases, parseRedisInfo } = require('../src/utils/dbParser');

const DB_OUTPUT = `Database
information_schema
mysql
performance_schema
sys
app_blog
app_shop
`;

const REDIS_INFO = `# Server
redis_version:7.0.15
redis_mode:standalone
os:Linux 5.15.0-91-generic x86_64
# Clients
connected_clients:3
blocked_clients:0
# Memory
used_memory:1048576
used_memory_human:1.00M
maxmemory:0
# Stats
total_connections_received:1234
total_commands_processed:5678
keyspace_hits:100
keyspace_misses:20
# Keyspace
db0:keys=42,expires=10,avg_ttl=0
db1:keys=7,expires=0,avg_ttl=0
`;

test('解析 SHOW DATABASES 输出', () => {
  const dbs = parseDatabases(DB_OUTPUT);
  assert.deepEqual(dbs, ['information_schema', 'mysql', 'performance_schema', 'sys', 'app_blog', 'app_shop']);
});

test('解析 redis INFO 输出', () => {
  const info = parseRedisInfo(REDIS_INFO);
  assert.equal(info.version, '7.0.15');
  assert.equal(info.mode, 'standalone');
  assert.equal(info.connectedClients, 3);
  assert.equal(info.usedMemory, 1048576);
  assert.equal(info.totalConnections, 1234);
  assert.equal(info.totalCommands, 5678);
  assert.equal(info.hitRate, 83); // 100/(100+20) 取整
  assert.equal(info.totalKeys, 49); // 42+7
  assert.deepEqual(info.databases, [{ db: 'db0', keys: 42, expires: 10 }, { db: 'db1', keys: 7, expires: 0 }]);
});

test('空输出返回空结构', () => {
  assert.deepEqual(parseDatabases(''), []);
  const info = parseRedisInfo('');
  assert.equal(info.version, '');
  assert.equal(info.totalKeys, 0);
});
