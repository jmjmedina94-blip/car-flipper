#!/usr/bin/env node
/**
 * Local Dealer Inventory Sync (Puppeteer)
 *
 * Uses headless Chrome to load gamotorsca.com/cars-for-sale, bypassing
 * JS-challenge bot protection. Extracts vehicle data, then pushes to Railway.
 *
 * Usage:
 *   node scripts/sync-inventory-local.js
 *
 * Environment variables:
 *   RAILWAY_URL           — e.g. https://your-app.up.railway.app (no trailing slash)
 *   INVENTORY_PUSH_SECRET — must match the Railway app's INVENTORY_PUSH_SECRET env var
 *
 * Cron example (daily at 6am):
 *   0 6 * * * cd /path/to/car-flipper && RAILWAY_URL=https://your-app.up.railway.app INVENTORY_PUSH_SECRET=secret node scripts/sync-inventory-local.js >> /tmp/inventory-sync.log 2>&1
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');
const axios = require('axios');

const DEALER_URL = 'https://www.gamotorsca.com/cars-for-sale';
const DEALER_BASE = 'https://www.gamotorsca.com';
const RAILWAY_URL = process.env.RAILWAY_URL;
const PUSH_SECRET = process.env.INVENTORY_PUSH_SECRET;

if (!RAILWAY_URL || !PUSH_SECRET) {
  console.error('Missing required env vars: RAILWAY_URL and INVENTORY_PUSH_SECRET');
  process.exit(1);
}

async function scrape() {
  console.log(`[${new Date().toISOString()}] Launching browser...`);
  const isTest = process.argv.includes('--visible');
  const browser = await puppeteer.launch({
    headless: isTest ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  });

  try {
    const page = await browser.newPage();

    // Mask automation signals
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    console.log(`Navigating to ${DEALER_URL}...`);
    await page.goto(DEALER_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for vehicle cards to render
    await page.waitForSelector('li.vehicle-card', { timeout: 15000 }).catch(() => {
      console.warn('No li.vehicle-card found after 15s — page may have loaded differently');
    });

    // Small delay for any lazy-loaded content
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    console.log(`Page loaded — ${(html.length / 1024).toFixed(0)}KB HTML`);

    const $ = cheerio.load(html);
    const vehicles = [];

    $('li.vehicle-card').each((i, el) => {
      const $card = $(el);
      const titleText = $card.find('h5.inventory-title > span').first().text().trim();
      const trim = $card.find('span.inventory-trim').text().trim();
      const priceText = $card.find('.price-mileage-block .col').first().find('.value').text().trim();
      const mileageText = $card.find('.price-mileage-block .col').eq(1).find('.value').text().trim();

      let photoUrl = $card.find('.carousel-item.active img').attr('src')
        || $card.find('.carousel-item.active img').attr('data-src') || null;
      if (!photoUrl || photoUrl.includes('comingsoon')) {
        const srcset = $card.find('.carousel-item.active img').attr('srcset');
        if (srcset) {
          const entries = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
          photoUrl = entries[entries.length - 1] || photoUrl;
        }
      }
      if (!photoUrl) photoUrl = $card.find('.no-image img').attr('src') || null;

      const detailHref = $card.find('.inventory-title-wrapper a').attr('href') || '';
      const parts = titleText.split(/\s+/);
      const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parseInt(parts[0]) : null;
      const make = parts[1] || null;
      const model = parts.slice(2).join(' ') || null;
      const price = parseInt(priceText.replace(/[^0-9]/g, '')) || null;
      const mileage = parseInt(mileageText.replace(/[^0-9]/g, '')) || null;
      const externalId = detailHref.split('/').pop() || null;
      const detailUrl = detailHref.startsWith('http') ? detailHref : DEALER_BASE + detailHref;

      if (year || make) {
        vehicles.push({ year, make, model, trim: trim || null, price, mileage, photoUrl, detailUrl, externalId, vin: null });
      }
    });

    console.log(`Scraped ${vehicles.length} vehicles`);
    vehicles.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.year} ${v.make} ${v.model || ''} — $${v.price || '?'} — ${v.mileage ? v.mileage.toLocaleString() + ' mi' : 'n/a'}`);
    });

    return vehicles;
  } finally {
    await browser.close();
  }
}

async function push(vehicles) {
  const url = `${RAILWAY_URL}/api/dealer-inventory/push`;
  console.log(`Pushing ${vehicles.length} vehicles to ${url}...`);
  const { data } = await axios.post(url, { vehicles }, {
    headers: { 'Content-Type': 'application/json', 'X-Push-Secret': PUSH_SECRET },
    timeout: 30000,
  });
  console.log('Push result:', JSON.stringify(data));
  return data;
}

(async () => {
  try {
    const vehicles = await scrape();
    if (!vehicles.length) { console.error('No vehicles scraped — aborting push'); process.exit(1); }
    await push(vehicles);
    console.log(`[${new Date().toISOString()}] Sync complete`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Sync failed:`, e.message);
    process.exit(1);
  }
})();
