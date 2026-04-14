#!/usr/bin/env node
/**
 * Local Dealer Inventory Sync
 *
 * Scrapes gamotorsca.com/cars-for-sale from a residential IP (Mac Mini),
 * then pushes the results to the Railway app via POST /api/dealer-inventory/push.
 *
 * Usage:
 *   node scripts/sync-inventory-local.js
 *
 * Environment variables:
 *   RAILWAY_URL          — e.g. https://your-app.up.railway.app (no trailing slash)
 *   INVENTORY_PUSH_SECRET — must match the Railway app's INVENTORY_PUSH_SECRET env var
 *
 * Cron example (daily at 6am):
 *   0 6 * * * cd /path/to/car-flipper && node scripts/sync-inventory-local.js >> /tmp/inventory-sync.log 2>&1
 */

const axios = require('axios');
const cheerio = require('cheerio');

const DEALER_URL = 'https://www.gamotorsca.com/cars-for-sale';
const DEALER_BASE = 'https://www.gamotorsca.com';
const RAILWAY_URL = process.env.RAILWAY_URL;
const PUSH_SECRET = process.env.INVENTORY_PUSH_SECRET;

if (!RAILWAY_URL || !PUSH_SECRET) {
  console.error('Missing required env vars: RAILWAY_URL and INVENTORY_PUSH_SECRET');
  process.exit(1);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

async function scrape() {
  console.log(`[${new Date().toISOString()}] Fetching ${DEALER_URL}...`);
  const { data: html } = await axios.get(DEALER_URL, {
    headers: BROWSER_HEADERS,
    timeout: 20000,
  });

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

    // VIN extraction
    let vin = null;
    $card.find('.features-list .feature, .vehicle-features li, li.feature, .spec-item').each((j, feat) => {
      const text = $(feat).text().toLowerCase();
      if (text.includes('vin')) {
        const value = $(feat).find('.feature-value, .spec-value, span:last-child').text().trim();
        if (value && /^[A-HJ-NPR-Z0-9]{17}$/i.test(value)) vin = value.toUpperCase();
      }
    });
    if (!vin) vin = $card.attr('data-vin') || $card.find('[data-vin]').attr('data-vin') || null;
    if (!vin) {
      const cardHtml = $card.html() || '';
      const vinAttrMatch = cardHtml.match(/vin['":\s=]+["']?([A-HJ-NPR-Z0-9]{17})/i);
      if (vinAttrMatch) vin = vinAttrMatch[1].toUpperCase();
    }
    if (!vin) {
      const cardText = $card.text();
      const vinMatch = cardText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch) vin = vinMatch[1].toUpperCase();
    }
    if (!vin) {
      const allText = (detailHref + ' ' + (photoUrl || '')).toUpperCase();
      const urlVin = allText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (urlVin) vin = urlVin[1];
    }

    if (year || make) {
      vehicles.push({ year, make, model, trim: trim || null, price, mileage, photoUrl, detailUrl, externalId, vin });
    }
  });

  console.log(`Scraped ${vehicles.length} vehicles`);
  return vehicles;
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
