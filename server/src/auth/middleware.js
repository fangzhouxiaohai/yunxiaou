const { verifyToken } = require('./jwt');

function requireAuth(config) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ code: 401, message: '未登录或令牌缺失' });
    }
    try {
      req.user = verifyToken(token, config.jwtSecret);
      next();
    } catch {
      return res.status(401).json({ code: 401, message: '令牌无效或已过期' });
    }
  };
}

module.exports = { requireAuth };
