const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authenticate = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function signToken(user) {
  return jwt.sign(
    { userId: user.id, orgId: user.org_id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { orgName, firstName, lastName, email, password } = req.body;
    if (!orgName || !firstName || !lastName || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const orgId = uuidv4();
    const userId = uuidv4();
    const hash = bcrypt.hashSync(password, 10);

    db.transaction(() => {
      db.prepare('INSERT INTO orgs (id, name) VALUES (?, ?)').run(orgId, orgName);
      db.prepare(
        'INSERT INTO users (id, org_id, email, password_hash, first_name, last_name, role, invite_accepted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, orgId, email, hash, firstName, lastName, 'owner', 1);
    })();

    const user = { id: userId, org_id: orgId, email, role: 'owner' };
    const token = signToken(user);
    res.json({ token, user: { id: userId, firstName, lastName, email, role: 'owner', orgName } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare(
      'SELECT users.*, orgs.name as orgName FROM users JOIN orgs ON users.org_id = orgs.id WHERE users.email = ?'
    ).get(email);
    if (!user || !user.password_hash)
      return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.invite_accepted)
      return res.status(401).json({ error: 'Please accept your invite first' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: user.orgName } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    'SELECT users.id, users.org_id, users.email, users.first_name, users.last_name, users.role, users.created_at, orgs.name as orgName FROM users JOIN orgs ON users.org_id = orgs.id WHERE users.id = ?'
  ).get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    org_id: user.org_id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    orgName: user.orgName,
    created_at: user.created_at
  });
});

// POST /api/auth/invite
router.post('/invite', authenticate, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only owners can invite' });
  const { email, firstName, lastName } = req.body;
  if (!email || !firstName || !lastName) return res.status(400).json({ error: 'email, firstName, lastName required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const userId = uuidv4();
  const inviteToken = uuidv4();
  db.prepare(
    'INSERT INTO users (id, org_id, email, password_hash, first_name, last_name, role, invite_token, invite_accepted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, req.user.orgId, email, '', firstName, lastName, 'member', inviteToken, 0);

  res.json({ message: 'Invite created', inviteToken, email, userId });
});

// POST /api/auth/accept-invite
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });

    const user = db.prepare('SELECT * FROM users WHERE invite_token = ? AND invite_accepted = 0').get(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired invite token' });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, invite_accepted = 1, invite_token = NULL WHERE id = ?').run(hash, user.id);

    const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id);
    const jwtToken = signToken({ id: user.id, org_id: user.org_id, email: user.email, role: user.role });
    res.json({
      token: jwtToken,
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: org ? org.name : '' }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
