const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt } = require('../src/crypto/cipher');

test('加解密往返一致', () => {
  const payload = encrypt('MyP@ssw0rd!', 'master-key-1');
  assert.notEqual(payload, 'MyP@ssw0rd!');
  assert.equal(decrypt(payload, 'master-key-1'), 'MyP@ssw0rd!');
});

test('相同明文不同 IV，密文不同', () => {
  const a = encrypt('same', 'k');
  const b = encrypt('same', 'k');
  assert.notEqual(a, b);
});

test('错误主密钥解密抛错', () => {
  const payload = encrypt('secret', 'right');
  assert.throws(() => decrypt(payload, 'wrong'), /Unsupported state or unable to authenticate data/);
});

test('密文被篡改后解密抛错', () => {
  const payload = encrypt('secret', 'k');
  const parts = payload.split('.');
  const tampered = parts[0] + '.AAAA' + parts[0].slice(4) + '.' + parts[2];
  assert.throws(() => decrypt(tampered, 'k'));
});
