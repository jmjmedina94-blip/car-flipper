# 🚗 Car Flipper

Multi-tenant PWA for car flippers and dealers. Track inventory, expenses, work checklists, photos, and profit/loss.

## Features
- Multi-tenant accounts (each dealership is isolated)
- Team accounts (multiple users share one inventory)
- Vehicle inventory with photos, checklist, expenses
- KBB value + profit calculator
- PWA — installable on iPhone home screen
- Dark theme

## Setup

```bash
npm install
node server.js
```

Open http://localhost:3200

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3200 | Server port |
| JWT_SECRET | dev-secret | Change in production! |
| DB_PATH | ./data/carflipper.db | SQLite database path |

## Deploy to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Set `JWT_SECRET` environment variable
4. Deploy

## Tech Stack
- Node.js + Express
- SQLite (better-sqlite3)
- JWT auth
- Vanilla HTML/CSS/JS
- PWA (manifest + service worker)
