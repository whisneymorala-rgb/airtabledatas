require('dotenv').config();
const express = require('express');
const path = require('path');

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_ID,
  AIRTABLE_VIEW_ID,
  PORT = 3000,
} = process.env;

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
  console.error(
    'Missing required env vars. Copy .env.example to .env and fill in AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID.'
  );
  process.exit(1);
}

const AIRTABLE_API = 'https://api.airtable.com/v0';
const RECORDS_URL = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;
const META_URL = `${AIRTABLE_API}/meta/bases/${AIRTABLE_BASE_ID}/tables`;

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function airtableRequest(url, options = {}) {
  const res = await fetch(url, { ...options, headers: airtableHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Airtable request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Table schema (field names/types) if the token has schema.bases:read scope.
// Falls back gracefully if not — the frontend then infers columns from records.
app.get('/api/schema', async (req, res) => {
  try {
    const data = await airtableRequest(META_URL);
    const table = (data.tables || []).find((t) => t.id === AIRTABLE_TABLE_ID);
    if (!table) return res.json({ available: false });
    res.json({ available: true, fields: table.fields, primaryFieldId: table.primaryFieldId });
  } catch (err) {
    res.json({ available: false, reason: err.message });
  }
});

// Fetch all records (paginating through Airtable's 100-record pages).
app.get('/api/records', async (req, res) => {
  try {
    let all = [];
    let offset;
    do {
      const url = new URL(RECORDS_URL);
      if (AIRTABLE_VIEW_ID) url.searchParams.set('view', AIRTABLE_VIEW_ID);
      if (offset) url.searchParams.set('offset', offset);
      const data = await airtableRequest(url.toString());
      all = all.concat(data.records || []);
      offset = data.offset;
    } while (offset);
    res.json({ records: all });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/records', async (req, res) => {
  try {
    const data = await airtableRequest(RECORDS_URL, {
      method: 'POST',
      body: JSON.stringify({ fields: req.body.fields || {}, typecast: true }),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.patch('/api/records/:id', async (req, res) => {
  try {
    const data = await airtableRequest(`${RECORDS_URL}/${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: req.body.fields || {}, typecast: true }),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/records/:id', async (req, res) => {
  try {
    const data = await airtableRequest(`${RECORDS_URL}/${req.params.id}`, { method: 'DELETE' });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const url = new URL(RECORDS_URL);
    url.searchParams.set('maxRecords', '1');
    await airtableRequest(url.toString());
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Airtable live sheet running at http://localhost:${PORT}`);
});
