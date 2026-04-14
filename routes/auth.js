const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authenticate = require('../middleware/auth');
const { requireRole, isOwner, ROLE_LEVELS } = require('../middleware/roles');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function signToken(userId, orgId, email, role) {
  return jwt.sign({ userId, orgId, email, role }, JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/signup — DISABLED (invite only)
router.post('/signup', (req, res) => {
  return res.status(403).json({ error: 'Account creation is by invitation only. Contact your administrator.' });
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
    if (!user.invite_accepted) return res.status(401).json({ error: 'Please accept your invite first' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = signToken(user.id, user.org_id, user.email, user.role);
    res.json({ token, user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: user.org_name } });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/setup — one-time owner account creation (only if no users exist)
router.post('/setup', async (req, res) => {
  try {
    const { orgName, firstName, lastName, email, password } = req.body;
    if (!orgName || !firstName || !lastName || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    // Only allow if no users exist yet
    const existing = await db.query('SELECT COUNT(*) as cnt FROM users');
    if (parseInt(existing.rows[0].cnt) > 0)
      return res.status(403).json({ error: 'Setup already complete. Use invite system.' });

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
  } catch (err) { console.error('Setup error:', err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT users.*, orgs.name as org_name FROM users JOIN orgs ON users.org_id = orgs.id WHERE users.email = $1',
      [req.user.email]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, role: user.role, orgName: user.org_name, can_view_all_leads: user.can_view_all_leads, can_view_dealer_inventory: user.can_view_dealer_inventory });
  } catch (err) { console.error('Me error:', err); res.status(500).json({ error: err.message }); }
});

// POST /api/auth/invite — owner or admin sends invite
router.post('/invite', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { email, firstName, lastName, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Only owner can invite admins
    const inviteRole = role || 'bdc_rep';
    if (inviteRole === 'owner') return res.status(403).json({ error: 'Cannot invite as owner' });
    if (inviteRole === 'admin' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Only owners can invite admins' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already in use' });

    const inviteToken = uuidv4();
    const userId = uuidv4();
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
    await db.query(
      'INSERT INTO users (id, org_id, first_name, last_name, email, password_hash, role, invite_token, invite_accepted, invite_role, invite_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [userId, req.user.orgId, firstName||'', lastName||'', email, '', inviteRole, inviteToken, 0, inviteRole, expires]
    );
    const link = `${req.protocol}://${req.get('host')}/?invite=${inviteToken}`;
    res.json({ message: 'Invite created', inviteToken, email, link, role: inviteRole, expiresAt: expires });
  } catch (err) { console.error('Invite error:', err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/accept-invite
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });

    const result = await db.query('SELECT * FROM users WHERE invite_token = $1 AND invite_accepted = 0', [token]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired invite' });

    // Check expiry
    if (user.invite_expires_at && new Date(user.invite_expires_at) < new Date())
      return res.status(400).json({ error: 'Invite link has expired. Request a new invite.' });

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
  } catch (err) { console.error('Accept invite error:', err); res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/auth/users/:userId — update role or permissions (admin/owner only)
router.patch('/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { role, can_view_all_leads, can_view_dealer_inventory } = req.body;
    const targetResult = await db.query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.userId, req.user.orgId]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Prevent changing owner's role or demoting yourself
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot modify the owner account' });
    if (req.params.userId === req.user.userId) return res.status(403).json({ error: 'Cannot modify your own role' });

    // Only owner can promote to admin
    if (role === 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only owners can promote to admin' });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot assign owner role' });

    const updates = [];
    const params = [];
    let i = 1;
    if (role !== undefined) { updates.push(`role = $${i++}`); params.push(role); }
    if (can_view_all_leads !== undefined) { updates.push(`can_view_all_leads = $${i++}`); params.push(can_view_all_leads ? 1 : 0); }
    if (can_view_dealer_inventory !== undefined) { updates.push(`can_view_dealer_inventory = $${i++}`); params.push(can_view_dealer_inventory ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.userId);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, params);
    const updated = await db.query('SELECT id, first_name, last_name, email, role, can_view_all_leads, can_view_dealer_inventory FROM users WHERE id = $1', [req.params.userId]);
    res.json(updated.rows[0]);
  } catch (err) { console.error('Update user error:', err); res.status(500).json({ error: err.message }); }
});

// DELETE /api/auth/users/:userId — remove user (owner only, or admin removing bdc_rep)
router.delete('/users/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.userId === req.user.userId) return res.status(403).json({ error: 'Cannot remove yourself' });
    const targetResult = await db.query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.userId, req.user.orgId]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot remove the owner account' });
    if (target.role === 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only owner can remove admins' });
    await db.query('DELETE FROM users WHERE id = $1', [req.params.userId]);
    res.json({ ok: true });
  } catch (err) { console.error('Delete user error:', err); res.status(500).json({ error: err.message }); }
});

// PATCH /api/auth/org — update org name (owner only)
router.patch('/org', authenticate, requireRole('owner'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    await db.query('UPDATE orgs SET name = $1 WHERE id = $2', [name, req.user.orgId]);
    res.json({ ok: true, name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
