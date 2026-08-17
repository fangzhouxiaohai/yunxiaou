const crypto = require('crypto');

// 返回格式: base64(iv).base64(authTag).base64(data)
function encrypt(plainText, masterKey) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload, masterKey) {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
