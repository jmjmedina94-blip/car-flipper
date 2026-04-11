// database.js — supports both PostgreSQL (production) and SQLite (local dev)
const DATABASE_URL = process.env.DATABASE_URL;

let db;

if (DATABASE_URL) {
  // ---- PostgreSQL (Railway production) ----
  console.log('Using PostgreSQL');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // Init schema
  pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
      created_at TIMESTAMPTZ DEFAULT NOW()
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category TEXT DEFAULT 'other',
      description TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category TEXT DEFAULT 'other',
      description TEXT DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      date TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      assigned_to TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      source TEXT DEFAULT 'other',
      status TEXT DEFAULT 'new',
      vehicle_year INTEGER,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_trim TEXT,
      vehicle_vin TEXT,
      vehicle_stock_number TEXT,
      lead_date TEXT,
      notes_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lead_notes (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lead_attachments (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lead_activities (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      activity_type TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).then(() => console.log('PG schema ready')).catch(e => console.error('PG schema error:', e.message));

  // Wrap pool to look like better-sqlite3 interface
  db = {
    _pg: pool,
    prepare: (sql) => ({
      _sql: sql,
      get: (...params) => { throw new Error('Use async query for PG'); },
      all: (...params) => { throw new Error('Use async query for PG'); },
      run: (...params) => { throw new Error('Use async query for PG'); },
    }),
    query: (sql, params) => pool.query(sql, params),
    isPg: true,
  };
} else {
  // ---- SQLite (local dev) ----
  console.log('Using SQLite (local dev)');
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'carflipper.db');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  console.log('DB path:', dbPath);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
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
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      assigned_to TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      source TEXT DEFAULT 'other',
      status TEXT DEFAULT 'new',
      vehicle_year INTEGER,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_trim TEXT,
      vehicle_vin TEXT,
      vehicle_stock_number TEXT,
      lead_date TEXT,
      notes_summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_notes (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_attachments (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_activities (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      activity_type TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db = sqlite;
  db.isPg = false;
  db.query = (sql, params) => {
    // Convert $1,$2 style to ? for sqlite
    let i = 0;
    const converted = sql.replace(/\$\d+/g, () => '?');
    const stmt = sqlite.prepare(converted);
    if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
      return Promise.resolve({ rows: stmt.all(...(params || [])) });
    }
    const result = stmt.run(...(params || []));
    return Promise.resolve({ rows: [], rowCount: result.changes });
  };
}

module.exports = db;
