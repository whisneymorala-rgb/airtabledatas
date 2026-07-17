const { recordsUrl, airtableRequest } = require('../lib/airtable');

module.exports = async (req, res) => {
  try {
    const url = new URL(recordsUrl());
    url.searchParams.set('maxRecords', '1');
    await airtableRequest(url.toString());
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
};
