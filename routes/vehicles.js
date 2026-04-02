const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');

// Photo upload setup
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.resolve(__dirname, '..', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_ROOT, 'vehicles', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/vehicles
router.get('/', (req, res) => {
  const vehicles = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM expenses WHERE vehicle_id = v.id) as expense_count,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE vehicle_id = v.id) as total_expenses,
      (SELECT COUNT(*) FROM checklist_items WHERE vehicle_id = v.id) as checklist_total,
      (SELECT COUNT(*) FROM checklist_items WHERE vehicle_id = v.id AND completed = 1) as checklist_done,
      (SELECT filename FROM photos WHERE vehicle_id = v.id ORDER BY created_at ASC LIMIT 1) as thumb_filename
    FROM vehicles v WHERE v.org_id = ? ORDER BY v.created_at DESC
  `).all(req.user.org_id);
  res.json(vehicles);
});

// POST /api/vehicles
router.post('/', (req, res) => {
  const { year, make, model, trim, vin, color, purchase_price, purchase_date, status, kbb_value, notes } = req.body;
  const id = uuidv4();
  db.prepare(`
    INSERT INTO vehicles (id, org_id, year, make, model, trim, vin, color, purchase_price, purchase_date, status, kbb_value, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.org_id, year, make, model, trim, vin, color, purchase_price || 0, purchase_date, status || 'active', kbb_value, notes);
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  res.status(201).json(vehicle);
});

// GET /api/vehicles/:id
router.get('/:id', (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });

  const expenses = db.prepare('SELECT * FROM expenses WHERE vehicle_id = ? ORDER BY date DESC, created_at DESC').all(req.params.id);
  const checklist = db.prepare('SELECT * FROM checklist_items WHERE vehicle_id = ? ORDER BY created_at ASC').all(req.params.id);
  const photos = db.prepare('SELECT * FROM photos WHERE vehicle_id = ? ORDER BY created_at ASC').all(req.params.id);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  res.json({
    ...vehicle,
    expenses,
    checklist,
    photos: photos.map(p => ({ ...p, url: `/uploads/vehicles/${req.params.id}/${p.filename}` })),
    summary: {
      total_expenses: totalExpenses,
      estimated_profit: vehicle.kbb_value != null ? vehicle.kbb_value - vehicle.purchase_price - totalExpenses : null,
      actual_profit: vehicle.sell_price != null ? vehicle.sell_price - vehicle.purchase_price - totalExpenses : null
    }
  });
});

