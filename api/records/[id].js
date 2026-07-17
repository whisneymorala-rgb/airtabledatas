const { recordsUrl, airtableRequest } = require('../../lib/airtable');

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const url = `${recordsUrl()}/${id}`;

    if (req.method === 'PATCH') {
      const data = await airtableRequest(url, {
        method: 'PATCH',
        body: JSON.stringify({ fields: req.body?.fields || {}, typecast: true }),
      });
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const data = await airtableRequest(url, { method: 'DELETE' });
      return res.status(200).json(data);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
