const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authenticate = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function signToken(userId, orgId, email, role) {
  return jwt.sign({ userId, orgId, email, role }, JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { orgName, firstName, lastName, email, password } = req.body;
    if (!orgName || !firstName || !lastName || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const orgId = uuidv4();
    const userId = uuidv4();
    const hash = bcrypt.hashSync(password, 10);

    await db.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, orgName]);
    await db.query(
      'INSERT INTO users (id, org_id, first_name, last_name, email, password_hash, role, invite_accepted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [userId, orgId, firstName, lastName, email, hash, 'owner', 1]
    );

    const token = signToken(userId, orgId, email, 'owner');
    res.json({ token, user: { id: userId, firstName, lastName, email, role: 'owner', orgName } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db.query(
      'SELECT users.*, orgs.name as org_name FROM users JOIN orgs ON users.org_id = orgs.id WHERE users.email = $1',
      [email]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user.id, user.org_id, user.email, user.role);
    res.json({ token, user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: user.org_name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    console.log('ME req.user:', JSON.stringify(req.user));
    const result = await db.query(
      'SELECT users.*, orgs.name as org_name FROM users JOIN orgs ON users.org_id = orgs.id WHERE users.id = $1',
      [req.user.userId]
    );
    console.log('ME rows:', result.rows.length);
    const user = result.rows[0];
    if (!user) {
      // Debug: check if user exists at all
      const check = await db.query('SELECT id FROM users WHERE id = $1', [req.user.userId]);
      console.log('Direct user check:', check.rows.length, 'rows for id', req.user.userId);
      return res.status(404).json({ error: 'User not found', userId: req.user.userId, directCheck: check.rows.length });
    }
    res.json({ id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: user.org_name });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/invite
router.post('/invite', authenticate, async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const inviteToken = uuidv4();
    const userId = uuidv4();
    const fn = firstName || 'Invited';
    const ln = lastName || 'User';
    await db.query(
      'INSERT INTO users (id, org_id, first_name, last_name, email, password_hash, role, invite_token, invite_accepted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [userId, req.user.orgId, fn, ln, email, '', 'member', inviteToken, 0]
    );
    const link = `${req.protocol}://${req.get('host')}/?invite=${inviteToken}`;
    res.json({ message: 'Invite created', inviteToken, email, link });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/accept-invite
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    const result = await db.query('SELECT * FROM users WHERE invite_token = $1 AND invite_accepted = 0', [token]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired invite' });
    const hash = bcrypt.hashSync(password, 10);
    const fn = firstName || user.first_name;
    const ln = lastName || user.last_name;
    await db.query(
      'UPDATE users SET password_hash=$1, invite_accepted=1, invite_token=NULL, first_name=$2, last_name=$3 WHERE id=$4',
      [hash, fn, ln, user.id]
    );
    const orgResult = await db.query('SELECT name FROM orgs WHERE id = $1', [user.org_id]);
    const orgName = orgResult.rows[0]?.name || '';
    const jwtToken = signToken(user.id, user.org_id, user.email, user.role);
    res.json({ token: jwtToken, user: { id: user.id, firstName: fn, lastName: ln, email: user.email, role: user.role, orgName } });
  } catch (err) {
    console.error('Accept invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
