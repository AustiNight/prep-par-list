/* Prep & Par — Static App (no-build) */

/*
  This JavaScript file contains the complete logic for the Prep & Par static app.

  It manages data for items, recipes, par templates, per‑shift modifiers, on‑hand
  snapshots and generated prep lists.  All data is stored in the browser's
  localStorage; users can export/import JSON or CSV files for backup and
  transferring between devices.  The app is written without any build step
  and runs natively in modern browsers.  A simple service worker (sw.js) and
  manifest.json enable offline PWA support.

  To update the UI, the app uses a very basic manual “router” based on
  swapping template contents into a single view container (#view-root).  Each
  view has its own render function defined below.  The top navigation bar
  controls which view is shown, and the context bar at the top of the page
  specifies the date, location and shift to work on.
*/

/* --------------------------------------------------------------------- */
/* Data model & storage */
const LS_KEYS = {
  ITEMS: 'pp_items_v1',
  RECIPES: 'pp_recipes_v1',
  PAR_TEMPLATES: 'pp_par_templates_v1',
  MODIFIERS: 'pp_modifiers_v1',
  ONHAND_LOG: 'pp_onhand_log_v1',
  PREP_LOG: 'pp_prep_log_v1',
  CONTEXT: 'pp_context_v1',
};

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// Global state holds all data in memory.  It is populated from localStorage
// when the app loads.  Persist to localStorage via persistAll() after
// modifying any state fields.
const state = {
  items: load(LS_KEYS.ITEMS, []),
  recipes: load(LS_KEYS.RECIPES, []),
  parTemplates: load(LS_KEYS.PAR_TEMPLATES, []),
  modifiers: load(LS_KEYS.MODIFIERS, []), // {location,shift, byWeekday:{0:0,...}}
  onhandLog: load(LS_KEYS.ONHAND_LOG, []), // snapshots with date/location/shift
  prepLog: load(LS_KEYS.PREP_LOG, []),     // finalized prep lists
  context: load(LS_KEYS.CONTEXT, {
    date: new Date().toISOString().slice(0,10),
    location: 'Main Kitchen',
    shift: 'Dinner',
  }),
};

function persistAll() {
  save(LS_KEYS.ITEMS, state.items);
  save(LS_KEYS.RECIPES, state.recipes);
  save(LS_KEYS.PAR_TEMPLATES, state.parTemplates);
  save(LS_KEYS.MODIFIERS, state.modifiers);
  save(LS_KEYS.ONHAND_LOG, state.onhandLog);
  save(LS_KEYS.PREP_LOG, state.prepLog);
  save(LS_KEYS.CONTEXT, state.context);
}

/* --------------------------------------------------------------------- */
/* DOM utilities */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function csvEscape(s) {
  const str = String(s ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
}

function downloadFile(name, mime, content) {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

function todayWeekdayIndex(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.getDay();
}

/* --------------------------------------------------------------------- */
/* Context bar handling */
function renderContext() {
  $('#ctx-date').value = state.context.date;
  $('#ctx-location').value = state.context.location;
  $('#ctx-shift').value = state.context.shift;

  // Populate datalist for locations and shifts from existing data
  const locs = new Set();
  state.parTemplates.forEach(t => locs.add(t.location));
  state.items.flatMap(i => i.locations || []).forEach(l => locs.add(l));
  const dlLoc = $('#known-locations'); dlLoc.innerHTML = '';
  [...locs].forEach(l => { const o=document.createElement('option'); o.value=l; dlLoc.appendChild(o); });

  const shifts = new Set(state.parTemplates.map(t => t.shift));
  const dlShift = $('#known-shifts'); dlShift.innerHTML = '';
  [...shifts].forEach(s => { const o=document.createElement('option'); o.value=s; dlShift.appendChild(o); });

  $('#ctx-save').onclick = () => {
    state.context = {
      date: $('#ctx-date').value || state.context.date,
      location: $('#ctx-location').value || state.context.location,
      shift: $('#ctx-shift').value || state.context.shift,
    };
    persistAll();
    routeTo(currentView); // refresh view with new context
  };
}

/* --------------------------------------------------------------------- */
/* Router */
let currentView = 'dashboard';
function routeTo(view) {
  currentView = view;
  const root = $('#view-root'); root.innerHTML = '';
  renderContext();
  switch(view) {
    case 'dashboard': renderDashboard(root); break;
    case 'items': renderItems(root); break;
    case 'recipes': renderRecipes(root); break;
    case 'par': renderPar(root); break;
    case 'modifiers': renderModifiers(root); break;
    case 'export': renderExport(root); break;
    case 'upload': renderUpload(root); break;
    case 'generate': renderGenerate(root); break;
    case 'history': renderHistory(root); break;
  }
}

$$('.nav-btn').forEach(b => b.onclick = () => routeTo(b.dataset.view));
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-jump]');
  if (btn) routeTo(btn.dataset.jump);
});

