const { getConfig, recordsUrl, airtableRequest } = require('../../lib/airtable');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
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
      return res.status(200).json({ records: all });
    }

    if (req.method === 'POST') {
      const data = await airtableRequest(recordsUrl(), {
        method: 'POST',
        body: JSON.stringify({ fields: req.body?.fields || {}, typecast: true }),
      });
      return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
