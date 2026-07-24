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

const RECENTLY_DELETED_KEY = 'airtableLiveSheet.recentlyDeleted';
const MAX_RECENTLY_DELETED = 15;
const HISTORY_KEY = 'airtableLiveSheet.history';
const MAX_HISTORY = 200;

const state = {
  columns: [], // [{id, key, name, type, choices, editable}]
  records: [], // [{id, fields}]
  schemaAvailable: false,
  primaryFieldId: null,
  filterCols: { name: null, status: null, completion: null, trend: null, lastActivity: null },
  filters: { search: '', status: '', completion: '', trend: '' },
  recentlyDeleted: [], // [{fields, label, deletedAt}], most recent first
  history: [], // [{type, label, field, oldValue, newValue, at}], most recent first
};

const el = {
  status: document.getElementById('status'),
  headerRow: document.getElementById('headerRow'),
  bodyRows: document.getElementById('bodyRows'),
  addRowBtn: document.getElementById('addRowBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  themeToggle: document.getElementById('themeToggle'),
  errorBanner: document.getElementById('errorBanner'),
  emptyState: document.getElementById('emptyState'),
  table: document.getElementById('sheet'),
  searchWrap: document.getElementById('searchWrap'),
  searchInput: document.getElementById('searchInput'),
  statusFilterWrap: document.getElementById('statusFilterWrap'),
  statusFilter: document.getElementById('statusFilter'),
  completionFilterWrap: document.getElementById('completionFilterWrap'),
  completionFilter: document.getElementById('completionFilter'),
  trendFilterWrap: document.getElementById('trendFilterWrap'),
  trendFilter: document.getElementById('trendFilter'),
  undoBtn: document.getElementById('undoBtn'),
  undoPanel: document.getElementById('undoPanel'),
  undoToast: document.getElementById('undoToast'),
  historyBtn: document.getElementById('historyBtn'),
  historyPanel: document.getElementById('historyPanel'),
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
    state.primaryFieldId = data.primaryFieldId || null;
    state.columns = data.fields.map((f) => ({
      id: f.id,
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
        state.columns.push({ id: null, key, name: key, type: 'singleLineText', choices: null, editable: true });
      }
    }
  }
}

async function loadRecords() {
  const data = await api('/api/records');
  state.records = data.records || [];
  if (!state.schemaAvailable) inferColumnsFromRecords();
}

// --- Filter/badge/activity column detection -------------------------------

function findColumn(regex) {
  return state.columns.find((c) => regex.test(c.name)) || null;
}

function computeFilterColumns() {
  const primaryCol = state.primaryFieldId ? state.columns.find((c) => c.id === state.primaryFieldId) : null;
  state.filterCols = {
    name: findColumn(/student.*name/i) || primaryCol || state.columns[0] || null,
    status: findColumn(/^status$/i) || findColumn(/status/i),
    completion: findColumn(/percent/i) || findColumn(/complet/i),
    trend: findColumn(/trend/i),
    lastActivity: findColumn(/last.*activity/i),
  };
}

function fillSelect(selectEl, values, allLabel) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = allLabel;
  selectEl.appendChild(allOpt);
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
  if (values.includes(current)) selectEl.value = current;
}

function uniqueValues(col) {
  if (col.choices) return col.choices;
  return [...new Set(state.records.map((r) => r.fields[col.key]).filter((v) => v != null && v !== ''))].sort();
}

function populateFilterOptions() {
  el.searchWrap.classList.toggle('hidden', !state.filterCols.name);

  if (state.filterCols.status) {
    fillSelect(el.statusFilter, uniqueValues(state.filterCols.status), 'All statuses');
    el.statusFilterWrap.classList.remove('hidden');
  } else {
    el.statusFilterWrap.classList.add('hidden');
  }

  el.completionFilterWrap.classList.toggle('hidden', !state.filterCols.completion);

  if (state.filterCols.trend) {
    fillSelect(el.trendFilter, uniqueValues(state.filterCols.trend), 'All trends');
    el.trendFilterWrap.classList.remove('hidden');
  } else {
    el.trendFilterWrap.classList.add('hidden');
  }
}

