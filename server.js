const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Init DB first
require('./database');

const app = express();
const PORT = process.env.PORT || 3200;

// Uploads dir — use env var if set (Railway Volume), else local
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
console.log('Uploads dir:', UPLOADS_DIR);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Debug endpoint
app.get('/api/debug/db', async (req, res) => {
  try {
    const db = require('./database');
    const [users, leads] = await Promise.all([
      db.query('SELECT COUNT(*) as cnt FROM users'),
      db.query('SELECT COUNT(*) as cnt FROM leads')
    ]);
    res.json({ mode: db.isPg ? 'postgresql' : 'sqlite', userCount: users.rows[0].cnt, leadCount: leads.rows[0].cnt, dbUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0,30)+'...' : 'NOT SET' });
  } catch (e) { res.json({ error: e.message }); }
});

app.get('/api/debug/uploads', async (req, res) => {
  try {
    const files = [];
    function walk(dir, base = '') {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        const rel = path.join(base, f);
        if (fs.statSync(full).isDirectory()) walk(full, rel);
        else files.push(rel);
      }
    }
    walk(UPLOADS_DIR);
    res.json({ uploadsDir: UPLOADS_DIR, exists: fs.existsSync(UPLOADS_DIR), files });
  } catch (e) { res.json({ error: e.message }); }
});

// Auth routes (setup has no auth; others handled internally)
app.use('/api/auth', require('./routes/auth'));

// Protected routes — auth + attach live permissions from DB
const auth = require('./middleware/auth');
const { attachUserPermissions } = require('./middleware/roles');
const db = require('./database');
const withPerms = [auth, attachUserPermissions(db)];

app.use('/api/vehicles', ...withPerms, require('./routes/vehicles'));
app.use('/api/team', ...withPerms, require('./routes/team'));
app.use('/api/leads/inbound', require('./routes/leads-inbound')); // No auth — SendGrid webhook (MUST be before /api/leads)
app.use('/api/leads', ...withPerms, require('./routes/leads'));
app.use('/api/dealer-inventory', ...withPerms, require('./routes/dealer-inventory'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Crash guards
process.on('uncaughtException', err => { console.error('Uncaught:', err); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Car Flipper running on port ${PORT}`);

  // Daily dealer inventory sync at 6am
  const cron = require('node-cron');
  const { syncInventory } = require('./routes/dealer-inventory');
  cron.schedule('0 6 * * *', () => {
    console.log('Running daily dealer inventory sync...');
    syncInventory();
  });
});
