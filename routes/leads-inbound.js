/**
 * Car Flipper — CarGurus Inbound Email Parser + CSV Import
 *
 * POST /api/leads/inbound/cargurus  — SendGrid Inbound Parse webhook (no JWT)
 * POST /api/leads/inbound/test      — Test parser with raw HTML (JWT required)
 * POST /api/leads/import/csv        — Bulk CSV import (JWT required)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');
const db = require('../database');
const authenticate = require('../middleware/auth');

// In-memory store for last few inbound emails (for verification debugging)
const lastEmails = [];
router.get('/lastmail', (req, res) => {
  // Show only the verification link for easy clicking — no auth needed
  const emails = lastEmails.slice(-3).map(e => ({
    from: e.from, subject: e.subject, ts: e.ts,
    links: (e.text.match(/https:\/\/mail[^\s\r\n]+google\.com\/mail[^\s\r\n]+/g) || []),
    preview: e.text.substring(0, 1500)
  }));
  res.json(emails);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const parseMultipart = multer().none(); // Parse SendGrid multipart/form-data fields (no files)

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Parse ADF/XML format (CarGurus XML leads)
function parseCarGurusXml(xml) {
  const result = {};
  const tag = (name, str) => {
    const re = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i');
    const m = str.match(re); return m ? m[1].trim() : null;
  };
  const attr = (tagName, attrName, str) => {
    const re = new RegExp(`<${tagName}[^>]*${attrName}=['"]([^'"]*)['"][^>]*>`, 'i');
    const m = str.match(re); return m ? m[1].trim() : null;
  };

  // Name
  const firstName = (() => { const re = /<name[^>]*part=['"]first['"][^>]*>([^<]*)<\/name>/i; const m = xml.match(re); return m ? m[1].trim() : ''; })();
  const lastName = (() => { const re = /<name[^>]*part=['"]last['"][^>]*>([^<]*)<\/name>/i; const m = xml.match(re); return m ? m[1].trim() : ''; })();
  result.name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

  // Contact
  result.phone = tag('phone', xml);
  result.email = tag('email', xml);
  result.customer_zip = tag('postalcode', xml);

  // Vehicle (in <vehicle> block)
  const vehicleBlock = xml.match(/<vehicle[\s\S]*?<\/vehicle>/i)?.[0] || xml;
  const vinMatch = vehicleBlock.match(/<id[^>]*>([A-HJ-NPR-Z0-9]{17})<\/id>/i);
  result.vehicle_vin = vinMatch ? vinMatch[1] : null;
  const yearStr = tag('year', vehicleBlock);
  result.vehicle_year = yearStr ? parseInt(yearStr) : null;
  result.vehicle_make = tag('make', vehicleBlock);
  result.vehicle_model = tag('model', vehicleBlock);
  result.vehicle_trim = tag('trim', vehicleBlock);
  const priceStr = tag('price', vehicleBlock) || tag('amount', vehicleBlock);
  result.listed_price = priceStr ? `$${parseFloat(priceStr).toLocaleString()}` : null;

  // Stock number
  const stockMatch = vehicleBlock.match(/<id[^>]*source=['"][^'"]*['"][^>]*>([^<]*)<\/id>/i);
  result.vehicle_stock_number = stockMatch ? stockMatch[1].replace(/[^a-zA-Z0-9_-]/g,'') : null;

  // Lead date from requestdate
  const dateMatch = xml.match(/<requestdate>([^T<]+)/i);
  if (dateMatch) {
    try { result.lead_date = new Date(dateMatch[1]).toISOString().substring(0,10); }
    catch(e) { result.lead_date = null; }
  }

  // Transaction/CG ID
  const cgIdMatch = xml.match(/<id[^>]*source=['"]CarGurus['"][^>]*>([^<]+)<\/id>/i);
  result.cargurus_transaction_id = cgIdMatch ? cgIdMatch[1].trim() : null;

  // Comments/description
  result.comments = tag('description', xml) || tag('comments', xml);

  return result;
}

function parseCarGurusHtml(html) {
  // Simple regex-based parser — no cheerio dependency issue
  const result = {};

  // Extract text content, stripping tags
  const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // Extract field value after bold label
  const field = (label) => {
    const re = new RegExp(`<b[^>]*>\\s*${label}\\s*</b>\\s*:?\\s*([^<]+)`, 'i');
    const m = html.match(re);
    return m ? strip(m[1]).replace(/^:\s*/, '').trim() : null;
  };

  // Also try strong tags
  const fieldAlt = (label) => {
    const re = new RegExp(`<strong[^>]*>\\s*${label}\\s*</strong>\\s*:?\\s*([^<]+)`, 'i');
    const m = html.match(re);
    return m ? strip(m[1]).replace(/^:\s*/, '').trim() : null;
  };

  const get = (label) => field(label) || fieldAlt(label);

  const firstName = get('First Name') || '';
  const lastName = get('Last Name') || '';
  result.name = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  result.phone = get('Telephone') || get('Phone') || null;

  // Email — try mailto link first, then text
  const emailHrefMatch = html.match(/href=['"]mailto:([^'">\s]+)['"]/i);
  result.email = emailHrefMatch ? emailHrefMatch[1] : get('Email');

  result.customer_zip = get('ZIP code') || get('ZIP') || null;
  result.vehicle_vin = get('VIN') || null;

  // Vehicle: "2013 Honda Accord EX-L with Nav"
  const vehicleStr = get('Vehicle') || '';
  if (vehicleStr) {
    const parts = vehicleStr.split(/\s+/);
    result.vehicle_year = parts[0] && /^\d{4}$/.test(parts[0]) ? parseInt(parts[0]) : null;
    result.vehicle_make = parts[1] || null;
    result.vehicle_model = parts[2] || null;
    result.vehicle_trim = parts.slice(3).join(' ') || null;
  }

  const stockRaw = get('Stock Number') || get('Stock #') || null;
  result.vehicle_stock_number = stockRaw && stockRaw.toLowerCase() !== 'n/a' ? stockRaw : null;

  result.listed_price = get('Listed Price') || null;

  // Lead Date — "Sent by CarGurus on April 10, 2026 at 8:30 AM PDT"
  const leadDateMatch = html.match(/Sent by CarGurus on ([A-Za-z]+ \d+,\s*\d{4})/i);
  if (leadDateMatch) {
    try {
      const d = new Date(leadDateMatch[1]);
      result.lead_date = d.toISOString().substring(0, 10);
    } catch (e) { result.lead_date = null; }
  }

  // Transaction ID
  const txMatch = html.match(/Transaction ID[:\s]+([A-Za-z0-9_\-]+)/i);
  result.cargurus_transaction_id = txMatch ? txMatch[1].trim() : null;

  // CarGurus listing URL
  const urlMatch = html.match(/href=['"]([^'"]+cargurus\.com[^'"]+)['"]/i);
  result.cargurus_listing_url = urlMatch ? urlMatch[1] : null;

  // Comments — text between "Comments" label and next section
  const commentsMatch = html.match(/Comments[^:]*:?\s*<\/b>\s*([\s\S]*?)(?=<b>|<strong>|$)/i)
    || html.match(/Comments[^:]*:?\s*<\/strong>\s*([\s\S]*?)(?=<b>|<strong>|$)/i);
  result.comments = commentsMatch ? strip(commentsMatch[1]).replace(/^:\s*/, '').trim() : null;

  return result;
}

