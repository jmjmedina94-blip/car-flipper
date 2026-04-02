const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, first_name, last_name, email, role, created_at FROM users WHERE org_id = $1 AND invite_accepted = 1 ORDER BY created_at ASC',
      [req.user.orgId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/invites', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, email, created_at FROM users WHERE org_id = $1 AND invite_accepted = 0 ORDER BY created_at DESC',
      [req.user.orgId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
