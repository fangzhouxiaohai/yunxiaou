const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { assertCommandSafe, run } = require('../src/ssh/exec');

function fakeStream({ stdout = 'hello', stderr = '', code = 0 } = {}) {
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  setTimeout(() => {
    stream.emit('data', Buffer.from(stdout));
    stream.stderr.emit('data', Buffer.from(stderr));
    stream.emit('close', code);
  }, 5);
  return stream;
}

function fakeClient() {
  return {
    exec(command, cb) {
      cb(null, fakeStream());
    },
    destroy() { this.destroyed = true; },
  };
}

test('危险命令被拦截', () => {
  assert.throws(() => assertCommandSafe('rm -rf /'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('mkfs.ext4 /dev/sda1'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('reboot'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('dd if=/dev/zero of=/dev/sda'), /安全策略拦截/);
  assert.throws(() => assertCommandSafe('shutdown -h now'), /安全策略拦截/);
});

test('安全命令放行', () => {
  assert.doesNotThrow(() => assertCommandSafe('uptime'));
  assert.doesNotThrow(() => assertCommandSafe('free -m'));
  assert.doesNotThrow(() => assertCommandSafe('ls -la /etc/nginx'));
  assert.doesNotThrow(() => assertCommandSafe('rm -rf /tmp/linuxmgr-trash/test'));
});

test('run 返回退出码与输出', async () => {
  const result = await run(fakeClient(), 'uptime');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
});

test('run 超时后销毁连接并拒绝', async () => {
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  const client = {
    exec(command, cb) { cb(null, stream); },
    destroy() { this.destroyed = true; },
  };
  await assert.rejects(
    run(client, 'sleep 100', { timeoutMs: 30 }),
    /执行超时/
  );
  assert.equal(client.destroyed, true);
});
