# Airtable Live Sheet

A small local web app that gives you a spreadsheet-style grid backed directly by an
Airtable table:

- Anything you type into the grid is saved straight to Airtable (on blur / Enter / checkbox toggle).
- Every few seconds it polls Airtable and pulls in any changes made directly in Airtable
  (rows added, edited, or deleted there show up in the grid automatically).

It runs on your own machine — nothing is deployed or hosted for you.

## ⚠️ About your API token

Airtable Personal Access Tokens are secrets — anyone with your token can read/write your
base. Because this token was pasted into a chat, treat it as exposed:

1. Go to <https://airtable.com/create/tokens>, revoke/delete the old token, and create a
   new one scoped to just this base with `data.records:read`, `data.records:write`
   (and `schema.bases:read` if you want column types/dropdowns detected automatically).
2. Use the **new** token below, not the one you originally shared.

The token is only ever read from a local `.env` file by the server — it's never sent to
the browser and `.env` is git-ignored, so it won't get committed.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in:

```
AIRTABLE_TOKEN=your_new_token_here
AIRTABLE_BASE_ID=app7AEsZy6fX24otc
AIRTABLE_TABLE_ID=tbl17k7ALHJLJlz9H
AIRTABLE_VIEW_ID=viwUCarO8zuKEpooR
```

(The base/table/view IDs above are pre-filled from the Airtable URL you shared. Only
change them if you point this at a different table.)

## Run

```bash
npm start
```

Then open <http://localhost:3000>.

## Notes

- Columns are read from Airtable's schema when your token has `schema.bases:read`
  scope (gives you proper dropdowns for single-select fields, checkboxes, date pickers,
  etc.). Without that scope, columns are inferred from whatever fields already exist on
  your records and edited as plain text.
- Computed/read-only Airtable field types (formulas, rollups, linked records,
  attachments, auto-number, created/modified time, etc.) are shown but not editable in
  the grid, since they can't be written directly via the API.
- Polling runs every 4 seconds. It won't overwrite a cell you're actively typing in.
- Deleting a row in the grid deletes the record in Airtable — it asks for confirmation
  first.
