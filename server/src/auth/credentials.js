const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 凭据优先级：data/auth.json > 环境变量 > 默认值（admin / 123456）
function createCredentials({ dataDir, envUser, envPassword }) {
  const file = path.join(dataDir, 'auth.json');

  // 文件不存在 → 正常回退；存在但损坏/字段不完整 → 拒绝登录（fail-closed）
  function readStored() {
    if (!fs.existsSync(file)) return { state: 'missing' };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.username && parsed.passwordHash && parsed.salt) {
        return { state: 'ok', data: parsed };
      }
    } catch {
      // 解析失败按损坏处理
    }
    console.error(`[auth] 警告：${file} 已损坏或字段不完整，已拒绝所有登录；请修复该文件，或删除它回退到环境变量/默认密码`);
    return { state: 'corrupt' };
  }

  function current() {
    const stored = readStored();
    if (stored.state === 'ok') return stored.data;
    if (stored.state === 'corrupt') return { corrupt: true, username: envUser || 'admin' };
    return { username: envUser || 'admin', password: envPassword || '123456' };
  }

  function verify(username, password) {
    const c = current();
    if (c.corrupt) return false;
    if (username !== c.username) return false;
    if (c.password !== undefined) {
      return safeEqualStr(password || '', c.password);
    }
    return safeEqualHex(hashPassword(password || '', c.salt), c.passwordHash);
  }

  function setPassword(newPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const data = {
      username: current().username,
      passwordHash: hashPassword(newPassword, salt),
      salt,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return data.username;
  }

  return { verify, setPassword };
}

module.exports = { createCredentials };