/* --------------------------------------------------------------------- */
/* Helpers to access and ensure Par templates and modifiers */
function getParTemplate(location, shift) {
  return state.parTemplates.find(t=>t.location===location && t.shift===shift);
}
function ensureParTemplate(location, shift) {
  let t = getParTemplate(location, shift);
  if (!t) { t = { location, shift, lines: [] }; state.parTemplates.push(t); persistAll(); }
  return t;
}

function getModifiers(location, shift) {
  return state.modifiers.find(m=>m.location===location && m.shift===shift);
}
function ensureModifiers(location, shift) {
  let m = getModifiers(location, shift);
  if (!m) { m = { location, shift, byWeekday: {0:0,1:0,2:0,3:0,4:0,5:0,6:0} }; state.modifiers.push(m); persistAll(); }
  return m;
}

function getOnhandSnapshot(date, location, shift) {
  return state.onhandLog.find(s => s.date===date && s.location===location && s.shift===shift);
}

/* --------------------------------------------------------------------- */
/* Dashboard */
function renderDashboard(root) {
  const tpl = $('#tmpl-dashboard').content.cloneNode(true);
  const stats = tpl.querySelector('#dash-stats');
  const hist = tpl.querySelector('#dash-history');
  const ctx = state.context;
  const par = getParTemplate(ctx.location, ctx.shift);
  const onhand = getOnhandSnapshot(ctx.date, ctx.location, ctx.shift);
  const prep = state.prepLog.filter(p => p.date===ctx.date && p.location===ctx.location && p.shift===ctx.shift);
  stats.innerHTML = `
    <div><strong>Date:</strong> ${ctx.date}</div>
    <div><strong>Location:</strong> ${ctx.location}</div>
    <div><strong>Shift:</strong> ${ctx.shift}</div>
    <div><strong>Par lines:</strong> ${par?.lines?.length ?? 0}</div>
    <div><strong>On‑Hand snapshot:</strong> ${onhand ? 'Yes' : 'No'}</div>
    <div><strong>Finalized prep lists today:</strong> ${prep.length}</div>
  `;
  const recent = [...state.onhandLog].slice(-5).reverse();
  hist.innerHTML = recent.map(r => `<div>${r.date} — ${r.location} • ${r.shift} • ${r.source}</div>`).join('') || '—';
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Items */
function renderItems(root) {
  const tpl = $('#tmpl-items').content.cloneNode(true);
  const tbody = tpl.querySelector('#items-rows');
  function draw() {
    tbody.innerHTML = '';
    state.items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input value="${it.id||''}" data-k="id"></td>
        <td><input value="${it.name||''}" data-k="name"></td>
        <td>
          <select data-k="type">
            <option value="recipe" ${it.type==='recipe'?'selected':''}>recipe</option>
            <option value="mechanical" ${it.type==='mechanical'?'selected':''}>mechanical</option>
          </select>
        </td>
        <td><input value="${it.unit||''}" data-k="unit"></td>
        <td><input value="${it.station||''}" data-k="station"></td>
        <td><input value="${(it.locations||[]).join(', ')}" data-k="locations" placeholder="comma‑separated"></td>
        <td><input value="${it.default_batch_yield??''}" data-k="default_batch_yield" type="number" min="0"></td>
        <td><input value="${it.notes||''}" data-k="notes"></td>
        <td><button data-act="del" class="secondary">Delete</button></td>
      `;
      tr.oninput = (e)=>{
        const el=e.target, k=el.dataset.k; if(!k) return;
        if (k==='locations') it[k] = el.value.split(',').map(s=>s.trim()).filter(Boolean);
        else if (k==='default_batch_yield') it[k] = el.value===''?null:Number(el.value);
        else it[k]=el.value;
        persistAll();
      };
      tr.querySelector('button[data-act="del"]').onclick = ()=>{
        state.items.splice(idx,1); persistAll(); draw();
      };
      tbody.appendChild(tr);
    });
  }
  draw();
  tpl.querySelector('#add-item').onclick = ()=>{
    state.items.push({ id:`item_${Date.now()}`, name:'', type:'recipe', unit:'', station:'', locations:[], default_batch_yield:null, notes:'' });
    persistAll(); draw();
  };
  tpl.querySelector('#export-items').onclick = ()=>{
    downloadFile('items.json','application/json', JSON.stringify(state.items,null,2));
  };
  tpl.querySelector('#import-items').onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const txt = await f.text(); state.items = JSON.parse(txt); persistAll(); draw();
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Recipes */
function renderRecipes(root) {
  const tpl = $('#tmpl-recipes').content.cloneNode(true);
  const tbody = tpl.querySelector('#recipes-rows');
  function draw() {
    tbody.innerHTML = '';
    state.recipes.forEach((r, idx) => {
      const tr = document.createElement('tr');
      const ingStr = (r.ingredients||[]).map(i=>`${i.amount} ${i.unit} ${i.name}`).join(' | ');
      tr.innerHTML = `
        <td>
          <select data-k="itemId">
            ${state.items.map(it=>`<option value="${it.id}" ${r.itemId===it.id?'selected':''}>${it.id}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" min="0" data-k="yield_amount" value="${r.yield_amount??''}"></td>
        <td><input data-k="yield_unit" value="${r.yield_unit||''}"></td>
        <td>
          <textarea data-k="ingredients_text" placeholder="amount unit name | amount unit name">${ingStr}</textarea>
        </td>
        <td><textarea data-k="instructions">${r.instructions||''}</textarea></td>
        <td><button data-act="del" class="secondary">Delete</button></td>
      `;
      tr.oninput = (e)=>{
        const el=e.target, k=el.dataset.k; if(!k) return;
        if (k==='ingredients_text') {
          r.ingredients = el.value.split('|').map(s=>s.trim()).filter(Boolean).map(seg=>{
            const parts = seg.split(/\s+/);
            const amount = Number(parts.shift());
            const unit = parts.shift() || '';
            const name = parts.join(' ') || '';
            return { amount, unit, name };
          });
        } else if (k==='yield_amount') r[k] = el.value===''?null:Number(el.value);
        else if (k==='itemId' || k==='yield_unit' || k==='instructions') r[k]=el.value;
        persistAll();
        syncDefaultBatchYield(r);
      };
      tr.querySelector('button[data-act="del"]').onclick=()=>{
        state.recipes.splice(idx,1); persistAll(); draw();
      };
      tbody.appendChild(tr);
    });
  }
  function syncDefaultBatchYield(recipe) {
    const it = state.items.find(i=>i.id===recipe.itemId);
    if (it && it.type==='recipe' && recipe.yield_amount!=null) {
      it.default_batch_yield = recipe.yield_amount;
      persistAll();
    }
  }
  tpl.querySelector('#add-recipe').onclick = ()=>{
    state.recipes.push({ itemId: state.items[0]?.id || '', yield_amount: null, yield_unit: '', ingredients: [], instructions: '' });
    persistAll(); draw();
  };
  tpl.querySelector('#export-recipes').onclick = ()=>{
    downloadFile('recipes.json','application/json', JSON.stringify(state.recipes,null,2));
  };
  tpl.querySelector('#import-recipes').onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const txt = await f.text(); state.recipes = JSON.parse(txt); persistAll(); draw();
  };
  draw();
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Par Templates */
function renderPar(root) {
  const tpl = $('#tmpl-par').content.cloneNode(true);
  const tbody = tpl.querySelector('#par-rows');
  const ctx = state.context;
  const template = ensureParTemplate(ctx.location, ctx.shift);
  function draw() {
    tbody.innerHTML = '';
    template.lines.forEach((line, idx) => {
      const item = state.items.find(i=>i.id===line.itemId);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item?.station || ''}</td>
        <td>
          <select data-k="itemId">
            ${state.items.map(i=>`<option value="${i.id}" ${line.itemId===i.id?'selected':''}>${i.id}</option>`).join('')}
          </select>
        </td>
        <td>${item?.name || ''}</td>
        <td>${item?.unit || ''}</td>
        <td><input type="number" min="0" data-k="parAmount" value="${line.parAmount??0}"></td>
        <td><button data-act="del" class="secondary">Remove</button></td>
      `;
      tr.oninput = (e)=>{
        const el=e.target, k=el.dataset.k; if(!k) return;
        if (k==='parAmount') line[k] = Number(el.value)||0;
        if (k==='itemId') line[k] = el.value;
        persistAll(); draw();
      };
      tr.querySelector('button[data-act="del"]').onclick=()=>{ template.lines.splice(idx,1); persistAll(); draw(); };
      tbody.appendChild(tr);
    });
  }
  draw();
  tpl.querySelector('#add-par-line').onclick = ()=>{
    const first = state.items[0]; if (!first) return alert('Add items first.');
    template.lines.push({ itemId: first.id, parAmount: 0 });
    persistAll(); draw();
  };
  tpl.querySelector('#save-par').onclick = ()=>{ persistAll(); alert('Par template saved.'); };
  tpl.querySelector('#export-par').onclick = ()=>{
    downloadFile('parTemplates.json','application/json', JSON.stringify(state.parTemplates,null,2));
  };
  tpl.querySelector('#import-par').onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const txt = await f.text(); state.parTemplates = JSON.parse(txt); persistAll(); routeTo('par');
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Modifiers (per‑shift‑per‑day) */
function renderModifiers(root) {
  const tpl = $('#tmpl-modifiers').content.cloneNode(true);
  const tbody = tpl.querySelector('#mod-rows');
  const m = ensureModifiers(state.context.location, state.context.shift);
  tbody.innerHTML = '';
  WEEKDAYS.forEach((name, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${name}</td>
      <td><input type="number" data-idx="${idx}" value="${m.byWeekday[idx]??0}" /></td>
    `;
    tr.oninput = (e)=>{
      const i=Number(e.target.dataset.idx); m.byWeekday[i] = Number(e.target.value)||0; persistAll();
    };
    tbody.appendChild(tr);
  });
  tpl.querySelector('#save-modifiers').onclick = ()=>{ persistAll(); alert('Modifiers saved.'); };
  tpl.querySelector('#export-modifiers').onclick = ()=>{
    downloadFile('modifiers.json','application/json', JSON.stringify(state.modifiers,null,2));
  };
  tpl.querySelector('#import-modifiers').onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const txt = await f.text(); state.modifiers = JSON.parse(txt); persistAll(); routeTo('modifiers');
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Generate worksheet rows for CSV/export */
function generateWorksheetRows(date, location, shift) {
  const rows = [];
  const template = getParTemplate(location, shift);
  if (!template) return rows;
  const mod = ensureModifiers(location, shift);
  const weekday = todayWeekdayIndex(date);
  const pct = mod.byWeekday[weekday] || 0;
  template.lines.forEach(line => {
    const item = state.items.find(i => i.id === line.itemId);
    if (!item) return;
    const adjPar = Math.round(line.parAmount * (1 + pct / 100));
    rows.push({
      date,
      location,
      shift,
      station: item.station || '',
      item_id: line.itemId,
      item_name: item.name || '',
      unit: item.unit || '',
      par: adjPar,
      on_hand: ''
    });
  });
  return rows;
}

/* Create CSV from worksheet rows */
function worksheetRowsToCSV(rows) {
  const header = ['date','location','shift','station','item_id','item_name','unit','par','on_hand'];
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach(r => {
    lines.push(header.map(col => csvEscape(r[col] ?? '')).join(','));
  });
  return lines.join('\n');
}

/* Render preview table for worksheet */
function worksheetRowsToHTMLTable(rows) {
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Date</th><th>Location</th><th>Shift</th><th>Station</th><th>Item</th><th>Unit</th><th>Par</th><th>On‑Hand</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td><td>${r.location}</td><td>${r.shift}</td>
      <td>${r.station}</td><td>${r.item_name}</td><td>${r.unit}</td>
      <td>${r.par}</td><td>${r.on_hand}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* --------------------------------------------------------------------- */
/* Export Worksheet */
function renderExport(root) {
  const tpl = $('#tmpl-export').content.cloneNode(true);
  const ctx = state.context;
  function updatePreview() {
    const rows = generateWorksheetRows(ctx.date, ctx.location, ctx.shift);
    const preview = worksheetRowsToHTMLTable(rows);
    const container = tpl.querySelector('#worksheet-preview');
    container.innerHTML = '';
    container.appendChild(preview);
  }
  updatePreview();
  tpl.querySelector('#export-onhand-csv').onclick = ()=>{
    const rows = generateWorksheetRows(ctx.date, ctx.location, ctx.shift);
    const csv = worksheetRowsToCSV(rows);
    const fname = `onhand_${ctx.date}_${ctx.location.replace(/\s+/g,'_')}_${ctx.shift.replace(/\s+/g,'_')}.csv`;
    downloadFile(fname, 'text/csv', csv);
  };
  tpl.querySelector('#print-worksheet').onclick = ()=>{
    window.print();
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* CSV parsing */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i+1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseWorksheetCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCSVLine(lines[i]);
    const obj = {};
    header.forEach((col, j) => { obj[col] = cells[j] ?? ''; });
    rows.push(obj);
  }
  if (!rows.length) return null;
  const {date, location, shift} = rows[0];
  const parsedRows = rows.map(r => ({
    itemId: r.item_id,
    par: Number(r.par) || 0,
    unit: r.unit,
    onHand: Number(r.on_hand) || 0
  }));
  return { date, location, shift, rows: parsedRows };
}

/* --------------------------------------------------------------------- */
/* Upload (CSV or OCR) */
function renderUpload(root) {
  const tpl = $('#tmpl-upload').content.cloneNode(true);
  const csvStatus = tpl.querySelector('#csv-status');
  const ocrStatus = tpl.querySelector('#ocr-status');
  const reviewDiv = tpl.querySelector('#upload-review');

  tpl.querySelector('#upload-csv').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const snap = parseWorksheetCSV(text);
    if (!snap) { csvStatus.textContent = 'Invalid CSV'; return; }
    // Save snapshot
    snap.source = 'csv';
    snap.ocrConfidence = 1.0;
    // Remove any existing snapshot for same date/location/shift
    state.onhandLog = state.onhandLog.filter(s => !(s.date===snap.date && s.location===snap.location && s.shift===snap.shift));
    state.onhandLog.push(snap);
    persistAll();
    csvStatus.textContent = `Uploaded ${f.name} → ${snap.rows.length} lines`;
    reviewDiv.innerHTML = '';
    // Show a review table for quick look
    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Item ID</th><th>Par</th><th>On‑Hand</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    snap.rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.itemId}</td><td>${r.par}</td><td>${r.onHand}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    reviewDiv.appendChild(table);
  };

  tpl.querySelector('#upload-ocr').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    ocrStatus.textContent = 'Processing...';
    try {
      const data = await Tesseract.recognize(f, 'eng', { logger: m => { /* progress */ } });
      const text = data.data.text;
      // Attempt to parse lines based on common columns; fallback to manual review
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      // Try to detect header row
      let headerIdx = lines.findIndex(l => /date/i.test(l) && /item/i.test(l));
      if (headerIdx < 0) headerIdx = 0;
      const headerLine = lines[headerIdx];
      const headerFields = headerLine.split(/\s+/);
      // Determine columns heuristically; we expect date, location, shift, station, item_id, item_name, unit, par, on_hand
      const parsedRows = [];
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const parts = lines[i].split(/\s+/);
        if (parts.length < 8) continue;
        const [date, location, shift, station, item_id, item_name, unit, par, on_hand] = parts;
        parsedRows.push({ date, location, shift, station, item_id, item_name, unit, par, on_hand });
      }
      if (!parsedRows.length) throw new Error('Unable to parse OCR text');
      const { date, location, shift } = parsedRows[0];
      const rows = parsedRows.map(r => ({
        itemId: r.item_id,
        par: Number(r.par) || 0,
        unit: r.unit,
        onHand: Number(r.on_hand) || 0
      }));
      const snap = { date, location, shift, rows, source:'ocr', ocrConfidence: data.data.confidence||0.9 };
      // Deduplicate existing
      state.onhandLog = state.onhandLog.filter(s => !(s.date===snap.date && s.location===snap.location && s.shift===snap.shift));
      state.onhandLog.push(snap);
      persistAll();
      ocrStatus.textContent = `OCR processed → ${rows.length} lines (confidence ${Math.round(snap.ocrConfidence*100)}%)`;
      // Show table for review
      reviewDiv.innerHTML = '';
      const table = document.createElement('table');
      table.className = 'table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Item ID</th><th>Par</th><th>On‑Hand</th></tr>';
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      snap.rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.itemId}</td><td>${r.par}</td><td>${r.onHand}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      reviewDiv.appendChild(table);
    } catch (err) {
      console.error(err);
      ocrStatus.textContent = 'OCR failed to parse. Please fill CSV instead.';
    }
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* Calculate prep rows (intelligent) */
function calculatePrepRows(date, location, shift) {
  const onhandSnap = getOnhandSnapshot(date, location, shift);
  const template = getParTemplate(location, shift);
  const rows = [];
  if (!template) return rows;
  const mod = ensureModifiers(location, shift);
  const weekday = todayWeekdayIndex(date);
  const pct = mod.byWeekday[weekday] || 0;
  template.lines.forEach(line => {
    const item = state.items.find(i => i.id === line.itemId);
    if (!item) return;
    const parBase = line.parAmount;
    const adjPar = Math.round(parBase * (1 + pct / 100));
    const onHandRow = onhandSnap ? onhandSnap.rows.find(r => r.itemId === line.itemId) : null;
    const onHand = onHandRow ? onHandRow.onHand : 0;
    const needed = Math.max(0, adjPar - onHand);
    let suggested = 0;
    let batchYield = null;
    if (item.type === 'recipe') {
      batchYield = item.default_batch_yield || 0;
      if (needed > 0) {
        const batches = batchYield > 0 ? Math.ceil(needed / batchYield) : 0;
        suggested = batches * batchYield;
      }
    } else {
      suggested = needed;
    }
    rows.push({
      station: item.station || '',
      itemId: item.id,
      itemName: item.name || '',
      unit: item.unit || '',
      par: parBase,
      modifier: pct,
      adjPar: adjPar,
      onHand: onHand,
      needed: needed,
      batchYield: batchYield,
      suggested: suggested,
      assignedTo: '',
      notes: item.notes || ''
    });
  });
  return rows;
}

