'use strict';
/* app.js — drag & drop import, keyboard, theme, PWA, init */

const App = {};

/* ---------- import (drag & drop or browse) ---------- */
App.openFiles = async function (fileList) {
  const files = [...fileList];
  const proj = files.find(f => /\.json$/i.test(f.name));
  if (proj) { if (files.length > 1) toast('⚠ A project file replaces the scene: the other dropped files were ignored'); return App.loadProject(proj); }
  const models = files.filter(f => /\.(stl|obj)$/i.test(f.name));
  if (!models.length) { toast('⚠ Only .stl, .obj and .json (project) files are supported'); return; }
  if (models.length < files.length) toast(`⚠ ${files.length - models.length} file(s) ignored (not .stl / .obj)`);
  if (T.active) T.cancel();
  const wasEmpty = !itemsOf('mesh').length;
  const pre = snapshot();
  const scale = UNITS[S.set.units] || 1;
  const n = models.length; let added = 0, failed = 0, tris = 0;
  Load.show(`Loading ${n} file${n > 1 ? 's' : ''}`);
  for (let i = 0; i < n; i++) {
    const f = models[i];
    try {
      Load.step(`Reading ${f.name}`, i / n); await nextFrame();
      const buf = await f.arrayBuffer();
      const parts = /\.obj$/i.test(f.name) ? G.parseOBJ(new TextDecoder().decode(buf), f.name) : G.parseSTL(buf, f.name);
      Load.step(`Building topology · ${f.name}`, (i + 0.5) / n); await nextFrame();
      const gi = S.doc.groups.length;
      const group = { id: 'g' + newId(), name: f.name, color: PALETTE[gi % PALETTE.length] };
      const meshes = [];
      for (const part of parts) {
        const topo = G.buildTopo(part.pos, scale);
        if (!topo.nf) continue;
        const key = 'geo' + newId();
        S.geo.set(key, topo); tris += topo.nf;
        meshes.push({ id: newId(), kind: 'mesh', name: part.name, file: f.name, geo: key, group: group.id, color: group.color, opacity: 1, visible: true, appearance: 'follow', units: S.set.units });
      }
      if (!meshes.length) throw new Error('no valid triangles');
      S.doc.groups.push(group); S.doc.items.push(...meshes); added += meshes.length;
    } catch (err) {
      failed++; console.error(err); toast(`⚠ ${f.name}: ${err.message || err}`, 5000);
    }
  }
  if (added) {
    S.undo.push(pre); S.redo.length = 0; S.dirty = true;
    Load.step('Building 3D view', .9); await nextFrame();
    V.sync();
    Load.step('Lists and panels', .95); await nextFrame();
    UI.refreshAll(); Section.invalidate();
    if (wasEmpty) V.viewIso(); else V.fit();
    App.updateEmpty();
  }
  Load.step('Done', 1); await nextFrame(); Load.hide();
  if (added) toast(`${added} mesh${added > 1 ? 'es' : ''} loaded · ${tris.toLocaleString('en-US')} triangles${failed ? ` · ⚠ ${failed} file(s) failed` : ''}`);
  UI.status();
};
App.updateEmpty = function () { $('#dropHint').classList.toggle('hidden', itemsOf('mesh').length > 0); };
App.newProject = async function () {
  if (S.doc.items.length > 1 && !(await confirmDlg('Clear everything', 'Remove every mesh and coordinate system?', 'Clear', true))) return;
  if (T.active) T.cancel(true);
  if (Section.open) Section.toggle(false);
  S.doc = newDoc(); S.geo.clear(); S.undo = []; S.redo = []; S.sel = null; S.selGroup = null; S.selMotion = null; S.multi.clear(); S.pick = null;
  changed(); UI.refreshAll(); App.updateEmpty(); UI.status(); S.dirty = false;
};

