const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const DEALER_URL = 'https://www.gamotorsca.com/cars-for-sale';
const DEALER_BASE = 'https://www.gamotorsca.com';

async function scrapeInventory() {
  const { data: html } = await axios.get(DEALER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const vehicles = [];

  $('li.vehicle-card').each((i, el) => {
    const $card = $(el);
    const titleText = $card.find('h5.inventory-title > span').first().text().trim();
    const trim = $card.find('span.inventory-trim').text().trim();
    const priceText = $card.find('.price-mileage-block .col').first().find('.value').text().trim();
    const mileageText = $card.find('.price-mileage-block .col').eq(1).find('.value').text().trim();
    const photoUrl = $card.find('.carousel-item.active img').attr('src')
      || $card.find('.no-image img').attr('src') || null;
    const detailHref = $card.find('.inventory-title-wrapper a').attr('href') || '';

    // Parse year/make/model from title like "2019 Ford Edge"
    const parts = titleText.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parseInt(parts[0]) : null;
    const make = parts[1] || null;
    const model = parts.slice(2).join(' ') || null;

    // Parse price — strip $ and commas
    const price = parseInt(priceText.replace(/[^0-9]/g, '')) || null;
    const mileage = parseInt(mileageText.replace(/[^0-9]/g, '')) || null;

    // External ID from detail URL
    const externalId = detailHref.split('/').pop() || uuidv4();
    const detailUrl = detailHref.startsWith('http') ? detailHref : DEALER_BASE + detailHref;

    if (year || make) {
      vehicles.push({ year, make, model, trim: trim || null, price, mileage, photoUrl, detailUrl, externalId });
    }
  });

  return vehicles;
}

async function syncInventory() {
  const logId = uuidv4();
  try {
    const vehicles = await scrapeInventory();
    const nowExpr = db.isPg ? 'NOW()' : "datetime('now')";

    // Clear old inventory and insert fresh
    await db.query('DELETE FROM dealer_inventory');
    for (const v of vehicles) {
      await db.query(
        `INSERT INTO dealer_inventory (id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, price, mileage, photo_url, detail_url, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uuidv4(), v.year, v.make, v.model, v.trim, v.price, v.mileage, v.photoUrl, v.detailUrl, v.externalId]
      );
    }

    await db.query(
      `INSERT INTO dealer_sync_log (id, vehicle_count, status) VALUES ($1,$2,$3)`,
      [logId, vehicles.length, 'success']
    );
    console.log(`Dealer inventory synced: ${vehicles.length} vehicles`);
    return { ok: true, count: vehicles.length };
  } catch (e) {
    console.error('Dealer sync error:', e.message);
    await db.query(
      `INSERT INTO dealer_sync_log (id, vehicle_count, status, error) VALUES ($1,$2,$3,$4)`,
      [logId, 0, 'error', e.message]
    ).catch(() => {});
    return { ok: false, error: e.message };
  }
}

// GET /api/dealer-inventory
router.get('/', async (req, res) => {
  try {
    const vehicles = await db.query('SELECT * FROM dealer_inventory ORDER BY vehicle_year DESC, vehicle_make ASC');
    const lastSync = await db.query('SELECT synced_at, vehicle_count, status, error FROM dealer_sync_log ORDER BY synced_at DESC LIMIT 1');
    res.json({
      vehicles: vehicles.rows,
      lastSync: lastSync.rows[0] || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dealer-inventory/sync
router.post('/sync', async (req, res) => {
  try {
    const result = await syncInventory();
    if (result.ok) {
      const vehicles = await db.query('SELECT * FROM dealer_inventory ORDER BY vehicle_year DESC, vehicle_make ASC');
      const lastSync = await db.query('SELECT synced_at, vehicle_count, status FROM dealer_sync_log ORDER BY synced_at DESC LIMIT 1');
      res.json({ vehicles: vehicles.rows, lastSync: lastSync.rows[0] });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.syncInventory = syncInventory;
