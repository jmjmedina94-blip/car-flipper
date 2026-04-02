const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// If UPLOADS_DIR is set (Railway Volume), store DB there too so it persists
const uploadsDir = process.env.UPLOADS_DIR;
const defaultDbPath = uploadsDir
  ? path.join(uploadsDir, 'db', 'carflipper.db')
  : path.join(__dirname, 'data', 'carflipper.db');
const dbPath = process.env.DB_PATH || defaultDbPath;
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
console.log('DB path:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    invite_token TEXT,
    invite_accepted INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    year INTEGER,
    make TEXT,
    model TEXT,
    trim TEXT,
    vin TEXT,
    color TEXT,
    purchase_price REAL DEFAULT 0,
    purchase_date TEXT,
    sell_price REAL,
    sell_date TEXT,
    status TEXT DEFAULT 'active',
    kbb_value REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    category TEXT DEFAULT 'other',
    description TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    category TEXT DEFAULT 'other',
    description TEXT,
    amount REAL NOT NULL DEFAULT 0,
    date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