function matchesFilters(rec) {
  const f = state.filters;
  const cols = state.filterCols;

  if (f.search && cols.name) {
    const val = String(rec.fields[cols.name.key] ?? '').toLowerCase();
    if (!val.includes(f.search.toLowerCase())) return false;
  }
  if (f.status && cols.status) {
    if ((rec.fields[cols.status.key] ?? '') !== f.status) return false;
  }
  if (f.trend && cols.trend) {
    if ((rec.fields[cols.trend.key] ?? '') !== f.trend) return false;
  }
  if (f.completion && cols.completion) {
    const raw = rec.fields[cols.completion.key];
    if (raw == null || raw === '') return false;
    const pct = cols.completion.type === 'percent' ? Number(raw) * 100 : Number(raw);
    const [min, max] = f.completion.split('-').map(Number);
    if (Number.isNaN(pct) || pct < min || pct > max) return false;
  }
  return true;
}

// --- Status badge + activity dot helpers -----------------------------------

function statusBadgeClass(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('at-risk') || v.includes('at risk')) return 'badge-red';
  if (v.includes('inactive')) return 'badge-yellow';
  if (v.includes('complet')) return 'badge-blue';
  if (v.includes('active')) return 'badge-green';
  return 'badge-neutral';
}

function activityDotClass(dateStr) {
  if (!dateStr) return 'dot-red';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'dot-red';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const activityDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (activityDay.getTime() === startOfToday.getTime()) return 'dot-green';
  if (activityDay >= startOfWeek) return 'dot-yellow';
  return 'dot-red';
}

function activityDotTitle(cls) {
  if (cls === 'dot-green') return 'Active today';
  if (cls === 'dot-yellow') return 'Active this week';
  return 'No activity this week';
}

// --- Rendering ---------------------------------------------------------

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
    // Airtable's API returns percent fields as a 0–1 decimal; show/edit as 0–100.
    const isPercent = col.type === 'percent';
    input = document.createElement('input');
    input.type = 'number';
    if (isPercent) input.step = '0.1';
    input.value = value == null || value === '' ? '' : isPercent ? Math.round(value * 1000) / 10 : value;
    input.addEventListener('blur', () => {
      if (input.value === '') return commitCell(rec.id, col.key, null);
      const num = Number(input.value);
      commitCell(rec.id, col.key, isPercent ? num / 100 : num);
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

  // Status column: style the dropdown as a colored badge instead of plain text.
  if (col === state.filterCols.status && input.tagName === 'SELECT') {
    const applyBadge = () => {
      input.classList.remove('badge-green', 'badge-yellow', 'badge-blue', 'badge-red', 'badge-neutral');
      input.classList.add('status-badge', statusBadgeClass(input.value));
    };
    applyBadge();
    input.addEventListener('change', applyBadge);
  }

  // Last-activity column: prepend a recency dot (green/yellow/red).
  if (col === state.filterCols.lastActivity) {
    const dotClass = activityDotClass(value);
    const wrap = document.createElement('div');
    wrap.className = 'activity-cell';
    const dot = document.createElement('span');
    dot.className = `activity-dot ${dotClass}`;
    dot.title = activityDotTitle(dotClass);
    wrap.appendChild(dot);
    wrap.appendChild(input);
    td.appendChild(wrap);
    return td;
  }

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

  const visibleRecords = state.records.filter(matchesFilters);

  el.bodyRows.innerHTML = '';

  if (visibleRecords.length === 0 && state.records.length > 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'no-results';
    td.colSpan = state.columns.length + 1;
    td.textContent = 'No rows match your filters.';
    tr.appendChild(td);
    el.bodyRows.appendChild(tr);
  }

  for (const rec of visibleRecords) {
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
    delBtn.addEventListener('click', () => handleDeleteClick(delBtn, rec.id));
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
  const oldValue = rec ? rec.fields[field] : undefined;
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
    if (rec && oldValue !== value) {
      pushHistory({ type: 'edit', label: recordLabel(rec), field, oldValue, newValue: value });
    }
  } catch (err) {
    setStatus('error', 'Save failed');
    showError(`Could not save "${field}": ${err.message}`);
  }
}

function recordLabel(rec) {
  const nameCol = state.filterCols.name || state.columns[0];
  const label = nameCol ? rec.fields[nameCol.key] : null;
  return label != null && label !== '' ? String(label) : 'Untitled row';
}

async function addRow() {
  try {
    const created = await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({ fields: {} }),
    });
    state.records.push(created);
    pushHistory({ type: 'create', label: recordLabel(created) });
    render();
  } catch (err) {
    showError(`Could not add row: ${err.message}`);
  }
}

const DELETE_ARM_MS = 3000;