// PATCH /api/vehicles/:id
router.patch('/:id', (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });

  const allowed = ['year','make','model','trim','vin','color','purchase_price','purchase_date','sell_price','sell_date','status','kbb_value','notes'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  const sets = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => req.body[f]);
  db.prepare(`UPDATE vehicles SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...vals, req.params.id);
  res.json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id));
});

// DELETE /api/vehicles/:id
router.delete('/:id', (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- CHECKLIST ---
router.get('/:id/checklist', (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM checklist_items WHERE vehicle_id = ? ORDER BY created_at ASC').all(req.params.id));
});

router.post('/:id/checklist', (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const { category, description } = req.body;
  if (!description) return res.status(400).json({ error: 'Description required' });
  const id = uuidv4();
  db.prepare('INSERT INTO checklist_items (id, vehicle_id, org_id, category, description) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.org_id, category || 'other', description);
  res.status(201).json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id));
});

router.patch('/:id/checklist/:itemId', (req, res) => {
  const item = db.prepare(
    'SELECT ci.* FROM checklist_items ci JOIN vehicles v ON ci.vehicle_id = v.id WHERE ci.id = ? AND v.org_id = ?'
  ).get(req.params.itemId, req.user.org_id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { completed, description, category } = req.body;
  const newCompleted = completed !== undefined ? (completed ? 1 : 0) : item.completed;
  const newDesc = description !== undefined ? description : item.description;
  const newCat = category !== undefined ? category : item.category;
  db.prepare('UPDATE checklist_items SET completed = ?, description = ?, category = ? WHERE id = ?')
    .run(newCompleted, newDesc, newCat, req.params.itemId);
  res.json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.itemId));
});

router.delete('/:id/checklist/:itemId', (req, res) => {
  const item = db.prepare(
    'SELECT ci.id FROM checklist_items ci JOIN vehicles v ON ci.vehicle_id = v.id WHERE ci.id = ? AND v.org_id = ?'
  ).get(req.params.itemId, req.user.org_id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

// --- EXPENSES ---
router.get('/:id/expenses', (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM expenses WHERE vehicle_id = ? ORDER BY date DESC, created_at DESC').all(req.params.id));
});

router.post('/:id/expenses', (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const { category, description, amount, date } = req.body;
  if (amount === undefined || amount === null) return res.status(400).json({ error: 'Amount required' });
  const id = uuidv4();
  db.prepare('INSERT INTO expenses (id, vehicle_id, org_id, category, description, amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.org_id, category || 'other', description || '', parseFloat(amount), date || null);
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
});

router.patch('/:id/expenses/:expId', (req, res) => {
  const exp = db.prepare(
    'SELECT e.* FROM expenses e JOIN vehicles v ON e.vehicle_id = v.id WHERE e.id = ? AND v.org_id = ?'
  ).get(req.params.expId, req.user.org_id);
  if (!exp) return res.status(404).json({ error: 'Not found' });
  const { category, description, amount, date } = req.body;
  const newCat = category !== undefined ? category : exp.category;
  const newDesc = description !== undefined ? description : exp.description;
  const newAmt = amount !== undefined ? parseFloat(amount) : exp.amount;
  const newDate = date !== undefined ? date : exp.date;
  db.prepare('UPDATE expenses SET category = ?, description = ?, amount = ?, date = ? WHERE id = ?')
    .run(newCat, newDesc, newAmt, newDate, req.params.expId);
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.expId));
});

router.delete('/:id/expenses/:expId', (req, res) => {
  const exp = db.prepare(
    'SELECT e.id FROM expenses e JOIN vehicles v ON e.vehicle_id = v.id WHERE e.id = ? AND v.org_id = ?'
  ).get(req.params.expId, req.user.org_id);
  if (!exp) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.expId);
  res.json({ ok: true });
});

// --- PHOTOS ---
router.post('/:id/photos', upload.array('photos', 20), (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  const inserted = [];
  for (const file of req.files) {
    const id = uuidv4();
    db.prepare('INSERT INTO photos (id, vehicle_id, org_id, filename, original_name) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.params.id, req.user.org_id, file.filename, file.originalname);
    inserted.push({ id, filename: file.filename, url: `/uploads/vehicles/${req.params.id}/${file.filename}` });
  }
  res.status(201).json(inserted);
});

router.get('/:id/photos', (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const photos = db.prepare('SELECT * FROM photos WHERE vehicle_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(photos.map(p => ({ ...p, url: `/uploads/vehicles/${req.params.id}/${p.filename}` })));
});

router.delete('/:id/photos/:photoId', (req, res) => {
  const photo = db.prepare(
    'SELECT p.* FROM photos p JOIN vehicles v ON p.vehicle_id = v.id WHERE p.id = ? AND v.org_id = ?'
  ).get(req.params.photoId, req.user.org_id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOADS_ROOT, 'vehicles', req.params.id, photo.filename);
  try { fs.unlinkSync(filePath); } catch (e) {}
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.photoId);
  res.json({ ok: true });
});

// GET /api/vehicles/:id/summary
router.get('/:id/summary', (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  const { total: totalExpenses } = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE vehicle_id = ?').get(req.params.id);
  res.json({
    purchase_price: vehicle.purchase_price,
    total_expenses: totalExpenses,
    kbb_value: vehicle.kbb_value,
    sell_price: vehicle.sell_price,
    estimated_profit: vehicle.kbb_value != null ? vehicle.kbb_value - vehicle.purchase_price - totalExpenses : null,
    actual_profit: vehicle.sell_price != null ? vehicle.sell_price - vehicle.purchase_price - totalExpenses : null
  });
});

module.exports = router;
