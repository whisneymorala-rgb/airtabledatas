const POLL_MS = 4000;

const READONLY_TYPES = new Set([
  'formula',
  'rollup',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'button',
  'multipleAttachments',
  'multipleRecordLinks',
  'multipleLookupValues',
  'aiText',
  'barcode',
  'externalSyncSource',
]);

const state = {
  columns: [], // [{key, name, type, choices, editable}]
  records: [], // [{id, fields}]
  schemaAvailable: false,
};

const el = {
  status: document.getElementById('status'),
  headerRow: document.getElementById('headerRow'),
  bodyRows: document.getElementById('bodyRows'),
  addRowBtn: document.getElementById('addRowBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  errorBanner: document.getElementById('errorBanner'),
  emptyState: document.getElementById('emptyState'),
  table: document.getElementById('sheet'),
};

function setStatus(kind, text) {
  el.status.className = `status status-${kind}`;
  el.status.innerHTML = `<span class="status-dot"></span>${text}`;
}

function showError(msg) {
  if (!msg) {
    el.errorBanner.classList.add('hidden');
    return;
  }
  el.errorBanner.textContent = msg;
  el.errorBanner.classList.remove('hidden');
}

function activeCellKey() {
  const active = document.activeElement;
  if (!active || !active.dataset || !active.dataset.recordId) return null;
  return `${active.dataset.recordId}::${active.dataset.field}`;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function loadSchema() {
  const data = await api('/api/schema');
  if (data.available && Array.isArray(data.fields)) {
    state.schemaAvailable = true;
    state.columns = data.fields.map((f) => ({
      key: f.name,
      name: f.name,
      type: f.type,
      choices: f.options?.choices?.map((c) => c.name) || null,
      editable: !READONLY_TYPES.has(f.type),
    }));
  } else {
    state.schemaAvailable = false;
    state.columns = []; // will be inferred from records
  }
}

function inferColumnsFromRecords() {
  const seen = new Set(state.columns.map((c) => c.key));
  for (const rec of state.records) {
    for (const key of Object.keys(rec.fields || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        state.columns.push({ key, name: key, type: 'singleLineText', choices: null, editable: true });
      }
    }
  }
}

async function loadRecords() {
  const data = await api('/api/records');
  state.records = data.records || [];
  if (!state.schemaAvailable) inferColumnsFromRecords();
}

function cellInput(rec, col) {
  const value = rec.fields[col.key];

  if (!col.editable) {
    const display = Array.isArray(value) ? value.join(', ') : value ?? '';
    const td = document.createElement('td');
    td.className = 'readonly';
    td.textContent = display;
    return td;
  }

  const td = document.createElement('td');
  let input;

  if (col.type === 'checkbox') {
    td.className = 'checkbox-cell';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.addEventListener('change', () => commitCell(rec.id, col.key, input.checked));
  } else if (col.type === 'singleSelect' && col.choices) {
    input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    input.appendChild(blank);
    for (const choice of col.choices) {
      const opt = document.createElement('option');
      opt.value = choice;
      opt.textContent = choice;
      if (choice === value) opt.selected = true;
      input.appendChild(opt);
    }
    input.addEventListener('change', () => commitCell(rec.id, col.key, input.value || null));
  } else if (['number', 'currency', 'percent', 'rating', 'duration'].includes(col.type)) {
    input = document.createElement('input');
    input.type = 'number';
    input.value = value ?? '';
    input.addEventListener('blur', () => {
      const num = input.value === '' ? null : Number(input.value);
      commitCell(rec.id, col.key, num);
    });
  } else if (col.type === 'multilineText') {
    input = document.createElement('textarea');
    input.rows = 1;
    input.value = value ?? '';
    input.addEventListener('blur', () => commitCell(rec.id, col.key, input.value));
  } else if (col.type === 'date' || col.type === 'dateTime') {
    input = document.createElement('input');
    input.type = col.type === 'dateTime' ? 'datetime-local' : 'date';
    input.value = value ? value.slice(0, col.type === 'dateTime' ? 16 : 10) : '';
    input.addEventListener('change', () => commitCell(rec.id, col.key, input.value || null));
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
    input.addEventListener('blur', () => commitCell(rec.id, col.key, input.value));
  }

  input.dataset.recordId = rec.id;
  input.dataset.field = col.key;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.tagName !== 'TEXTAREA') input.blur();
  });

  td.appendChild(input);
  return td;
}

