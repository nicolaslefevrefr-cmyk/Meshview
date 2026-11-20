'use strict';
/* core.js — global state, settings, persistence, undo, small helpers */

const APP = { name: 'MeshView', version: '1.3.0' };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(3)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

/* ---------- icons (24×24, stroke = currentColor) ---------- */
const ICONS = {
  point: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M4 20l5-5M15 9l5-5" opacity=".45"/>',
  edge: '<path d="M4 18L20 6"/><circle cx="4" cy="18" r="2" fill="currentColor"/><circle cx="20" cy="6" r="2" fill="currentColor"/>',
  face: '<path d="M4 8l8-4 8 4-8 4z" fill="currentColor" fill-opacity=".35"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
  object: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  select: '<path d="M6 3l12 8.5-5.2 1.1 3 5.6-2.2 1.2-3-5.6L6 17z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  ruler: '<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2"/>',
  persp: '<path d="M3 7l6-3h6l6 3v10l-6 3H9l-6-3z"/><path d="M9 4v16M15 4v16" opacity=".5"/>',
  ortho: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 12h16M12 5v14" opacity=".5"/>',
  section: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M2 12h20" stroke-dasharray="2.5 2"/>',
  shaded: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" fill-opacity=".45"/>',
  wire: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M4 12h16"/>',
  opaque: '<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".85"/>',
  ghost: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".12" stroke="none"/>',
  presetA: '<rect x="3" y="7" width="10" height="10" rx="1.5" fill="currentColor" fill-opacity=".85"/><rect x="11" y="5" width="10" height="12" rx="1.5" stroke-dasharray="2.5 2"/>',
  presetB: '<rect x="3" y="7" width="10" height="10" rx="1.5" stroke-dasharray="2.5 2"/><rect x="11" y="5" width="10" height="12" rx="1.5" fill="currentColor" fill-opacity=".85"/>',
  tag: '<path d="M3 12V4h8l10 10-7 7z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
  edges: '<path d="M5 8l7-4 7 4v8l-7 4-7-4z"/><path d="M5 8l7 4 7-4M12 12v8" stroke-width="2.4"/>',
  res: '<path d="M4 20L20 4"/><path d="M4 14l6-6M10 20l10-10" opacity=".5"/><path d="M4 8l4-4M16 20l4-4" opacity=".3"/>',
  redraw: '<path d="M20 11a8 8 0 1 0-2.4 6"/><path d="M20 4v7h-7"/>',
  invX: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  invY: '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  iso: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/><text x="12" y="10.6" font-size="0" />',
  viewZ: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6l-6 6h6"/>',
  viewY: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 8l3 4 3-4M12 12v4.5"/>',
  viewX: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 8l6 8M15 8l-6 8"/>',
  normal: '<path d="M3 18h18"/><path d="M12 18V5M8.5 8.5L12 5l3.5 3.5"/><path d="M12 14.5h3.5V18" opacity=".55"/>',
  flip: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  tree: '<path d="M4 5h16M4 12h16M4 19h16"/>',
  props: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  expand: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  collapse: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 10l-2 2 2 2"/>',
  float: '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M9 3h12v12"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  install: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17v2.5h16V17"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-2 9H5z"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  cs: '<path d="M5 19V5M5 19h14M5 19l9-9"/><path d="M3 7l2-2 2 2M17 17l2 2-2 2" />',
  plane: '<path d="M3 15l5-7h13l-5 7z" fill="currentColor" fill-opacity=".15"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  pick: '<path d="M4 12h3M17 12h3M12 4v3M12 17v3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  appear: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" fill="currentColor" fill-opacity=".3"/>',
  appearO: '<circle cx="12" cy="12" r="7" fill="currentColor" fill-opacity=".85"/>',
  appearT: '<circle cx="12" cy="12" r="7" stroke-dasharray="3 2.4"/>',
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  motion: '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/><path d="M12 4v4M12 16v4" opacity=".5"/>',
  envelope: '<rect x="3" y="7" width="9" height="10" rx="1.5" stroke-dasharray="2.5 2"/><rect x="12" y="7" width="9" height="10" rx="1.5" stroke-dasharray="2.5 2"/><rect x="7.5" y="7" width="9" height="10" rx="1.5" fill="currentColor" fill-opacity=".25"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
};
function ic(name, cls) { return `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
function icEl(name) { const s = document.createElement('span'); s.style.display = 'contents'; s.innerHTML = ic(name); return s.firstChild; }

/* ---------- persistence ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('meshview.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('meshview.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

const DEFAULTS = {
  cfgv: 2, theme: 'light', renderMode: 'shaded', proj: 'ortho', names: 0, edges: true, colorByFile: false,
  invX: false, invY: false, lw: 310, rw: 360, dw: 440, axes: false, pickPop: true, secNames: true,
  step: 1, margin: 8, snapPx: 14, faceTol: 1, edgeAngle: 20, edgeRetry: true, sharpOnly: true, wholeFace: true,
  snapVert: true, units: 'mm', decimals: 3, res: 1, filter: 'object', tool: 'select', pointFrom: 'vertex',
  leftOpen: true, rightOpen: true, crease: 30, weldTol: 1e-6, hoverPreview: true
};
const UNITS = { mm: 0.1, cm: 1, m: 100, in: 2.54 };   // file unit → cm
const PALETTE = ['#5b8def', '#e8833a', '#3fae6b', '#c85bd6', '#d6b23c', '#40b4c4', '#e0567a', '#8a7be8', '#7a9a3a', '#b5835a'];

/* ---------- global state ---------- */
const S = {
  set: Object.assign({}, DEFAULTS, store.get('settings', {})),
  doc: null,
  geo: new Map(),        // geoKey -> topology (geom.js)
  sel: null,             // primary selected item id
  multi: new Set(),      // multi-selection (includes sel)
  pick: null,            // current picked entity (point / edge / face / object)
  undo: [], redo: [],
  needRender: true,
  selGroup: null,        // selected mesh group id (tree)
  selMotion: null        // selected motion id (tree)
};
if ((S.set.cfgv || 1) < 2) { S.set.proj = 'ortho'; S.set.cfgv = 2; }  // v1.2: orthographic by default

function newDoc() {
  return {
    name: 'Untitled', nextId: 1, activeCS: 0, groups: [], motions: [],
    items: [{ id: 0, kind: 'cs', name: 'Global', color: '#6b7686', o: [0, 0, 0], r: [0, 0, 0], parent: null, visible: false }]
  };
}
S.doc = newDoc();

function saveSettings() { store.set('settings', S.set); }
function item(id) { return S.doc.items.find(i => i.id === id) || null; }
function itemsOf(kind) { return S.doc.items.filter(i => i.kind === kind); }
function newId() { return S.doc.nextId++; }
function groupOf(id) { return S.doc.groups.find(g => g.id === id) || null; }

/* ---------- undo / redo (document snapshots) ---------- */
function snapshot() { return JSON.stringify(S.doc); }
function commit(fn, opts) {
  S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift();
  S.redo.length = 0;
  fn();
  changed(opts);
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot()); S.doc = JSON.parse(S.undo.pop());
  validateSel(); changed(); toast('Undo');
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot()); S.doc = JSON.parse(S.redo.pop());
  validateSel(); changed(); toast('Redo');
}
function validateSel() {
  if (S.sel != null && !item(S.sel)) S.sel = null;
  for (const id of [...S.multi]) if (!item(id)) S.multi.delete(id);
  if (S.pick && !item(S.pick.id)) S.pick = null;
  if (S.selGroup && !groupOf(S.selGroup)) S.selGroup = null;
  if (S.selMotion && !(S.doc.motions || []).some(m => m.id === S.selMotion)) S.selMotion = null;
}
/* single entry point after any document change */
function changed(opts) {
  opts = opts || {};
  V.sync();
  UI.refreshTree();
  if (!opts.keepProps) UI.refreshProps();
  UI.refreshUndo();
  UI.refreshLegend();
  Section.invalidate();
  S.needRender = true;
  S.dirty = true;
}

/* ---------- formatting ---------- */
function fmt(v, d) {
  if (v == null || !isFinite(v)) return '—';
  d = d == null ? S.set.decimals : d;
  let s = (+v).toFixed(d);
  if (/^-0\.?0*$/.test(s)) s = s.slice(1);
  return s;
}
function fmtLen(v) { return `${fmt(v)} cm<span class="mm">${fmt(v * 10, Math.max(0, S.set.decimals - 1))} mm</span>`; }
function fmtV(p) { return p ? `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}` : '—'; }
function fmtA(a) { return a ? a.map(v => fmt(v)).join(', ') : '—'; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- toasts / dialogs / loading ---------- */
function toast(msg, ms) {
  const t = h('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms || 3000);
}
function confirmDlg(title, text, okLabel, danger) {
  return new Promise(res => {
    const d = $('#dlg');
    d.innerHTML = '';
    d.append(h('div', { class: 'dh', text: title }), h('div', { class: 'db', text: text }),
      h('div', { class: 'df' },
        h('button', { class: 'btn', onclick: () => { d.close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn primary' + (danger ? ' danger' : ''), style: danger ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' } : null, onclick: () => { d.close(); res(true); } }, okLabel || 'OK')));
    d.onclose = () => res(false);
    d.showModal();
  });
}
const Load = {
  show(title) { $('#loadBox').classList.remove('hidden'); $('#lbT').textContent = title; this.step('', 0); },
  step(text, frac) { $('#lbS').textContent = text; $('#lbBar').style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; },
  hide() { $('#loadBox').classList.add('hidden'); }
};
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
