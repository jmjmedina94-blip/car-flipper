const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireRole } = require('../middleware/roles');

// GET /api/team — list active team members (admin/owner only)
// Owners are hidden from non-owner viewers.
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const isOwner = req.user.role === 'owner';
    const sql = isOwner
      ? `SELECT id, first_name, last_name, email, role, can_view_all_leads, can_view_dealer_inventory, created_at
         FROM users WHERE org_id = $1 AND invite_accepted = 1 ORDER BY created_at ASC`
      : `SELECT id, first_name, last_name, email, role, can_view_all_leads, can_view_dealer_inventory, created_at
         FROM users WHERE org_id = $1 AND invite_accepted = 1 AND role != 'owner' ORDER BY created_at ASC`;
    const r = await db.query(sql, [req.user.orgId]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/team/invites — pending invites (admin/owner only)
router.get('/invites', requireRole('admin'), async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, email, invite_role, invite_expires_at, created_at FROM users WHERE org_id = $1 AND invite_accepted = 0 ORDER BY created_at DESC',
      [req.user.orgId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
