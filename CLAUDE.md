# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Car Flipper is a multi-tenant PWA for car dealers/flippers. It tracks inventory, expenses, work checklists, photos, and profit/loss. The frontend is a vanilla JS single-page app served by an Express backend with dual SQLite/PostgreSQL support.

## Commands

```bash
npm install          # Install dependencies
node server.js       # Start server on port 3200 (or $PORT)
```

No test framework, linter, or build step is configured.

## Architecture

**Single codebase (not a monorepo):** Express API in the root, vanilla JS SPA in `public/`.

### Backend

- **Entry point:** `server.js` — sets up Express, mounts routes with middleware chain
- **Database:** `database.js` — dual SQLite (dev) / PostgreSQL (prod, when `DATABASE_URL` is set). Uses PostgreSQL-style `$1, $2` params everywhere; SQLite adapter converts them to `?`
- **Middleware chain:** `auth.js` (JWT verify) → `roles.js` (`attachUserPermissions`) → route handler. Applied in `server.js` as `const withPerms = [auth, attachUserPermissions(db)]`
- **Routes:** `routes/auth.js`, `routes/vehicles.js`, `routes/leads.js`, `routes/leads-inbound.js`, `routes/team.js` — each uses Express Router, receives `db` via factory function export pattern
- **File uploads:** Multer with disk storage, UUID filenames. Vehicle photos auto-converted from HEIC→JPEG via `sharp`. Stored in `uploads/{vehicles|leads}/{id}/`

### Frontend

- `public/index.html` — SPA shell with all page sections
- `public/app.js` — all client logic; page navigation via `showPage()` toggling element visibility
- `apiFetch()` wrapper adds Bearer token from localStorage
- Role-based UI: nav items and sections shown/hidden per user permissions

### Roles & Permissions

Three roles: **owner** (level 3), **admin** (level 2), **bdc_rep** (level 1). Permission checks are inline in route handlers. Key granular permissions: `can_view_all_leads`, `can_view_dealer_inventory`.

### Inventory Types

Two types: `ga_motors` (dealer inventory, permission-gated) and `street_cars` (admins only). Affects both API filtering and UI visibility.

### Inbound Leads

CarGurus leads arrive via SendGrid webhook at `POST /api/leads/inbound/cargurus` (no auth). Parses ADF/XML and HTML email formats. Also supports `POST /api/leads/import/csv` for bulk import.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3200 | Server port |
| JWT_SECRET | dev-secret | JWT signing secret |
| DATABASE_URL | — | PostgreSQL connection string (if set, uses PG instead of SQLite) |
| DB_PATH | ./data/carflipper.db | SQLite database path |
| UPLOADS_DIR | ./uploads | Upload directory |

## Deployment

Deployed on Railway via Dockerfile (Node 22 Alpine). Config in `railway.json` and `Procfile`.