function render() {
  const hasColumns = state.columns.length > 0;
  el.table.classList.toggle('hidden', !hasColumns);
  el.emptyState.classList.toggle('hidden', hasColumns);
  if (!hasColumns) return;

  el.headerRow.innerHTML = '';
  for (const col of state.columns) {
    const th = document.createElement('th');
    th.textContent = col.name;
    el.headerRow.appendChild(th);
  }
  const actionsTh = document.createElement('th');
  actionsTh.textContent = '';
  el.headerRow.appendChild(actionsTh);

  const focusKey = activeCellKey();
  const caretPos = document.activeElement?.selectionStart;

  el.bodyRows.innerHTML = '';
  for (const rec of state.records) {
    const tr = document.createElement('tr');
    for (const col of state.columns) {
      tr.appendChild(cellInput(rec, col));
    }
    const actionsTd = document.createElement('td');
    actionsTd.className = 'row-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete row';
    delBtn.addEventListener('click', () => deleteRow(rec.id));
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    el.bodyRows.appendChild(tr);
  }

  if (focusKey) {
    const [recordId, field] = focusKey.split('::');
    const toFocus = el.bodyRows.querySelector(
      `[data-record-id="${CSS.escape(recordId)}"][data-field="${CSS.escape(field)}"]`
    );
    if (toFocus) {
      toFocus.focus();
      if (typeof caretPos === 'number' && toFocus.setSelectionRange) {
        try { toFocus.setSelectionRange(caretPos, caretPos); } catch (_) {}
      }
    }
  }
}

async function commitCell(recordId, field, value) {
  const rec = state.records.find((r) => r.id === recordId);
  if (rec) rec.fields[field] = value;
  setStatus('saving', 'Saving…');
  try {
    const updated = await api(`/api/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [field]: value } }),
    });
    if (rec) rec.fields = updated.fields;
    setStatus('synced', 'Synced');
    showError(null);
  } catch (err) {
    setStatus('error', 'Save failed');
    showError(`Could not save "${field}": ${err.message}`);
  }
}

async function addRow() {
  try {
    const created = await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({ fields: {} }),
    });
    state.records.push(created);
    render();
  } catch (err) {
    showError(`Could not add row: ${err.message}`);
  }
}

async function deleteRow(recordId) {
  if (!confirm('Delete this row from Airtable?')) return;
  try {
    await api(`/api/records/${recordId}`, { method: 'DELETE' });
    state.records = state.records.filter((r) => r.id !== recordId);
    render();
  } catch (err) {
    showError(`Could not delete row: ${err.message}`);
  }
}

async function poll() {
  try {
    const data = await api('/api/records');
    const incoming = data.records || [];
    const editing = activeCellKey();
    const editingRecordId = editing ? editing.split('::')[0] : null;

    if (!state.schemaAvailable) {
      const before = state.columns.length;
      state.records = incoming;
      inferColumnsFromRecords();
      if (state.columns.length !== before) {
        render();
        setStatus('synced', 'Synced');
        return;
      }
    }

    if (editingRecordId) {
      // Don't clobber the row currently being typed into — merge other rows only.
      const editingRec = state.records.find((r) => r.id === editingRecordId);
      state.records = incoming.map((r) => (r.id === editingRecordId && editingRec ? editingRec : r));
    } else {
      state.records = incoming;
    }
    render();
    setStatus('synced', 'Synced');
    showError(null);
  } catch (err) {
    setStatus('error', 'Offline');
    showError(`Lost connection to Airtable: ${err.message}`);
  }
}

el.addRowBtn.addEventListener('click', addRow);
el.refreshBtn.addEventListener('click', poll);

(async function init() {
  try {
    await loadSchema();
    await loadRecords();
    render();
    setStatus('synced', 'Synced');
  } catch (err) {
    setStatus('error', 'Error');
    showError(`Startup failed: ${err.message}`);
  }
  setInterval(poll, POLL_MS);
})();
