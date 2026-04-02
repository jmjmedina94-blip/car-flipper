const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB lives on the Volume if UPLOADS_DIR is set, otherwise local data/
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

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    invite_token TEXT,
    invite_accepted INTEGER NOT NULL DEFAULT 1,
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
    category TEXT DEFAULT 'other',
    description TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    category TEXT DEFAULT 'other',
    description TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations: safely add columns if they don't exist
const migrations = [
  { table: 'users', col: 'invite_token', def: 'TEXT' },
  { table: 'users', col: 'invite_accepted', def: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'users', col: 'first_name', def: "TEXT NOT NULL DEFAULT ''" },
  { table: 'users', col: 'last_name', def: "TEXT NOT NULL DEFAULT ''" },
];

for (const m of migrations) {
  const cols = db.prepare(`PRAGMA table_info(${m.table})`).all().map(c => c.name);
  if (!cols.includes(m.col)) {
    try {
      db.prepare(`ALTER TABLE ${m.table} ADD COLUMN ${m.col} ${m.def}`).run();
      console.log(`Migration: added ${m.table}.${m.col}`);
    } catch (e) {
      console.log(`Migration skip: ${e.message}`);
    }
  }
}

module.exports = db;
