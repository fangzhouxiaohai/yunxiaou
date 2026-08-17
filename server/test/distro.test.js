const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDistro, remiAvailable, suryAvailable } = require('../src/utils/distro');

test('解析 /etc/os-release 为发行版信息', () => {
  const info = detectDistro('NAME="CentOS Linux"\nVERSION="7 (Core)"\nID="centos"\nVERSION_ID="7"\n');
  assert.equal(info.id, 'centos');
  assert.equal(info.versionMajor, 7);
  assert.equal(info.family, 'rhel');
});

test('Ubuntu 识别为 debian 系', () => {
  const info = detectDistro('NAME="Ubuntu"\nVERSION="20.04.6 LTS"\nID="ubuntu"\nVERSION_ID="20.04"\n');
  assert.equal(info.family, 'debian');
  assert.equal(info.versionMajor, 20);
});

test('remi 源可用性判断（rhel7 有 remi-release 时 true）', () => {
  assert.equal(remiAvailable('rhel', 7, 'remi-release  installed'), true);
  assert.equal(remiAvailable('rhel', 7, ''), false);
  assert.equal(remiAvailable('debian', 20, 'x'), false, 'debian 系不走 remi');
});

test('sury 源可用性判断（debian 系）', () => {
  assert.equal(suryAvailable('debian', 20, 'php'), true, 'sury 包存在即可用');
  assert.equal(suryAvailable('rhel', 7, 'x'), false);
});
