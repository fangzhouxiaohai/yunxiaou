const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMonitorOutput } = require('../src/utils/sshParser');

const SAMPLE = `===CPU===
top - 12:00:01 up 10 days,  3:42,  1 user,  load average: 0.15, 0.20, 0.18
Tasks: 123 total,   1 running, 122 sleeping,   0 stopped,   0 zombie
%Cpu(s):  2.3 us,  0.7 sy,  0.0 ni, 96.7 id,  0.0 wa,  0.3 hi,  0.0 si,  0.0 st
===MEM===
              total        used        free      shared  buff/cache   available
Mem:           7821        2043         412         233        5365        5432
Swap:          2047           0        2047
===DISK===
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        40G   12G   27G  31% /
tmpfs           392M     0  392M   0% /dev/shm
===UPTIME===
 12:00:01 up 10 days,  3:42,  1 user,  load average: 0.15, 0.20, 0.18
===NET===
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 123456789  100000    0    0    0     0          0         0 987654321   200000    0    0    0     0       0          0
    lo:  12345    100    0    0    0     0          0         0  12345    100    0    0    0     0       0          0
===SYS===
Linux vm-xxx 5.15.0-91-generic #101-Ubuntu SMP Fri Nov 3 11:24:08 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux
NAME="Ubuntu"
VERSION="20.04.6 LTS (Focal Fossa)"`;

test('解析完整监控输出', () => {
  const data = parseMonitorOutput(SAMPLE);
  assert.equal(data.cpu.us, 2.3);
  assert.equal(data.cpu.sy, 0.7);
  assert.equal(data.cpu.id, 96.7);
  assert.deepEqual(data.load, [0.15, 0.2, 0.18]);
  assert.equal(data.mem.totalMB, 7821);
  assert.equal(data.mem.usedMB, 2043);
  assert.equal(data.mem.percent, 26);
  assert.equal(data.disk.length, 1, '应过滤 tmpfs 等伪文件系统');
  assert.equal(data.disk[0].mount, '/');
  assert.equal(data.disk[0].percent, 31);
  assert.equal(data.net.rxBytes, 123456789);
  assert.equal(data.net.txBytes, 987654321);
  assert.equal(data.uptimeSec, 10 * 86400 + 3 * 3600 + 42 * 60);
  assert.equal(data.os, 'Ubuntu 20.04.6 LTS (Focal Fossa)');
});

test('空输出返回空结构', () => {
  const data = parseMonitorOutput('');
  assert.equal(data.cpu.us, 0);
  assert.equal(data.mem.totalMB, 0);
  assert.deepEqual(data.disk, []);
  assert.deepEqual(data.load, [0, 0, 0]);
});
