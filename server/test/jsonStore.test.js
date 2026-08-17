const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/store/jsonStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-'));
}

test('无文件时返回默认值', () => {
  const store = new JsonStore(tmpDir(), 'servers.json', []);
  assert.deepEqual(store.read(), []);
});

test('写入后可读回，且无残留 tmp 文件', () => {
  const dir = tmpDir();
  const store = new JsonStore(dir, 'servers.json', []);
  store.write([{ id: '1', name: 'web' }]);
  assert.deepEqual(store.read(), [{ id: '1', name: 'web' }]);
  const files = fs.readdirSync(dir);
  assert.ok(!files.some((f) => f.endsWith('.tmp')));
});

test('文件损坏时抛出明确错误', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'servers.json'), '{bad json');
  const store = new JsonStore(dir, 'servers.json', []);
  assert.throws(() => store.read(), SyntaxError);
});