// Two-step delete guard: first click arms the button (turns red, "Confirm?"),
// second click within DELETE_ARM_MS actually deletes. A stray single click
// on a densely packed row of delete buttons never deletes anything.
function handleDeleteClick(btn, recordId) {
  if (btn.dataset.armed === 'true') {
    clearTimeout(Number(btn.dataset.armTimer));
    deleteRow(recordId);
    return;
  }
  btn.dataset.armed = 'true';
  btn.textContent = 'Confirm?';
  btn.classList.add('delete-armed');
  btn.title = 'Click again to permanently delete this row';
  btn.dataset.armTimer = String(setTimeout(() => disarmDeleteBtn(btn), DELETE_ARM_MS));
}

function disarmDeleteBtn(btn) {
  btn.dataset.armed = 'false';
  btn.textContent = '✕';
  btn.classList.remove('delete-armed');
  btn.title = 'Delete row';
}

async function deleteRow(recordId) {
  const rec = state.records.find((r) => r.id === recordId);
  try {
    await api(`/api/records/${recordId}`, { method: 'DELETE' });
    state.records = state.records.filter((r) => r.id !== recordId);
    if (rec) rememberDeleted(rec);
    render();
  } catch (err) {
    showError(`Could not delete row: ${err.message}`);
  }
}

// --- Undo delete -----------------------------------------------------------
// Airtable's API has no "undelete" endpoint, so this keeps its own snapshot
// of anything deleted through this app (persisted to localStorage so it
// survives a page reload) and restores it by creating a fresh record with
// the same field values. Only protects deletions made after this shipped —
// there was never a copy of anything deleted before it.

function loadRecentlyDeleted() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTLY_DELETED_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveRecentlyDeleted() {
  localStorage.setItem(RECENTLY_DELETED_KEY, JSON.stringify(state.recentlyDeleted));
}

function editableFieldsOnly(fields) {
  const out = {};
  for (const col of state.columns) {
    if (col.editable && fields[col.key] !== undefined) out[col.key] = fields[col.key];
  }
  return out;
}

function rememberDeleted(rec) {
  const label = recordLabel(rec);
  state.recentlyDeleted.unshift({
    fields: rec.fields,
    label,
    deletedAt: Date.now(),
  });
  state.recentlyDeleted = state.recentlyDeleted.slice(0, MAX_RECENTLY_DELETED);
  saveRecentlyDeleted();
  renderUndoButton();
  showUndoToast(state.recentlyDeleted[0]);
  pushHistory({ type: 'delete', label });
}

async function restoreDeleted(index) {
  const entry = state.recentlyDeleted[index];
  if (!entry) return;
  try {
    const created = await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({ fields: editableFieldsOnly(entry.fields) }),
    });
    state.records.push(created);
    state.recentlyDeleted.splice(index, 1);
    saveRecentlyDeleted();
    renderUndoButton();
    render();
    hideUndoToast();
    pushHistory({ type: 'restore', label: entry.label });
  } catch (err) {
    showError(`Could not restore "${entry.label}": ${err.message}`);
  }
}

function relativeTime(ts) {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderUndoButton() {
  const count = state.recentlyDeleted.length;
  el.undoBtn.classList.toggle('hidden', count === 0);
  el.undoBtn.textContent = count > 0 ? `↺ Undo delete (${count})` : '↺ Undo delete';
  if (count === 0) el.undoPanel.classList.add('hidden');
  renderUndoPanel();
}

function renderUndoPanel() {
  el.undoPanel.innerHTML = '';
  state.recentlyDeleted.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'undo-row';
    const info = document.createElement('span');
    info.className = 'undo-row-label';
    info.textContent = `${entry.label} · ${relativeTime(entry.deletedAt)}`;
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'undo-row-restore';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreDeleted(i));
    row.appendChild(info);
    row.appendChild(restoreBtn);
    el.undoPanel.appendChild(row);
  });
}

let toastTimer;
function showUndoToast(entry) {
  clearTimeout(toastTimer);
  el.undoToast.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = `Deleted "${entry.label}". `;
  const undoLink = document.createElement('button');
  undoLink.className = 'undo-toast-btn';
  undoLink.textContent = 'Undo';
  undoLink.addEventListener('click', () => restoreDeleted(0));
  text.appendChild(undoLink);
  el.undoToast.appendChild(text);
  el.undoToast.classList.remove('hidden');
  toastTimer = setTimeout(hideUndoToast, 8000);
}

function hideUndoToast() {
  clearTimeout(toastTimer);
  el.undoToast.classList.add('hidden');
}

