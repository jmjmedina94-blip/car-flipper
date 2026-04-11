const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.resolve(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_ROOT, 'leads', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Helper: log activity
async function logActivity(leadId, userId, type, description) {
  const id = uuidv4();
  await db.query(
    'INSERT INTO lead_activities (id, lead_id, user_id, activity_type, description) VALUES ($1,$2,$3,$4,$5)',
    [id, leadId, userId, type, description]
  );
}

// GET /api/leads
router.get('/', async (req, res) => {
  try {
    const { status, assigned_to, search, date_from, date_to } = req.query;
    let sql = `SELECT l.*, 
      u.first_name || ' ' || u.last_name as assigned_name,
      (SELECT COUNT(*) FROM lead_notes WHERE lead_id = l.id) as note_count,
      (SELECT created_at FROM lead_activities WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) as last_activity
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      WHERE l.org_id = $1`;
    const params = [req.user.orgId];
    let i = 2;
    if (status) { sql += ` AND l.status = $${i++}`; params.push(status); }
    if (assigned_to) { sql += ` AND l.assigned_to = $${i++}`; params.push(assigned_to); }
    if (date_from) { sql += ` AND l.lead_date >= $${i++}`; params.push(date_from); }
    if (date_to) { sql += ` AND l.lead_date <= $${i++}`; params.push(date_to); }
    if (search) {
      sql += ` AND (l.name ILIKE $${i} OR l.phone ILIKE $${i} OR l.email ILIKE $${i})`;
      params.push(`%${search}%`); i++;
    }
    sql += ' ORDER BY l.created_at DESC';
    // SQLite doesn’t support ILIKE — use LIKE for compat
    const finalSql = db.isPg ? sql : sql.replace(/ILIKE/g, 'LIKE');
    const r = await db.query(finalSql, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/leads
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, source, status, assigned_to, vehicle_year, vehicle_make, vehicle_model,
      vehicle_trim, vehicle_vin, vehicle_stock_number, lead_date, notes_summary } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO leads (id, org_id, name, phone, email, source, status, assigned_to, vehicle_year, vehicle_make,
       vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number, lead_date, notes_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, req.user.orgId, name, phone||null, email||null, source||'other', status||'new',
       assigned_to||null, vehicle_year||null, vehicle_make||null, vehicle_model||null,
       vehicle_trim||null, vehicle_vin||null, vehicle_stock_number||null, lead_date||null, notes_summary||null]
    );
    await logActivity(id, req.user.userId, 'note', `Lead created`);
    const r = await db.query('SELECT * FROM leads WHERE id = $1', [id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const lr = await db.query(
      `SELECT l.*, u.first_name || ' ' || u.last_name as assigned_name 
       FROM leads l LEFT JOIN users u ON l.assigned_to = u.id 
       WHERE l.id = $1 AND l.org_id = $2`, [req.params.id, req.user.orgId]);
    if (!lr.rows.length) return res.status(404).json({ error: 'Not found' });
    const [notes, attachments, activities] = await Promise.all([
      db.query(`SELECT ln.*, u.first_name || ' ' || u.last_name as author_name 
                FROM lead_notes ln LEFT JOIN users u ON ln.user_id = u.id 
                WHERE ln.lead_id = $1 ORDER BY ln.created_at ASC`, [req.params.id]),
      db.query('SELECT * FROM lead_attachments WHERE lead_id = $1 ORDER BY created_at ASC', [req.params.id]),
      db.query(`SELECT la.*, u.first_name || ' ' || u.last_name as user_name 
                FROM lead_activities la LEFT JOIN users u ON la.user_id = u.id 
                WHERE la.lead_id = $1 ORDER BY la.created_at DESC`, [req.params.id]),
    ]);
    res.json({
      ...lr.rows[0],
      notes: notes.rows,
      attachments: attachments.rows.map(a => ({
        ...a, url: `/uploads/leads/${req.params.id}/${a.filename}`
      })),
      activities: activities.rows
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// PATCH /api/leads/:id
router.patch('/:id', async (req, res) => {
  try {
    const lr = await db.query('SELECT * FROM leads WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!lr.rows.length) return res.status(404).json({ error: 'Not found' });
    const old = lr.rows[0];
    const allowed = ['name','phone','email','source','status','assigned_to','vehicle_year','vehicle_make',
      'vehicle_model','vehicle_trim','vehicle_vin','vehicle_stock_number','lead_date','notes_summary'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

    // Auto-log status change
    if (req.body.status && req.body.status !== old.status) {
      await logActivity(req.params.id, req.user.userId, 'status_change',
        `Status changed from ${old.status} to ${req.body.status}`);
    }
    // Auto-log assignment change
    if (req.body.assigned_to !== undefined && req.body.assigned_to !== old.assigned_to) {
      const newRep = req.body.assigned_to
        ? (await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [req.body.assigned_to])).rows[0]
        : null;
      const oldRep = old.assigned_to
        ? (await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [old.assigned_to])).rows[0]
        : null;
      const newName = newRep ? `${newRep.first_name} ${newRep.last_name}` : 'Unassigned';
      const oldName = oldRep ? `${oldRep.first_name} ${oldRep.last_name}` : 'Unassigned';
      await logActivity(req.params.id, req.user.userId, 'assignment',
        `Assigned to ${newName} (was ${oldName})`);
    }

    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const nowExpr = db.isPg ? 'NOW()' : "datetime('now')";
    await db.query(
      `UPDATE leads SET ${sets}, updated_at = ${nowExpr} WHERE id = $${fields.length + 1}`,
      [...fields.map(f => req.body[f]), req.params.id]
    );
    const updated = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    res.json(updated.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
  try {
    const lr = await db.query('SELECT id FROM leads WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!lr.rows.length) return res.status(404).json({ error: 'Not found' });
    await db.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/leads/:id/notes
router.post('/:id/notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    const id = uuidv4();
    await db.query('INSERT INTO lead_notes (id, lead_id, user_id, content) VALUES ($1,$2,$3,$4)',
      [id, req.params.id, req.user.userId, content]);
    await logActivity(req.params.id, req.user.userId, 'note',
      `Note added: ${content.substring(0, 60)}${content.length > 60 ? '...' : ''}`);
    const r = await db.query(`SELECT ln.*, u.first_name || ' ' || u.last_name as author_name 
      FROM lead_notes ln LEFT JOIN users u ON ln.user_id = u.id WHERE ln.id = $1`, [id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/leads/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    await db.query('DELETE FROM lead_notes WHERE id = $1', [req.params.noteId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/leads/:id/attachments
router.post('/:id/attachments', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    const inserted = [];
    for (const file of req.files) {
      const id = uuidv4();
      await db.query(
        'INSERT INTO lead_attachments (id, lead_id, user_id, filename, original_name, mime_type, file_size) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, req.params.id, req.user.userId, file.filename, file.originalname, file.mimetype, file.size]
      );
      await logActivity(req.params.id, req.user.userId, 'note', `Attachment uploaded: ${file.originalname}`);
      inserted.push({ id, filename: file.filename, original_name: file.originalname,
        mime_type: file.mimetype, url: `/uploads/leads/${req.params.id}/${file.filename}` });
    }
    res.status(201).json(inserted);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/leads/:id/attachments
router.get('/:id/attachments', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM lead_attachments WHERE lead_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json(r.rows.map(a => ({ ...a, url: `/uploads/leads/${req.params.id}/${a.filename}` })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/leads/:id/attachments/:attachmentId
router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM lead_attachments WHERE id = $1', [req.params.attachmentId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const att = r.rows[0];
    const filePath = path.join(UPLOADS_ROOT, 'leads', req.params.id, att.filename);
    try { fs.unlinkSync(filePath); } catch (e) {}
    await db.query('DELETE FROM lead_attachments WHERE id = $1', [req.params.attachmentId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/leads/:id/activities
router.get('/:id/activities', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT la.*, u.first_name || ' ' || u.last_name as user_name 
       FROM lead_activities la LEFT JOIN users u ON la.user_id = u.id 
       WHERE la.lead_id = $1 ORDER BY la.created_at DESC`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
