const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/team — list all users in org
router.get('/', (req, res) => {
  const members = db.prepare(
    'SELECT id, first_name, last_name, email, role, invite_accepted, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC'
  ).all(req.user.org_id);
  res.json(members);
});

// DELETE /api/team/:userId — owner only, remove member (not self)
router.delete('/:userId', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only owners can remove members' });
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot remove yourself' });

  const member = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(req.params.userId, req.user.org_id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