el.undoBtn.addEventListener('click', () => {
  el.undoPanel.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!el.undoPanel.contains(e.target) && e.target !== el.undoBtn) {
    el.undoPanel.classList.add('hidden');
  }
  if (!el.historyPanel.contains(e.target) && e.target !== el.historyBtn) {
    el.historyPanel.classList.add('hidden');
  }
});

// --- Edit history ------------------------------------------------------
// A local audit log of every change made through this app (field edits,
// row creates/deletes/restores). Airtable's own revision history isn't
// exposed over the REST API, so this is the app's own record of "what
// changed here" — persisted to localStorage, capped at MAX_HISTORY entries.

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function pushHistory(entry) {
  state.history.unshift({ ...entry, at: Date.now() });
  state.history = state.history.slice(0, MAX_HISTORY);
  saveHistory();
  renderHistoryPanel();
}

function clearHistory() {
  state.history = [];
  saveHistory();
  renderHistoryPanel();
}

function formatHistoryValue(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'checked' : 'unchecked';
  return String(v);
}

const HISTORY_TAGS = {
  edit: 'EDIT',
  create: 'ADDED',
  delete: 'DELETED',
  restore: 'RESTORED',
};

function renderHistoryPanel() {
  el.historyPanel.innerHTML = '';

  if (state.history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dropdown-empty';
    empty.textContent = 'No edits yet.';
    el.historyPanel.appendChild(empty);
    return;
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'dropdown-clear';
  clearBtn.textContent = 'Clear history';
  clearBtn.addEventListener('click', clearHistory);
  el.historyPanel.appendChild(clearBtn);

  for (const entry of state.history) {
    const row = document.createElement('div');
    row.className = 'history-row';

    const main = document.createElement('div');
    main.className = 'history-row-main';
    const tag = document.createElement('span');
    tag.className = `history-tag tag-${entry.type}`;
    tag.textContent = HISTORY_TAGS[entry.type] || entry.type;
    main.appendChild(tag);
    main.appendChild(document.createTextNode(entry.label + (entry.field ? ` · ${entry.field}` : '')));
    row.appendChild(main);

    if (entry.type === 'edit') {
      const change = document.createElement('div');
      change.className = 'history-row-change';
      change.textContent = `${formatHistoryValue(entry.oldValue)} → ${formatHistoryValue(entry.newValue)}`;
      row.appendChild(change);
    }

    const time = document.createElement('div');
    time.className = 'history-row-time';
    time.textContent = relativeTime(entry.at);
    row.appendChild(time);

    el.historyPanel.appendChild(row);
  }
}

el.historyBtn.addEventListener('click', () => {
  el.historyPanel.classList.toggle('hidden');
});

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
        computeFilterColumns();
        populateFilterOptions();
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
    populateFilterOptions();
    render();
    setStatus('synced', 'Synced');
    showError(null);
  } catch (err) {
    setStatus('error', 'Offline');
    showError(`Lost connection to Airtable: ${err.message}`);
  }
}

// --- Filter control wiring -----------------------------------------------

let searchDebounce;
el.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.filters.search = el.searchInput.value.trim();
    render();
  }, 150);
});
el.statusFilter.addEventListener('change', () => {
  state.filters.status = el.statusFilter.value;
  render();
});
el.completionFilter.addEventListener('change', () => {
  state.filters.completion = el.completionFilter.value;
  render();
});
el.trendFilter.addEventListener('change', () => {
  state.filters.trend = el.trendFilter.value;
  render();
});

// --- Dark mode -------------------------------------------------------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  el.themeToggle.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const preferred = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved || preferred);
})();

// Keep the filters bar pinned directly below the toolbar, whatever height it wraps to.
function syncStickyOffset() {
  const toolbar = document.querySelector('.toolbar');
  document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
}
window.addEventListener('resize', syncStickyOffset);
syncStickyOffset();

el.addRowBtn.addEventListener('click', addRow);
el.refreshBtn.addEventListener('click', poll);

state.recentlyDeleted = loadRecentlyDeleted();
renderUndoButton();
state.history = loadHistory();
renderHistoryPanel();

(async function init() {
  try {
    await loadSchema();
    await loadRecords();
    computeFilterColumns();
    populateFilterOptions();
    render();
    setStatus('synced', 'Synced');
  } catch (err) {
    setStatus('error', 'Error');
    showError(`Startup failed: ${err.message}`);
  }
  syncStickyOffset();
  setInterval(poll, POLL_MS);
})();
