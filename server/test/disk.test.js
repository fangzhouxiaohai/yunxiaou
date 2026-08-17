const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/index');
const { loadConfig } = require('../src/config');
const { JsonStore } = require('../src/store/jsonStore');
const { encrypt } = require('../src/crypto/cipher');
const { parseLsblk, parseDf } = require('../src/utils/dbParser');

const LSB = `NAME   SIZE TYPE MOUNTPOINT
vda    50G  disk
├─vda1 50G  part /
vdb    100G disk
└─vdb1 100G part
`;
const DF = `Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        50G   12G   36G  25% /
/dev/vdb1       100G   30G   66G  32% /data
`;

test('解析 lsblk 输出', () => {
  const disks = parseLsblk(LSB);
  assert.equal(disks.length, 2);
  assert.equal(disks[0].name, 'vda');
  assert.equal(disks[0].partitions[0].mount, '/');
  assert.equal(disks[1].name, 'vdb');
  assert.equal(disks[1].partitions[0].mount, '');
});

test('解析 df 输出', () => {
  const mounts = parseDf(DF);
  assert.equal(mounts.length, 2);
  assert.equal(mounts[0].percent, 25);
  assert.equal(mounts[1].mount, '/data');
});

function setup(scripted) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linuxmgr-disk-'));
  const { config } = loadConfig({ JWT_SECRET: 's', MASTER_KEY: 'k', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', DATA_DIR: dataDir });
  const stores = { servers: new JsonStore(dataDir, 'servers.json', []) };
  stores.servers.write([{ id: 'srv1', name: 't', host: '10.0.0.1', port: 22, username: 'root', passwordEnc: encrypt('p', 'k'), createdAt: new Date().toISOString() }]);
  const calls = [];
  const pool = {
    async run(cfg, command, opts) {
      calls.push(command);
      const h = scripted[command] || scripted.default;
      return h ? h() : { code: 0, stdout: '', stderr: '' };
    },
    closeKey: () => {},
  };
  const app = createApp({ config, pool, stores });
  return { app, calls };
}

async function auth(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw' });
  return { Authorization: `Bearer ${res.body.data.token}` };
}

test('磁盘列表（lsblk + df）', async () => {
  const { app } = setup({
    'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT': () => ({ code: 0, stdout: LSB, stderr: '' }),
    'df -h -x tmpfs -x devtmpfs': () => ({ code: 0, stdout: DF, stderr: '' }),
    default: () => ({ code: 127, stdout: '', stderr: 'not found' }),
  });
  const res = await request(app).get('/api/servers/srv1/disk').set(await auth(app));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.disks.length, 2);
  assert.equal(res.body.data.mounts.length, 2);
});

test('挂载分区到挂载点', async () => {
  const { app, calls } = setup({
    default: () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const res = await request(app).post('/api/servers/srv1/disk/mount').set(await auth(app))
    .send({ device: '/dev/vdb1', mountPoint: '/data' });
  assert.equal(res.status, 200);
  const joined = calls.join(' ');
  assert.ok(joined.includes('mkdir -p /data') && joined.includes('mount /dev/vdb1 /data'));
});

test('挂载到危险路径被拒绝', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/disk/mount').set(await auth(app))
    .send({ device: '/dev/vdb1', mountPoint: '/etc' });
  assert.equal(res.status, 400);
});

test('卸载需确认', async () => {
  const { app } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/disk/umount').set(await auth(app))
    .send({ mountPoint: '/data', confirm: false });
  assert.equal(res.status, 400);
});

test('卸载确认后执行', async () => {
  const { app, calls } = setup({ default: () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await request(app).post('/api/servers/srv1/disk/umount').set(await auth(app))
    .send({ mountPoint: '/data', confirm: true });
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.includes('umount /data')));
});