async function createCarGurusLead(parsed, orgId) {
  // Dedup: check for existing lead with same phone or email
  let existingId = null;
  if (parsed.phone || parsed.email) {
    const conditions = [];
    const params = [orgId];
    let pi = 2;
    if (parsed.phone) { conditions.push(`phone = $${pi++}`); params.push(parsed.phone); }
    if (parsed.email) { conditions.push(`email = $${pi++}`); params.push(parsed.email); }
    const dupSql = `SELECT id FROM leads WHERE org_id = $1 AND (${conditions.join(' OR ')}) LIMIT 1`;
    const dup = await db.query(dupSql, params);
    if (dup.rows.length) existingId = dup.rows[0].id;
  }

  if (existingId) {
    // Update contact info, set reengaged status, update lead_date to now
    const nowExpr = db.isPg ? 'NOW()' : "datetime('now')";
    const todayExpr = db.isPg ? 'CURRENT_DATE::text' : "date('now')";
    await db.query(`UPDATE leads SET name = $1, phone = COALESCE($2, phone), email = COALESCE($3, email), status = 'reengaged', lead_date = ${todayExpr}, updated_at = ${nowExpr} WHERE id = $4`,
      [parsed.name || 'Unknown', parsed.phone, parsed.email, existingId]);
    // Add vehicle of interest
    if (parsed.vehicle_make || parsed.vehicle_model || parsed.vehicle_vin) {
      await db.query(
        `INSERT INTO lead_vehicles (id, lead_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number, listed_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uuidv4(), existingId, parsed.vehicle_year, parsed.vehicle_make, parsed.vehicle_model,
         parsed.vehicle_trim, parsed.vehicle_vin, parsed.vehicle_stock_number, parsed.listed_price]
      );
    }
    if (parsed.comments) {
      await db.query('INSERT INTO lead_notes (id, lead_id, user_id, content) VALUES ($1,$2,NULL,$3)',
        [uuidv4(), existingId, `[CarGurus Auto-Import] Customer comment: ${parsed.comments}`]);
    }
    const veh = [parsed.vehicle_year, parsed.vehicle_make, parsed.vehicle_model].filter(Boolean).join(' ') || 'no vehicle info';
    await db.query('INSERT INTO lead_activities (id, lead_id, user_id, activity_type, description) VALUES ($1,$2,NULL,$3,$4)',
      [uuidv4(), existingId, 'note', `New CarGurus inquiry merged — ${veh}`]);
    return existingId;
  }

  const id = uuidv4();

  await db.query(
    `INSERT INTO leads (id, org_id, name, phone, email, source, status, customer_zip,
     vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number,
     lead_date, listed_price, cargurus_transaction_id, cargurus_listing_url)
     VALUES ($1,$2,$3,$4,$5,'cargurus','new',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, orgId, parsed.name || 'Unknown', parsed.phone, parsed.email, parsed.customer_zip,
     parsed.vehicle_year, parsed.vehicle_make, parsed.vehicle_model, parsed.vehicle_trim,
     parsed.vehicle_vin, parsed.vehicle_stock_number, parsed.lead_date, parsed.listed_price,
     parsed.cargurus_transaction_id, parsed.cargurus_listing_url]
  );

  // Also insert into lead_vehicles
  if (parsed.vehicle_make || parsed.vehicle_model || parsed.vehicle_vin) {
    await db.query(
      `INSERT INTO lead_vehicles (id, lead_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number, listed_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv4(), id, parsed.vehicle_year, parsed.vehicle_make, parsed.vehicle_model,
       parsed.vehicle_trim, parsed.vehicle_vin, parsed.vehicle_stock_number, parsed.listed_price]
    );
  }

  // First note from comments
  if (parsed.comments) {
    const noteId = uuidv4();
    await db.query(
      'INSERT INTO lead_notes (id, lead_id, user_id, content) VALUES ($1,$2,NULL,$3)',
      [noteId, id, `[CarGurus Auto-Import] Customer comment: ${parsed.comments}`]
    );
  }

  // Activity
  const actId = uuidv4();
  await db.query(
    'INSERT INTO lead_activities (id, lead_id, user_id, activity_type, description) VALUES ($1,$2,NULL,$3,$4)',
    [actId, id, 'note', 'Lead auto-imported from CarGurus']
  );

  return id;
}

// ─────────────────────────────────────────────────────────────
// POST /api/leads/inbound/cargurus  (no JWT — SendGrid webhook)
// ─────────────────────────────────────────────────────────────
router.post('/cargurus', parseMultipart, async (req, res) => {
  try {
    const secret = process.env.SENDGRID_WEBHOOK_SECRET;
    if (secret && req.query.secret !== secret) {
      return res.status(401).send('Unauthorized');
    }

    const from = req.body.from || '';
    const subject = req.body.subject || '';
    const html = req.body.html || req.body.text || '';

    // Log + store ALL inbound emails for debugging
    const emailSnap = { from, subject, text: (req.body.text||'').substring(0, 2000), ts: new Date().toISOString() };
    lastEmails.push(emailSnap); if (lastEmails.length > 5) lastEmails.shift();
    console.log('=== INBOUND EMAIL ===', 'From:', from, 'Subject:', subject, 'Text preview:', (req.body.text||'').substring(0,500));

    // Validate sender + subject
    if (!from.includes('cargurus.com') || !subject.toLowerCase().includes('lead submission')) {
      console.log('Inbound email ignored — not a CarGurus lead. From:', from, 'Subject:', subject);
      return res.status(200).send('OK');
    }

    // Auto-detect XML (ADF format) vs HTML
    const isXml = html.trim().startsWith('<?xml') || html.includes('<adf') || html.includes('<prospect');
    const parsed = isXml ? parseCarGurusXml(html) : parseCarGurusHtml(html);
    console.log('Parser:', isXml ? 'XML/ADF' : 'HTML', '| Name:', parsed.name, '|', parsed.vehicle_year, parsed.vehicle_make, parsed.vehicle_model);

    // Deduplication
    if (parsed.cargurus_transaction_id) {
      const existing = await db.query(
        'SELECT id FROM leads WHERE cargurus_transaction_id = $1', [parsed.cargurus_transaction_id]
      );
      if (existing.rows.length) {
        console.log('Duplicate CarGurus lead skipped. TxID:', parsed.cargurus_transaction_id);
        return res.status(200).send('OK');
      }
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      console.error('DEFAULT_ORG_ID env var not set — cannot import lead');
      return res.status(200).send('OK');
    }

    const leadId = await createCarGurusLead(parsed, orgId);
    console.log('CarGurus lead imported:', leadId, parsed.name);
    res.status(200).send('OK');
  } catch (e) {
    console.error('CarGurus inbound parse error:', e.message, e.stack);
    res.status(200).send('OK'); // Always 200 so SendGrid doesn't retry
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/leads/inbound/test  (JWT required — test parser)
// ─────────────────────────────────────────────────────────────
router.post('/test', authenticate, express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'html field required' });
    const isXml = html.trim().startsWith('<?xml') || html.includes('<adf') || html.includes('<prospect');
    const parsed = isXml ? parseCarGurusXml(html) : parseCarGurusHtml(html);
    res.json({ parsed, format: isXml ? 'xml/adf' : 'html', preview: 'Parse-only — no lead created' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/leads/import/csv  (JWT required — bulk import)
// ─────────────────────────────────────────────────────────────
router.post('/csv', authenticate, upload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });

  let records;
  try {
    records = csvParse(req.file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    return res.status(400).json({ error: 'CSV parse error: ' + e.message });
  }

  const orgId = req.user.orgId;
  const total = records.length;
  let imported = 0, skipped = 0;
  const errors = [];

  // Process in chunks of 50
  const CHUNK = 50;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    for (const [idx, row] of chunk.entries()) {
      const rowNum = i + idx + 2; // 1-indexed, +1 for header
      try {
        const firstName = (row.first_name || '').trim();
        const lastName = (row.last_name || '').trim();
        const name = [firstName, lastName].filter(Boolean).join(' ') || row.name?.trim();
        if (!name) { errors.push({ row: rowNum, reason: 'Missing name (first_name or last_name required)' }); skipped++; continue; }

        const phone = row.phone?.trim() || null;
        const email = row.email?.trim() || null;
        const vin = row.vehicle_vin?.trim() || null;

        const yearRaw = parseInt(row.vehicle_year) || null;
        const leadDate = row.lead_date?.trim() || null;
        const source = row.source?.trim() || 'other';
        const make = row.vehicle_make?.trim()||null;
        const model = row.vehicle_model?.trim()||null;
        const trim = row.vehicle_trim?.trim()||null;
        const stockNum = row.stock_number?.trim()||null;

        // Dedup: check for existing lead with same phone or email
        let existingId = null;
        if (phone || email) {
          const conditions = [];
          const params = [orgId];
          let pi = 2;
          if (phone) { conditions.push(`phone = $${pi++}`); params.push(phone); }
          if (email) { conditions.push(`email = $${pi++}`); params.push(email); }
          const dupSql = `SELECT id FROM leads WHERE org_id = $1 AND (${conditions.join(' OR ')}) LIMIT 1`;
          const dup = await db.query(dupSql, params);
          if (dup.rows.length) existingId = dup.rows[0].id;
        }

        let leadId;
        if (existingId) {
          leadId = existingId;
          // Update contact info, set reengaged status, update lead_date to now
          const nowExpr = db.isPg ? 'NOW()' : "datetime('now')";
          const todayExpr = db.isPg ? 'CURRENT_DATE::text' : "date('now')";
          await db.query(`UPDATE leads SET name = $1, phone = COALESCE($2, phone), email = COALESCE($3, email), status = 'reengaged', lead_date = ${todayExpr}, updated_at = ${nowExpr} WHERE id = $4`,
            [name, phone, email, existingId]);
          if (make || model || vin) {
            await db.query(
              `INSERT INTO lead_vehicles (id, lead_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [uuidv4(), existingId, yearRaw, make, model, trim, vin, stockNum]
            );
          }
          await db.query('INSERT INTO lead_activities (id, lead_id, user_id, activity_type, description) VALUES ($1,$2,$3,$4,$5)',
            [uuidv4(), existingId, req.user.userId, 'note', `CSV inquiry merged — ${[yearRaw, make, model].filter(Boolean).join(' ') || 'no vehicle info'}`]);
          imported++;
        } else {
          leadId = uuidv4();
          await db.query(
            `INSERT INTO leads (id, org_id, name, phone, email, source, status, vehicle_year, vehicle_make,
             vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number, lead_date)
             VALUES ($1,$2,$3,$4,$5,$6,'new',$7,$8,$9,$10,$11,$12,$13)`,
            [leadId, orgId, name, phone, email, source, yearRaw, make, model, trim, vin, stockNum, leadDate]
          );
          if (make || model || vin) {
            await db.query(
              `INSERT INTO lead_vehicles (id, lead_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_vin, vehicle_stock_number)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [uuidv4(), leadId, yearRaw, make, model, trim, vin, stockNum]
            );
          }
          // Activity
          await db.query('INSERT INTO lead_activities (id, lead_id, user_id, activity_type, description) VALUES ($1,$2,$3,$4,$5)',
            [uuidv4(), leadId, req.user.userId, 'note', 'Lead imported via CSV']);
          imported++;
        }

        // Comments → note
        const comments = row.comments?.trim();
        if (comments) {
          await db.query('INSERT INTO lead_notes (id, lead_id, user_id, content) VALUES ($1,$2,$3,$4)',
            [uuidv4(), leadId, req.user.userId, comments]);
        }
      } catch (e) {
        errors.push({ row: rowNum, reason: e.message });
        skipped++;
      }
    }
  }

  res.json({ total, imported, skipped, errors: errors.slice(0, 200) });
});

// GET /api/leads/inbound/status — confirm endpoint is live
router.get('/status', authenticate, (req, res) => {
  res.json({ ok: true, message: 'CarGurus inbound parser ready', defaultOrgSet: !!process.env.DEFAULT_ORG_ID });
});

// Temporary: catch ALL inbound emails and log them (for Gmail forwarding verification)
router.post('/debug', express.urlencoded({ extended: true }), (req, res) => {
  const from = req.body.from || '';
  const subject = req.body.subject || '';
  const text = req.body.text || req.body.html || '';
  console.log('=== INBOUND DEBUG EMAIL ===');
  console.log('From:', from);
  console.log('Subject:', subject);
  console.log('Text (first 1000):', text.substring(0, 1000));
  console.log('=========================');
  res.status(200).send('OK');
});

module.exports = router;
