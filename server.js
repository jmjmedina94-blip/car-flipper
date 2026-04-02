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

// Debug endpoint — check uploads dir + DB
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

// Auth routes (no middleware)
app.use('/api/auth', require('./routes/auth'));

// Protected routes
const auth = require('./middleware/auth');
app.use('/api/vehicles', auth, require('./routes/vehicles'));
app.use('/api/team', auth, require('./routes/team'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Crash guards
process.on('uncaughtException', err => { console.error('Uncaught:', err); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Car Flipper running on port ${PORT}`);
});
