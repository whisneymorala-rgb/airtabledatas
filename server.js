require('dotenv').config();
const express = require('express');
const path = require('path');
const { getConfig, recordsUrl, metaUrl, airtableRequest } = require('./lib/airtable');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/schema', async (req, res) => {
  try {
    const { AIRTABLE_TABLE_ID } = getConfig();
    const data = await airtableRequest(metaUrl());
    const table = (data.tables || []).find((t) => t.id === AIRTABLE_TABLE_ID);
    if (!table) return res.json({ available: false });
    res.json({ available: true, fields: table.fields, primaryFieldId: table.primaryFieldId });
  } catch (err) {
    res.json({ available: false, reason: err.message });
  }
});

app.get('/api/records', async (req, res) => {
  try {
    const { AIRTABLE_VIEW_ID } = getConfig();
    let all = [];
    let offset;
    do {
      const url = new URL(recordsUrl());
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
    const data = await airtableRequest(recordsUrl(), {
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
    const data = await airtableRequest(`${recordsUrl()}/${req.params.id}`, {
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
    const data = await airtableRequest(`${recordsUrl()}/${req.params.id}`, { method: 'DELETE' });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const url = new URL(recordsUrl());
    url.searchParams.set('maxRecords', '1');
    await airtableRequest(url.toString());
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// Only listen on a port for local `npm start` — on Vercel the app is
// invoked as a serverless function per-request, and calling app.listen()
// there would do nothing useful (and once did nothing harmful, but it's
// not the entry point Vercel actually uses).
if (!process.env.VERCEL) {
  const { PORT = 3000 } = process.env;
  app.listen(PORT, () => {
    console.log(`Airtable live sheet running at http://localhost:${PORT}`);
  });
}

module.exports = app;