/* Convert prep rows to CSV */
function prepRowsToCSV(prepRows, ctx) {
  const header = ['date','location','shift','station','item_id','item_name','unit','par','modifier','adj_par','on_hand','needed','batch_yield','suggested_prep','assigned_to','notes'];
  const lines = [header.map(csvEscape).join(',')];
  prepRows.forEach(r => {
    const obj = {
      date: ctx.date,
      location: ctx.location,
      shift: ctx.shift,
      station: r.station,
      item_id: r.itemId,
      item_name: r.itemName,
      unit: r.unit,
      par: r.par,
      modifier: r.modifier,
      adj_par: r.adjPar,
      on_hand: r.onHand,
      needed: r.needed,
      batch_yield: r.batchYield,
      suggested_prep: r.suggested,
      assigned_to: r.assignedTo,
      notes: r.notes,
    };
    lines.push(header.map(col => csvEscape(obj[col] ?? '')).join(','));
  });
  return lines.join('\n');
}

/* --------------------------------------------------------------------- */
/* Generate Prep List view */
function renderGenerate(root) {
  const tpl = $('#tmpl-generate').content.cloneNode(true);
  const tbody = tpl.querySelector('#prep-rows');
  let currentRows = [];
  const ctx = state.context;
  function drawTable(rows) {
    tbody.innerHTML = '';
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.station}</td>
        <td>${r.itemName}</td>
        <td>${r.unit}</td>
        <td>${r.par}</td>
        <td>${r.modifier}</td>
        <td>${r.adjPar}</td>
        <td>${r.onHand}</td>
        <td>${r.needed}</td>
        <td>${r.batchYield ?? ''}</td>
        <td>${r.suggested}</td>
        <td><input data-k="assignedTo" value="${r.assignedTo}"></td>
        <td><input data-k="notes" value="${r.notes}"></td>
      `;
      tr.oninput = (e) => {
        const el = e.target; const k = el.dataset.k; if (!k) return;
        currentRows[idx][k] = el.value;
      };
      tbody.appendChild(tr);
    });
  }
  tpl.querySelector('#calc-prep').onclick = () => {
    // require on-hand snapshot
    const snap = getOnhandSnapshot(ctx.date, ctx.location, ctx.shift);
    if (!snap) {
      alert('No on-hand snapshot for this context. Upload on-hand first.');
      return;
    }
    currentRows = calculatePrepRows(ctx.date, ctx.location, ctx.shift);
    drawTable(currentRows);
  };
  tpl.querySelector('#export-prep-csv').onclick = () => {
    if (!currentRows.length) { alert('No prep data. Click Calculate first.'); return; }
    const csv = prepRowsToCSV(currentRows, ctx);
    const fname = `prep_${ctx.date}_${ctx.location.replace(/\s+/g,'_')}_${ctx.shift.replace(/\s+/g,'_')}.csv`;
    downloadFile(fname, 'text/csv', csv);
  };
  tpl.querySelector('#finalize-prep').onclick = () => {
    if (!currentRows.length) { alert('No prep data. Click Calculate first.'); return; }
    // Save snapshot into prepLog
    const snapshot = {
      date: ctx.date,
      location: ctx.location,
      shift: ctx.shift,
      rows: JSON.parse(JSON.stringify(currentRows)),
      finalized: true
    };
    // Remove existing for this context
    state.prepLog = state.prepLog.filter(p => !(p.date===snapshot.date && p.location===snapshot.location && p.shift===snapshot.shift));
    state.prepLog.push(snapshot);
    persistAll();
    alert('Prep list finalized and saved to history.');
    currentRows = [];
    tbody.innerHTML = '';
  };
  root.appendChild(tpl);
}

/* --------------------------------------------------------------------- */
/* History view */
function renderHistory(root) {
  const tpl = $('#tmpl-history').content.cloneNode(true);
  const tbody = tpl.querySelector('#hist-rows');
  // Combine onhand and prep logs for listing
  const entries = [];
  state.onhandLog.forEach(s => entries.push({ type:'onhand', date:s.date, location:s.location, shift:s.shift, ref:s }));
  state.prepLog.forEach(p => entries.push({ type:'prep', date:p.date, location:p.location, shift:p.shift, ref:p }));
  // Sort by date descending
  entries.sort((a,b) => b.date.localeCompare(a.date));
  tbody.innerHTML = '';
  entries.forEach((ent, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ent.date}</td><td>${ent.location}</td><td>${ent.shift}</td><td>${ent.type}</td>
      <td><button data-idx="${idx}" class="secondary">View</button></td>
    `;
    tr.querySelector('button').onclick = () => {
      const entry = entries[idx];
      if (entry.type === 'onhand') {
        viewOnhand(entry.ref);
      } else {
        viewPrep(entry.ref);
      }
    };
    tbody.appendChild(tr);
  });
  tpl.querySelector('#export-history').onclick = () => {
    const history = { onhandLog: state.onhandLog, prepLog: state.prepLog };
    downloadFile('history.json','application/json', JSON.stringify(history,null,2));
  };
  tpl.querySelector('#import-history').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text();
    const hist = JSON.parse(txt);
    state.onhandLog = hist.onhandLog || [];
    state.prepLog = hist.prepLog || [];
    persistAll();
    routeTo('history');
  };
  root.appendChild(tpl);
}

function viewOnhand(snap) {
  const lines = snap.rows.map(r => `${r.itemId}: par=${r.par}, onHand=${r.onHand}`).join('\n');
  alert(`On‑Hand snapshot\nDate: ${snap.date}\nLoc: ${snap.location}\nShift: ${snap.shift}\nRows:\n${lines}`);
}

function viewPrep(prep) {
  const lines = prep.rows.map(r => `${r.itemName} (suggested ${r.suggested}${r.unit})→ assigned to ${r.assignedTo || '-'}`).join('\n');
  alert(`Prep list\nDate: ${prep.date}\nLoc: ${prep.location}\nShift: ${prep.shift}\nRows:\n${lines}`);
}

/* --------------------------------------------------------------------- */
// Kickstart app on load
window.addEventListener('DOMContentLoaded', () => {
  routeTo(currentView);
  // Register service worker if available
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});