/* ---------- project files (.json: meshes + CS + motions + display + camera + section) ---------- */
App.FORMAT = 'meshview-project';
App.download = function (blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
App.VIEW_KEYS = ['renderMode', 'proj', 'names', 'edges', 'colorByFile', 'filter', 'tool', 'res', 'axes', 'units', 'crease', 'snapVert', 'snapPx', 'sharpOnly', 'edgeAngle', 'edgeRetry', 'wholeFace', 'faceTol', 'pointFrom', 'invX', 'invY'];
App.saveProject = async function () {
  if (!itemsOf('mesh').length && !Motion.list().length) { toast('Nothing to save yet'); return; }
  Load.show('Saving project'); Load.step('Encoding meshes', .2); await nextFrame();
  const geos = {};
  for (const m of itemsOf('mesh')) if (!geos[m.geo]) { const t = S.geo.get(m.geo); geos[m.geo] = { pos: G.b64(t.pos), idx: G.b64(t.idx), collapsed: t.collapsed || 0 }; }
  const c = V.cam;
  const data = {
    format: App.FORMAT, version: 1, app: APP.name + ' ' + APP.version, saved: new Date().toISOString(),
    doc: S.doc,                                   // meshes, groups, coordinate systems, motions (ranges + current values), colours, visibility…
    view: Object.fromEntries(App.VIEW_KEYS.map(k => [k, S.set[k]])),
    camera: { proj: S.set.proj, position: c.position.toArray(), quaternion: c.quaternion.toArray(), pivot: V.pivot.toArray(), halfH: V.halfH },
    section: { open: Section.open, docked: Section.docked, plane: Section.plane, offset: Section.offset, flip: Section.flip, show3D: Section.show3D, precise: !!Section.precise },
    geos
  };
  Load.step('Writing file', .7); await nextFrame();
  const name = App.safeName(App.projectName()) + '.meshview.json';
  App.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
  S.dirty = false;
  Load.hide(); toast('Project saved: ' + name);
};
App.projectName = function () {
  if (S.doc.name && S.doc.name !== 'Untitled') return S.doc.name;
  return S.doc.groups.length ? S.doc.groups[0].name.replace(/\.[^.]+$/, '') : 'project';
};
App.safeName = (s) => (s || 'project').replace(/[^\w.-]+/g, '_');
App.loadProject = async function (file) {
  try {
    if (itemsOf('mesh').length && S.dirty && !(await confirmDlg('Open project', `Replace the current scene with "${file.name}"? Unsaved changes will be lost.`, 'Open', true))) return;
    Load.show('Opening project'); Load.step('Reading ' + file.name, .1); await nextFrame();
    const data = JSON.parse(await file.text());
    if (!data || !data.doc || !data.geos || (data.format && data.format !== App.FORMAT)) throw new Error('not a MeshView project file');
    Load.step('Rebuilding meshes', .35); await nextFrame();
    if (T.active) T.cancel(true);
    if (Section.open) Section.toggle(false);
    const geo = new Map();
    for (const k in data.geos) { const g = data.geos[k]; geo.set(k, G.topoFrom(G.unb64(g.pos, Float32Array), G.unb64(g.idx, Uint32Array), g.collapsed)); }
    for (const rg of V.geoRender.values()) { rg.g.dispose(); rg.eg.dispose(); }
    V.geoRender.clear(); for (const k of [...V.env.keys()]) V.disposeEnv(k);
    S.geo = geo;
    const doc = data.doc; doc.motions = doc.motions || []; doc.groups = doc.groups || [];
    if (!doc.items.some(i => i.id === 0)) doc.items.unshift(newDoc().items[0]);
    S.doc = doc; S.undo = []; S.redo = []; S.sel = null; S.selGroup = null; S.selMotion = null; S.multi.clear(); S.pick = null;
    if (data.view) { for (const k of App.VIEW_KEYS) if (data.view[k] !== undefined) S.set[k] = data.view[k]; saveSettings(); }
    Load.step('Building 3D view', .7); await nextFrame();
    V.setPixelRatio();
    V.sync(true); UI.buildToolbar(); UI.refreshAll(); App.updateEmpty();
    // camera
    const cam = data.camera;
    if (cam && cam.position) {
      V.cam = cam.proj === 'ortho' ? V.ortho : V.persp; S.set.proj = cam.proj === 'ortho' ? 'ortho' : 'persp';
      V.cam.position.fromArray(cam.position); V.cam.quaternion.fromArray(cam.quaternion);
      V.pivot.fromArray(cam.pivot); V.halfH = cam.halfH || V.halfH; V.updateProj();
    } else V.fit(null, false);
    // section window
    const sc = data.section;
    if (sc) {
      Object.assign(Section, { docked: !!sc.docked, plane: sc.plane || Section.plane, offset: +sc.offset || 0, flip: !!sc.flip, show3D: sc.show3D !== false, precise: !!sc.precise, view: null });
      if (sc.open) Section.toggle(true);
    }
    UI.refreshToolbar(); S.needRender = true; S.dirty = false;
    Load.step('Done', 1); await nextFrame(); Load.hide();
    UI.status();
    toast(`Project opened: ${file.name} — ${itemsOf('mesh').length} mesh(es), ${itemsOf('cs').length - 1} CS, ${Motion.list().length} motion(s)`);
  } catch (err) { console.error(err); Load.hide(); toast('⚠ ' + file.name + ': ' + (err.message || err), 5000); }
};

/* ---------- theme ---------- */
App.applyTheme = function () {
  document.documentElement.dataset.theme = S.set.theme;
  $('#btnTheme').innerHTML = ic(S.set.theme === 'dark' ? 'sun' : 'moon');
  $('meta[name=theme-color]').setAttribute('content', S.set.theme === 'dark' ? '#1a2029' : '#2f6fed');
  if (V.renderer) { V.applyMode(); Section.draw(); }
  S.needRender = true;
};

/* ---------- keyboard ---------- */
App.keys = function (e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileIn').click(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); App.saveProject(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape') {
    UI.closePopups();
    if (T.active) { T.cancel(); UI.setTool('select'); return; }
    if (V.ovl.tool.length) { V.ovl.tool = []; S.needRender = true; UI.status(); return; }
    if (S.pick) { S.pick = null; P.show('pick', null); UI.refreshToolwin(); UI.refreshProps(); UI.status(); return; }
    if (S.set.tool !== 'select') UI.setTool('select'); else if (S.sel != null || S.selGroup || S.selMotion) UI.select(null);
    return;
  }
  if (e.key === 'Enter' && T.active) { e.preventDefault(); T.enter(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (S.multi.size || S.selMotion || S.selGroup)) { e.preventDefault(); UI.deleteSel(); return; }
  if (e.key === 'f' || e.key === 'F') { V.fit(); return; }
};

/* ---------- PWA ---------- */
App.initPWA = function () {
  const btn = $('#btnInstall'); let deferred = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone) btn.classList.remove('hidden'); });
  btn.onclick = async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (_) { } deferred = null; btn.classList.add('hidden'); };
  window.addEventListener('appinstalled', () => { btn.classList.add('hidden'); toast('App installed'); });
  if ('serviceWorker' in navigator && $('link[rel=manifest]') && /^(https:|http:\/\/localhost|http:\/\/127\.)/.test(location.href)) {
    navigator.serviceWorker.register('service-worker.js').then(r => (App.swReg = r)).catch(() => { });
  }
};
App.checkUpdate = function () {
  if (!App.swReg) { toast('No update channel (standalone file)'); return; }
  App.swReg.update().then(() => toast(App.swReg.waiting || App.swReg.installing ? 'Update found — reload to apply' : 'You have the latest version')).catch(() => toast('⚠ Update check failed (offline?)'));
};

