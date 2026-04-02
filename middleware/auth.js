const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

module.exports = function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId || payload.id;
    const orgId = payload.orgId || payload.org_id;
    req.user = {
      userId,
      orgId,
      email: payload.email,
      role: payload.role
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
