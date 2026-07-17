const AIRTABLE_API = 'https://api.airtable.com/v0';

function getConfig() {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, AIRTABLE_VIEW_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
    const err = new Error(
      'Missing AIRTABLE_TOKEN, AIRTABLE_BASE_ID, or AIRTABLE_TABLE_ID environment variables.'
    );
    err.status = 500;
    throw err;
  }
  return { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, AIRTABLE_VIEW_ID };
}

function recordsUrl() {
  const { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = getConfig();
  return `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;
}

function metaUrl() {
  const { AIRTABLE_BASE_ID } = getConfig();
  return `${AIRTABLE_API}/meta/bases/${AIRTABLE_BASE_ID}/tables`;
}

async function airtableRequest(url, options = {}) {
  const { AIRTABLE_TOKEN } = getConfig();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Airtable request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

module.exports = { getConfig, recordsUrl, metaUrl, airtableRequest };
