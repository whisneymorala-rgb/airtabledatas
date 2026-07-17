const { getConfig, metaUrl, airtableRequest } = require('../lib/airtable');

module.exports = async (req, res) => {
  try {
    const { AIRTABLE_TABLE_ID } = getConfig();
    const data = await airtableRequest(metaUrl());
    const table = (data.tables || []).find((t) => t.id === AIRTABLE_TABLE_ID);
    if (!table) return res.status(200).json({ available: false });
    res.status(200).json({ available: true, fields: table.fields, primaryFieldId: table.primaryFieldId });
  } catch (err) {
    // Missing schema.bases:read scope, or any other lookup failure — the
    // frontend falls back to inferring columns from records, so this is
    // reported as a soft failure rather than an HTTP error.
    res.status(200).json({ available: false, reason: err.message });
  }
};
