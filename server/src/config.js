const path = require('path');

function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3000),
    jwtSecret: env.JWT_SECRET || '',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '24h',
    masterKey: env.MASTER_KEY || '',
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  };
  const warnings = [];
  if (!config.jwtSecret) {
    config.jwtSecret = 'dev-jwt-secret';
    warnings.push('JWT_SECRET 未设置，使用开发默认值 dev-jwt-secret');
  }
  if (!config.masterKey) {
    config.masterKey = 'dev-master-key';
    warnings.push('MASTER_KEY 未设置，使用开发默认值 dev-master-key（生产必须设置）');
  }
  if (!config.adminPassword) {
    config.adminPassword = '123456';
    warnings.push('ADMIN_PASSWORD 未设置，使用默认值 123456（生产环境必须修改）');
  }
  return { config, warnings };
}

module.exports = { loadConfig };