/* ---------- init ---------- */
App.init = function () {
  if (typeof THREE === 'undefined') { document.body.innerHTML = '<p style="padding:20px;font:14px system-ui">⚠ three.js could not be loaded.</p>'; return; }
  App.applyTheme();
  V.init();
  UI.init();
  changed(); S.dirty = false;
  window.addEventListener('beforeunload', (e) => { if (S.dirty && itemsOf('mesh').length) { e.preventDefault(); e.returnValue = ''; } });
  App.updateEmpty(); UI.status();
  const fi = $('#fileIn');
  fi.onchange = () => { if (fi.files.length) App.openFiles(fi.files); fi.value = ''; };
  $('#dropHint .box').onclick = () => fi.click();
  // drag & drop anywhere in the window
  const dh = $('#dropHint'); let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; dh.classList.remove('hidden'); dh.classList.add('drag'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; dh.classList.remove('drag'); App.updateEmpty(); } });
  window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; dh.classList.remove('drag'); App.updateEmpty(); if (e.dataTransfer.files.length) App.openFiles(e.dataTransfer.files); });
  document.addEventListener('keydown', App.keys);
  App.initPWA();
  window.MeshView = { S, V, G, P, T, UI, App, Section, Motion };
};
document.addEventListener('DOMContentLoaded', App.init);
