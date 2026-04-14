const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const DEALER_URL = 'https://www.gamotorsca.com/cars-for-sale';
const DEALER_BASE = 'https://www.gamotorsca.com';

// Full browser-like headers to avoid bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive',
};

function randomDelay(min = 500, max = 2000) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

function parseVehicleCards(html) {
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

    const parts = titleText.split(/\s+/);
    const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parseInt(parts[0]) : null;
    const make = parts[1] || null;
    const model = parts.slice(2).join(' ') || null;

    const price = parseInt(priceText.replace(/[^0-9]/g, '')) || null;
    const mileage = parseInt(mileageText.replace(/[^0-9]/g, '')) || null;

    const externalId = detailHref.split('/').pop() || uuidv4();
    const detailUrl = detailHref.startsWith('http') ? detailHref : DEALER_BASE + detailHref;

    if (year || make) {
      vehicles.push({ year, make, model, trim: trim || null, price, mileage, photoUrl, detailUrl, externalId });
    }
  });

  return vehicles;
}

// Strategy 1: Direct fetch with full browser headers
async function fetchDirect() {
  await randomDelay(300, 1500);
  const { data } = await axios.get(DEALER_URL, {
    headers: BROWSER_HEADERS,
    timeout: 20000,
    maxRedirects: 5,
  });
  const vehicles = parseVehicleCards(data);
  if (!vehicles.length) throw new Error('No vehicles found in direct response (possible bot block)');
  return vehicles;
}

// Strategy 2: Google Web Cache
async function fetchGoogleCache() {
  await randomDelay(500, 2000);
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(DEALER_URL)}`;
  const { data } = await axios.get(cacheUrl, {
    headers: {
      ...BROWSER_HEADERS,
      'Referer': 'https://www.google.com/',
    },
    timeout: 20000,
  });
  const vehicles = parseVehicleCards(data);
  if (!vehicles.length) throw new Error('No vehicles found in Google cache');
  return vehicles;
}

// Strategy 3: Wayback Machine (most recent snapshot)
async function fetchWayback() {
  await randomDelay(300, 1000);
  // Get the latest snapshot URL
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(DEALER_URL)}&output=json&limit=-1&fl=timestamp`;
  const { data: cdx } = await axios.get(cdxUrl, { timeout: 10000 });
  if (!cdx || cdx.length < 2) throw new Error('No Wayback Machine snapshots found');
  const timestamp = cdx[cdx.length - 1][0];
  const wbUrl = `https://web.archive.org/web/${timestamp}/${DEALER_URL}`;
  const { data } = await axios.get(wbUrl, {
    headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    timeout: 20000,
  });
  const vehicles = parseVehicleCards(data);
  if (!vehicles.length) throw new Error('No vehicles found in Wayback snapshot');
  return vehicles;
}

async function scrapeInventory() {
  const strategies = [
    { name: 'direct', fn: fetchDirect },
    { name: 'google-cache', fn: fetchGoogleCache },
    { name: 'wayback', fn: fetchWayback },
  ];

  for (const { name, fn } of strategies) {
    try {
      console.log(`Dealer scrape: trying ${name}...`);
      const vehicles = await fn();
      console.log(`Dealer scrape: ${name} succeeded — ${vehicles.length} vehicles`);
      return vehicles;
    } catch (e) {
      console.warn(`Dealer scrape: ${name} failed — ${e.message}`);
    }
  }

  throw new Error('All scraping strategies failed');
}

async function syncInventory() {
  const logId = uuidv4();
  try {
    const vehicles = await scrapeInventory();

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
