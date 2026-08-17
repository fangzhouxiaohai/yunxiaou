const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit } = require('../src/utils/audit');

test('audit 追加 JSON 行并可读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-'));
  audit(dir, { action: 'server.create', target: '10.0.0.1', result: 'success' });
  audit(dir, { action: 'login', target: '127.0.0.1', result: 'fail' });
  const lines = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.action, 'server.create');
  assert.ok(first.time);
});
