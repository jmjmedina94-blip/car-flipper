const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
let sharp; try { sharp = require('sharp'); } catch(e) { sharp = null; }

// Convert any image (including HEIC) to JPEG for browser compatibility
async function toJpeg(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return filePath;
  const jpgPath = filePath.replace(/\.[^.]+$/, '.jpg');
  try {
    // Try sharp first
    if (sharp) {
      await sharp(filePath).jpeg({ quality: 88 }).toFile(jpgPath);
      fs.unlinkSync(filePath);
      return jpgPath;
    }
    // Fallback: ImageMagick convert
    await execFileAsync('convert', [filePath, jpgPath]);
    fs.unlinkSync(filePath);
    return jpgPath;
  } catch(e) {
    console.error('Image conversion error:', e.message);
    // Last resort: rename to .jpg and hope browser can handle it
    try { fs.renameSync(filePath, jpgPath); return jpgPath; } catch(e2) {}
    return filePath;
  }
}

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.resolve(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_ROOT, 'vehicles', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/vehicles
router.get('/', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT v.*,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE vehicle_id = v.id), 0) as total_expenses,
        (SELECT COUNT(*) FROM checklist_items WHERE vehicle_id = v.id) as checklist_total,
        (SELECT COUNT(*) FROM checklist_items WHERE vehicle_id = v.id AND completed = 1) as checklist_done,
        (SELECT filename FROM photos WHERE vehicle_id = v.id ORDER BY created_at ASC LIMIT 1) as thumb_filename
      FROM vehicles v WHERE v.org_id = $1 ORDER BY v.created_at DESC
    `, [req.user.orgId]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/vehicles
router.post('/', async (req, res) => {
  try {
    const { year, make, model, trim, vin, color, purchase_price, purchase_date, status, kbb_value, notes } = req.body;
    const id = uuidv4();
    await db.query(
      `INSERT INTO vehicles (id, org_id, year, make, model, trim, vin, color, purchase_price, purchase_date, status, kbb_value, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.user.orgId, year||null, make||null, model||null, trim||null, vin||null, color||null, purchase_price||0, purchase_date||null, status||'active', kbb_value||null, notes||null]
    );
    const v = await db.query('SELECT * FROM vehicles WHERE id = $1', [id]);
    res.status(201).json(v.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/vehicles/:id
router.get('/:id', async (req, res) => {
  try {
    const vr = await db.query('SELECT * FROM vehicles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!vr.rows.length) return res.status(404).json({ error: 'Not found' });
    const vehicle = vr.rows[0];
    const [expenses, checklist, photos] = await Promise.all([
      db.query('SELECT * FROM expenses WHERE vehicle_id = $1 ORDER BY created_at DESC', [req.params.id]),
      db.query('SELECT * FROM checklist_items WHERE vehicle_id = $1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM photos WHERE vehicle_id = $1 ORDER BY created_at ASC', [req.params.id]),
    ]);
    const totalExpenses = expenses.rows.reduce((s, e) => s + parseFloat(e.amount), 0);
    res.json({
      ...vehicle,
      expenses: expenses.rows,
      checklist: checklist.rows,
      photos: photos.rows.map(p => ({ ...p, url: `/uploads/vehicles/${req.params.id}/${p.filename}` })),
      summary: {
        total_expenses: totalExpenses,
        estimated_profit: vehicle.kbb_value != null ? vehicle.kbb_value - vehicle.purchase_price - totalExpenses : null,
        actual_profit: vehicle.sell_price != null ? vehicle.sell_price - vehicle.purchase_price - totalExpenses : null
      }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// PATCH /api/vehicles/:id
router.patch('/:id', async (req, res) => {
  try {
    const vr = await db.query('SELECT id FROM vehicles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!vr.rows.length) return res.status(404).json({ error: 'Not found' });
    const allowed = ['year','make','model','trim','vin','color','purchase_price','purchase_date','sell_price','sell_date','status','kbb_value','notes'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = fields.map((f, i) => `${f} = $${i+1}`).join(', ');
    const vals = fields.map(f => req.body[f]);
    await db.query(`UPDATE vehicles SET ${sets}, updated_at = NOW() WHERE id = $${vals.length+1}`, [...vals, req.params.id]);
    const updated = await db.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
    res.json(updated.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE /api/vehicles/:id
router.delete('/:id', async (req, res) => {
  try {
    const vr = await db.query('SELECT id FROM vehicles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!vr.rows.length) return res.status(404).json({ error: 'Not found' });
    await db.query('DELETE FROM vehicles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- CHECKLIST ---
router.get('/:id/checklist', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM checklist_items WHERE vehicle_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/checklist', async (req, res) => {
  try {
    const { category, description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });
    const id = uuidv4();
    await db.query('INSERT INTO checklist_items (id, vehicle_id, category, description) VALUES ($1,$2,$3,$4)', [id, req.params.id, category||'other', description]);
    const r = await db.query('SELECT * FROM checklist_items WHERE id = $1', [id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/checklist/:itemId', async (req, res) => {
  try {
    const { completed, description, category } = req.body;
    const curr = await db.query('SELECT * FROM checklist_items WHERE id = $1', [req.params.itemId]);
    if (!curr.rows.length) return res.status(404).json({ error: 'Not found' });
    const item = curr.rows[0];
    await db.query('UPDATE checklist_items SET completed=$1, description=$2, category=$3 WHERE id=$4',
      [completed !== undefined ? (completed ? 1 : 0) : item.completed, description ?? item.description, category ?? item.category, req.params.itemId]);
    const r = await db.query('SELECT * FROM checklist_items WHERE id = $1', [req.params.itemId]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/checklist/:itemId', async (req, res) => {
  try {
    await db.query('DELETE FROM checklist_items WHERE id = $1', [req.params.itemId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- EXPENSES ---
router.get('/:id/expenses', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM expenses WHERE vehicle_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/expenses', async (req, res) => {
  try {
    const { category, description, amount, date } = req.body;
    if (!amount) return res.status(400).json({ error: 'Amount required' });
    const id = uuidv4();
    await db.query('INSERT INTO expenses (id, vehicle_id, category, description, amount, date) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.params.id, category||'other', description||'', parseFloat(amount), date||null]);
    const r = await db.query('SELECT * FROM expenses WHERE id = $1', [id]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/expenses/:expId', async (req, res) => {
  try {
    const curr = await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.expId]);
    if (!curr.rows.length) return res.status(404).json({ error: 'Not found' });
    const exp = curr.rows[0];
    const { category, description, amount, date } = req.body;
    await db.query('UPDATE expenses SET category=$1, description=$2, amount=$3, date=$4 WHERE id=$5',
      [category ?? exp.category, description ?? exp.description, amount ? parseFloat(amount) : exp.amount, date ?? exp.date, req.params.expId]);
    const r = await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.expId]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/expenses/:expId', async (req, res) => {
  try {
    await db.query('DELETE FROM expenses WHERE id = $1', [req.params.expId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- PHOTOS ---
router.post('/:id/photos', upload.array('photos', 20), async (req, res) => {
  try {
    const vr = await db.query('SELECT id FROM vehicles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!vr.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    const inserted = [];
    for (const file of req.files) {
      // Convert HEIC/HEIF and other non-web formats to JPEG
      const originalPath = path.join(UPLOADS_ROOT, 'vehicles', req.params.id, file.filename);
      const convertedPath = await toJpeg(originalPath);
      const finalFilename = path.basename(convertedPath);
      const id = uuidv4();
      await db.query('INSERT INTO photos (id, vehicle_id, filename, original_name) VALUES ($1,$2,$3,$4)', [id, req.params.id, finalFilename, file.originalname]);
      inserted.push({ id, filename: finalFilename, url: `/uploads/vehicles/${req.params.id}/${finalFilename}` });
    }
    res.status(201).json(inserted);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.get('/:id/photos', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM photos WHERE vehicle_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json(r.rows.map(p => ({ ...p, url: `/uploads/vehicles/${req.params.id}/${p.filename}` })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/photos/:photoId', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM photos WHERE id = $1', [req.params.photoId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const photo = r.rows[0];
    const filePath = path.join(UPLOADS_ROOT, 'vehicles', req.params.id, photo.filename);
    try { fs.unlinkSync(filePath); } catch (e) {}
    await db.query('DELETE FROM photos WHERE id = $1', [req.params.photoId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vehicles/:id/summary
router.get('/:id/summary', async (req, res) => {
  try {
    const vr = await db.query('SELECT * FROM vehicles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    if (!vr.rows.length) return res.status(404).json({ error: 'Not found' });
    const vehicle = vr.rows[0];
    const er = await db.query('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE vehicle_id = $1', [req.params.id]);
    const totalExpenses = parseFloat(er.rows[0].total);
    res.json({
      purchase_price: vehicle.purchase_price,
      total_expenses: totalExpenses,
      kbb_value: vehicle.kbb_value,
      sell_price: vehicle.sell_price,
      estimated_profit: vehicle.kbb_value != null ? vehicle.kbb_value - vehicle.purchase_price - totalExpenses : null,
      actual_profit: vehicle.sell_price != null ? vehicle.sell_price - vehicle.purchase_price - totalExpenses : null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
