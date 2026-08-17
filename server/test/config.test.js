const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loadConfig 读取环境变量', () => {
  const { config } = loadConfig({
    PORT: '4000',
    JWT_SECRET: 's1',
    MASTER_KEY: 'k1',
    ADMIN_USER: 'boss',
    ADMIN_PASSWORD: 'p1',
    DATA_DIR: '/tmp/d1',
  });
  assert.equal(config.port, 4000);
  assert.equal(config.jwtSecret, 's1');
  assert.equal(config.masterKey, 'k1');
  assert.equal(config.adminUser, 'boss');
  assert.equal(config.adminPassword, 'p1');
  assert.equal(config.dataDir, '/tmp/d1');
});

test('loadConfig 缺失时使用开发默认值并给出警告', () => {
  const { config, warnings } = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.jwtSecret, 'dev-jwt-secret');
  assert.equal(config.masterKey, 'dev-master-key');
  assert.equal(config.adminUser, 'admin');
  assert.equal(config.adminPassword, '123456');
  assert.ok(warnings.some((w) => w.includes('JWT_SECRET')));
  assert.ok(warnings.some((w) => w.includes('MASTER_KEY')));
  assert.ok(warnings.some((w) => w.includes('ADMIN_PASSWORD')));
});
