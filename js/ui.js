'use strict';
/* ui.js — view toolbar, tree (meshes + coordinate systems), properties (General / View / Operations), tool window, drawers, dialogs */

const UI = { tab: store.get('tab', 'General'), fold: new Set(store.get('fold', [])), filter: '', anchor: null };

/* ---------- view toolbar ---------- */
UI.cmds = function () {
  const st = S.set;
  const filt = (f) => () => { st.filter = f; saveSettings(); if (T.active) T.cancel(); S.pick = null; P.show('pick', null); P.clearHover(); UI.refreshAll(); UI.status(); };
  const mode = (m) => () => { st.renderMode = m; saveSettings(); V.applyMode(); UI.refreshToolbar(); };
  return [
    { grp: 'Select', items: [
      { id: 'point', ic: 'point', tip: 'Select points (vertex snap)', on: () => st.filter === 'point', act: filt('point') },
      { id: 'edge', ic: 'edge', tip: 'Select edges (chains, circular rims)', on: () => st.filter === 'edge', act: filt('edge') },
      { id: 'face', ic: 'face', tip: 'Select faces (coplanar patches)', on: () => st.filter === 'face', act: filt('face') },
      { id: 'object', ic: 'object', tip: 'Select whole objects', on: () => st.filter === 'object', act: filt('object') }] },
    { grp: 'Tools', items: [
      { id: 'select', ic: 'select', tip: 'Select tool', on: () => !T.active && st.tool === 'select', act: () => UI.setTool('select') },
      { id: 'info', ic: 'info', tip: 'Information tool (inspect without changing the selection)', on: () => !T.active && st.tool === 'info', act: () => UI.setTool('info') },
      { id: 'dist', ic: 'ruler', tip: 'Measure distance', on: () => T.active && T.active.name === 'distance', act: () => (T.active && T.active.name === 'distance' ? T.cancel() : T.start('distance')) }] },
    { grp: 'Projection', items: [
      { id: 'persp', ic: 'persp', tip: 'Perspective projection', on: () => st.proj === 'persp', act: () => { V.setProjection('persp'); UI.refreshToolbar(); } },
      { id: 'ortho', ic: 'ortho', tip: 'Orthographic projection', on: () => st.proj === 'ortho', act: () => { V.setProjection('ortho'); UI.refreshToolbar(); } },
      { id: 'section', ic: 'section', tip: 'Section view (2D cut window)', tg: true, on: () => Section.open, act: () => Section.toggle() }] },
    { grp: 'Render mode', items: [
      { id: 'shaded', ic: 'shaded', tip: 'Shaded — each object uses its own opacity', on: () => st.renderMode === 'shaded', act: mode('shaded') },
      { id: 'wire', ic: 'wire', tip: 'Wireframe — edges only', on: () => st.renderMode === 'wire', act: mode('wire') },
      { id: 'opaque', ic: 'opaque', tip: 'Opaque — every object fully opaque', on: () => st.renderMode === 'opaque', act: mode('opaque') },
      { id: 'ghost', ic: 'ghost', tip: 'Ghost — everything transparent', on: () => st.renderMode === 'ghost', act: mode('ghost') }] },
    { grp: 'Display', items: [
      { id: 'names', ic: 'tag', tip: 'Object names in the view', tg: true, on: () => !!st.names, act: () => { st.names = st.names ? 0 : 1; saveSettings(); UI.refreshToolbar(); S.needRender = true; } },
      { id: 'envAll', ic: 'envelope', tip: 'Motion envelopes on / off (all objects)', tg: true, on: () => Motion.list().some(m => Motion.enabled(m).length && m.targets.length && m.env !== false), act: () => UI.toggleAllEnvelopes() },
      { id: 'colorFile', ic: 'folder', tip: 'Colour by file + legend', tg: true, on: () => st.colorByFile, act: () => { st.colorByFile = !st.colorByFile; saveSettings(); V.applyMode(); UI.refreshLegend(); UI.refreshTree(); UI.refreshToolbar(); Section.invalidate(); } },
      { id: 'edges', ic: 'edges', tip: 'Edge lines on / off', tg: true, on: () => st.edges, act: () => { st.edges = !st.edges; saveSettings(); V.applyMode(); UI.refreshToolbar(); } }] },
    { grp: 'Quality', items: [
      { id: 'res', ic: 'res', tip: 'Render resolution', tg: true, on: () => st.res !== 1, act: (e) => UI.resPop(e) },
      { id: 'redraw', ic: 'redraw', tip: 'Redraw (rebuild every 3D object)', act: () => UI.redraw() }] },
    { grp: 'Mouse', items: [
      { id: 'invX', ic: 'invX', tip: 'Invert mouse rotation left / right', tg: true, on: () => st.invX, act: () => { st.invX = !st.invX; saveSettings(); UI.refreshToolbar(); } },
      { id: 'invY', ic: 'invY', tip: 'Invert mouse rotation up / down', tg: true, on: () => st.invY, act: () => { st.invY = !st.invY; saveSettings(); UI.refreshToolbar(); } }] },
    { grp: 'Camera', items: [
      { id: 'fit', ic: 'fit', tip: 'Fit all (F)', act: () => V.fit() },
      { id: 'iso', ic: 'iso', tip: 'Isometric view', act: () => V.viewIso() },
      { id: 'vz', ic: 'viewZ', tip: 'View from +Z (top)', act: () => V.viewAxis(2, 1) },
      { id: 'vy', ic: 'viewY', tip: 'View from −Y (front)', act: () => V.viewAxis(1, -1) },
      { id: 'vx', ic: 'viewX', tip: 'View from +X (side)', act: () => V.viewAxis(0, 1) },
      { id: 'vn', ic: 'normal', tip: 'Look normal to the selected face (or click one)', act: () => (S.pick && S.pick.type === 'face' ? V.viewNormal(S.pick.n, S.pick.c) : T.start('lookNormal')) },
      { id: 'flip', ic: 'flip', tip: 'View from the opposite side', act: () => V.flipView() }] }
  ];
};
UI.buildToolbar = function () {
  const bar = $('#vtools'); bar.innerHTML = '';
  for (const g of this.cmds()) {
    const grp = h('div', { class: 'grp', role: 'group', 'aria-label': g.grp });
    for (const c of g.items) {
      const b = h('button', { class: c.tg ? 'tg' : '', title: c.tip, 'aria-label': c.tip, 'data-cmd': c.id, html: ic(c.ic) });
      b.addEventListener('click', (e) => { c.act(e); UI.refreshToolbar(); });
      grp.append(b);
    }
    bar.append(grp);
  }
  this.refreshToolbar();
};
UI.refreshToolbar = function () {
  for (const g of this.cmds()) for (const c of g.items) {
    const b = $(`#vtools [data-cmd="${c.id}"]`); if (!b) continue;
    b.classList.toggle('on', !!(c.on && c.on()));
  }
};
UI.setTool = function (t) {
  if (T.active) T.cancel(true);
  S.set.tool = t; saveSettings();
  UI.refreshToolbar(); UI.refreshToolwin(); UI.status();
};
UI.redraw = async function () {
  Load.show('Redraw'); Load.step('Rebuilding 3D objects', .3); await nextFrame();
  for (const rg of V.geoRender.values()) { rg.g.dispose(); rg.eg.dispose(); }
  V.geoRender.clear();
  for (const id of [...V.env.keys()]) V.disposeEnv(id);
  V.sync(true); Load.step('Done', 1); await nextFrame(); Load.hide(); toast('Redrawn');
};
UI.toggleAllEnvelopes = function () {
  const ms = Motion.list().filter(m => Motion.enabled(m).length && m.targets.length);
  if (!ms.length) { toast('No motion applied yet — use + in the Motions section of the tree'); return; }
  const on = !ms.some(m => m.env !== false);
  commit(() => ms.forEach(m => (Motion.get(m.id).env = on)));
};
UI.resPop = function (e) {
  const pop = $('#resPop');
  if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
  pop.innerHTML = '';
  const val = h('b', { text: '×' + S.set.res.toFixed(2) });
  const rng = h('input', { type: 'range', min: .25, max: 3, step: .05, value: S.set.res, 'aria-label': 'Render resolution' });
  rng.oninput = () => { S.set.res = +rng.value; val.textContent = '×' + S.set.res.toFixed(2); V.setPixelRatio(); saveSettings(); UI.refreshToolbar(); };
  pop.append(h('div', null, h('b', null, 'Render resolution '), val),
    h('div', { class: 'rr' }, h('span', { class: 'muted' }, 'coarse'), rng, h('span', { class: 'muted' }, 'fine')),
    h('div', { class: 'actions', style: { margin: '4px 0 0' } }, h('button', { class: 'btn sm', onclick: () => { S.set.res = 1; rng.value = 1; rng.oninput(); } }, 'Reset (×1)')));
  pop.classList.remove('hidden');
  const b = e.currentTarget.getBoundingClientRect(), vr = $('#viewport').getBoundingClientRect();
  pop.style.left = clamp(b.left - vr.left - 100, 6, vr.width - 260) + 'px'; pop.style.top = (b.bottom - vr.top + 6) + 'px';
};
UI.closePopups = function () { $('#resPop').classList.add('hidden'); $('#pickPop').classList.add('hidden'); UI.closeMenu(); };

/* ---------- context menus ---------- */
UI.closeMenu = function () { const c = $('#ctx'); if (c) c.remove(); };
UI.ctxMenu = function (x, y, entries) {
  UI.closeMenu();
  const m = h('div', { class: 'menu', id: 'ctx' });
  for (const d of entries) {
    if (d === '-') { m.append(h('hr')); continue; }
    if (d.h) { m.append(h('div', { class: 'mh', text: d.h })); continue; }
    const b = h('button', { class: 'mi' + (d.danger ? ' danger' : ''), disabled: d.dis ? true : null, html: ic(d.ic || 'right') });
    b.append(h('span', { text: d.t }));
    b.onclick = () => { UI.closeMenu(); d.fn(); };
    m.append(b);
  }
  document.body.append(m);
  m.style.left = clamp(x, 6, window.innerWidth - m.offsetWidth - 6) + 'px';
  m.style.top = clamp(y, 6, window.innerHeight - m.offsetHeight - 6) + 'px';
};
UI.csCreateMenu = function (x, y) {
  UI.ctxMenu(x, y, [
    { h: 'New coordinate system' },
    { ic: 'cs', t: 'From 3 points (origin, +X, XY plane)', fn: () => T.start('cs3') },
    { ic: 'face', t: 'On a face (Z = normal)', fn: () => T.start('csFace') },
    { ic: 'edge', t: 'On a circular edge (Z = axis)', fn: () => T.start('csRim') },
    { ic: 'plus', t: 'Copy of the active CS (edit numerically)', fn: () => { T.csChild(); UI.tab = 'General'; UI.refreshProps(); UI.drawer('right', true); } }]);
};

/* ---------- selection ---------- */
UI.select = function (id, o) {
  o = o || {};
  S.selGroup = null; S.selMotion = null;
  S.sel = id; S.multi = new Set(id == null ? [] : [id]); UI.anchor = id;
  if (!o.keepPick && S.pick && S.pick.id !== id) { S.pick = null; P.show('pick', null); }
  if (id != null && !o.keepPick && S.set.filter === 'object' && item(id) && item(id).kind === 'mesh') { S.pick = { type: 'object', id }; P.show('pick', S.pick); }
  V.applyMode(); UI.refreshTree(); UI.refreshProps(); UI.refreshToolwin();
  if (id != null && !o.silent && item(id)) UI.status(item(id).kind === 'mesh' ? P.summary({ type: 'object', id }) : item(id).name, true);
  S.needRender = true;
};
UI.selectGroup = function (gid) {
  S.selGroup = gid; S.selMotion = null; S.sel = null; S.pick = null; P.show('pick', null);
  S.multi = new Set(itemsOf('mesh').filter(m => m.group === gid).map(m => m.id));
  V.applyMode(); UI.refreshTree(); UI.refreshProps(); UI.refreshToolwin();
  UI.status(`Group · ${groupOf(gid).name} — ${S.multi.size} mesh(es)`, true);
};
UI.selectMotion = function (mid) {
  S.selMotion = mid; S.selGroup = null; S.sel = null; S.multi.clear(); S.pick = null; P.show('pick', null);
  V.applyMode(); UI.refreshTree(); UI.refreshProps(); UI.refreshToolwin();
  const m = Motion.get(mid); if (m) UI.status(`Motion · ${m.name} — ${Motion.summary(m)}`, true);
};
UI.toggleSel = function (id) {
  S.selGroup = null; S.selMotion = null;
  if (S.multi.has(id)) { S.multi.delete(id); if (S.sel === id) S.sel = S.multi.size ? [...S.multi][S.multi.size - 1] : null; }
  else { S.multi.add(id); S.sel = id; }
  UI.anchor = id;
  V.applyMode(); UI.refreshTree(); UI.refreshProps(); S.needRender = true;
};
UI.selMeshes = function () { return [...S.multi].map(item).filter(i => i && i.kind === 'mesh'); };
UI.deleteSel = async function () {
  if (S.selMotion) {
    const m = Motion.get(S.selMotion); if (!m) return;
    commit(() => { S.doc.motions = Motion.list().filter(x => x.id !== m.id); S.selMotion = null; });
    toast(`Motion "${m.name}" deleted`); return;
  }
  if (S.selGroup) {
    const g = groupOf(S.selGroup); const n = itemsOf('mesh').filter(m => m.group === g.id).length;
    if (!(await confirmDlg('Delete group', `Delete "${g.name}" and its ${n} mesh(es)? (Undo with Ctrl+Z)`, 'Delete', true))) return;
    S.multi = new Set(itemsOf('mesh').filter(m => m.group === g.id).map(m => m.id));
  }
  const ids = [...S.multi].filter(id => id !== 0);
  if (!ids.length) return;
  if (ids.length > 1 && !S.selGroup && !(await confirmDlg('Delete objects', `Delete ${ids.length} objects? (Undo with Ctrl+Z)`, 'Delete', true))) return;
  commit(() => {
    S.doc.items = S.doc.items.filter(i => !ids.includes(i.id));
    if (ids.includes(S.doc.activeCS)) S.doc.activeCS = 0;
    for (const i of S.doc.items) if (ids.includes(i.parent)) i.parent = null;
    S.doc.groups = S.doc.groups.filter(g => S.doc.items.some(i => i.group === g.id));
    UI.cleanMotions();
    S.sel = null; S.selGroup = null; S.multi.clear(); validateSel();
  });
  toast(`${ids.length} object${ids.length > 1 ? 's' : ''} deleted`);
};
/* drop references to deleted meshes / groups / coordinate systems */
UI.cleanMotions = function () {
  for (const m of Motion.list()) {
    m.targets = m.targets.filter(t => (Motion.isGroup(t) ? !!groupOf(t) : !!item(t)));
    if (m.cs !== 'centroid' && !item(m.cs)) m.cs = 0;
  }
};
UI.duplicate = function () {
  const src = [...S.multi].map(item).filter(i => i && i.id !== 0);
  if (!src.length) return;
  const ids = [];
  commit(() => { for (const s of src) { const c = JSON.parse(JSON.stringify(s)); c.id = newId(); c.name = s.name + ' (copy)'; S.doc.items.push(c); ids.push(c.id); } S.multi = new Set(ids); S.sel = ids[ids.length - 1]; });
  toast(`${ids.length} duplicated`);
};
UI.groupSelection = function () {
  const meshes = UI.selMeshes(); if (!meshes.length) return;
  commit(() => {
    const gid = 'g' + newId();
    S.doc.groups.push({ id: gid, name: 'Group ' + (S.doc.groups.length + 1), color: PALETTE[S.doc.groups.length % PALETTE.length] });
    meshes.forEach(m => (item(m.id).group = gid));
    S.doc.groups = S.doc.groups.filter(g => S.doc.items.some(i => i.group === g.id));
  });
};
UI.isolate = function (id) {
  commit(() => { for (const i of S.doc.items) if (i.kind === 'mesh') i.visible = i.id === id; }, { keepProps: true });
  V.fit(V.worldBox(id));
};
UI.showAll = function (kind, vis) {
  commit(() => { for (const i of S.doc.items) if ((!kind || i.kind === kind) && i.id !== 0) i.visible = vis; }, { keepProps: true });
};

/* ---------- tree ---------- */
UI.refreshTree = function () {
  const host = $('#tree'); const sc = host.scrollTop;
  host.innerHTML = '';
  const q = UI.filter.toLowerCase();
  const match = (it) => !q || it.name.toLowerCase().includes(q) || (it.file || '').toLowerCase().includes(q);
  host.append(h('div', { class: 'tree-tools' },
    h('input', { type: 'search', placeholder: 'Filter…', value: UI.filter, 'aria-label': 'Filter tree', oninput: (e) => { UI.filter = e.target.value; UI.refreshTree(); const i = $('#tree input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }),
    h('button', { class: 'ib', title: 'Expand all', 'aria-label': 'Expand all', html: ic('expand'), onclick: () => { UI.fold.clear(); UI.saveFold(); UI.refreshTree(); } }),
    h('button', { class: 'ib', title: 'Collapse all', 'aria-label': 'Collapse all', html: ic('collapse'), onclick: () => { ['meshes', 'cs', 'motions', ...S.doc.groups.map(g => g.id)].forEach(k => UI.fold.add(k)); UI.saveFold(); UI.refreshTree(); } })));

  const meshes = itemsOf('mesh');
  const sec = UI.tgroup('meshes', 'Meshes', meshes.length, meshes.length ? [
    h('button', { class: 'ib', title: 'Show all', html: ic('eye'), onclick: (e) => { e.stopPropagation(); UI.showAll('mesh', true); } }),
    h('button', { class: 'ib', title: 'Hide all', html: ic('eyeOff'), onclick: (e) => { e.stopPropagation(); UI.showAll('mesh', false); } })] : null);
  if (!meshes.length) sec.append(h('div', { class: 'tempty', text: 'Drop .stl / .obj files on the view.' }));
  else if (!UI.fold.has('meshes') || q) {
    for (const g of S.doc.groups) {
      const list = meshes.filter(m => m.group === g.id && match(m));
      if (!list.length) continue;
      const sub = h('div', { class: 'tsub' });
      sub.append(UI.subHeader(g));
      if (!UI.fold.has(g.id) || q) for (const m of list) sub.append(...UI.row(m));
      sec.append(sub);
    }
    for (const m of meshes.filter(m => !groupOf(m.group) && match(m))) sec.append(...UI.row(m));
  }
  host.append(sec);
  // coordinate systems (hierarchy)
  const all = itemsOf('cs');
  const cs = UI.tgroup('cs', 'Coordinate systems', all.length, [h('button', { class: 'ib', title: 'New coordinate system…', 'aria-label': 'New coordinate system', html: ic('plus'), onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); UI.csCreateMenu(r.left, r.bottom + 4); } })]);
  if (!UI.fold.has('cs') || q) {
    const done = new Set();
    const walk = (parent, depth) => {
      for (const c of all.filter(c => (c.parent || null) === parent && c.id !== 0 || (parent === null && c.id === 0))) {
        if (done.has(c.id)) continue; done.add(c.id);
        if (match(c)) cs.append(...UI.row(c, depth));
        if (c.id !== 0) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    for (const c of all) if (!done.has(c.id) && match(c)) cs.append(...UI.row(c, 0));
  }
  host.append(cs);
  // motions (standard motions, applied to meshes and / or groups)
  const mots = Motion.list();
  const ms = UI.tgroup('motions', 'Motions', mots.length, [h('button', { class: 'ib', title: 'New motion', 'aria-label': 'New motion', html: ic('plus'), onclick: (e) => { e.stopPropagation(); UI.newMotion([], 'centroid'); } })]);
  if (!mots.length) ms.append(h('div', { class: 'tempty', text: 'Click + to define a motion, then tick the meshes / groups it applies to — or drag them onto it.' }));
  else if (!UI.fold.has('motions') || q) for (const m of mots) if (!q || m.name.toLowerCase().includes(q)) ms.append(UI.motionRow(m));
  host.append(ms);
  host.scrollTop = sc;
};
UI.saveFold = function () { store.set('fold', [...UI.fold]); };
UI.tgroup = function (key, title, n, extra) {
  const sec = h('div', { class: 'tgroup' });
  sec.append(h('div', { class: 'tgh', onclick: () => { UI.fold.has(key) ? UI.fold.delete(key) : UI.fold.add(key); UI.saveFold(); UI.refreshTree(); } },
    h('span', { class: 'fold', text: UI.fold.has(key) ? '▸' : '▾' }), h('span', { text: title }), h('span', { class: 'cnt', text: n }), extra || null));
  return sec;
};
UI.motionChip = function (list, title) {
  const on = list.filter(m => Motion.enabled(m).length);
  if (!on.length) return null;
  return h('button', { class: 'chip mot' + (on.some(m => m.env !== false) ? ' on' : ''), title: title + on.map(m => `${m.name}: ${Motion.summary(m)}`).join('\n') + '\n(click to edit)',
    onclick: (e) => { e.stopPropagation(); UI.selectMotion(on[0].id); UI.drawer('right', true); } }, '⇄ ' + (on.length > 1 ? on.length : Motion.short(on[0])));
};
UI.subHeader = function (g) {
  const all = itemsOf('mesh').filter(m => m.group === g.id);
  const vis = all.some(m => m.visible);
  const nm = h('span', { class: 'nm', text: g.name, title: 'Click to select the group · double-click to rename' });
  const fold = h('span', { class: 'fold', text: UI.fold.has(g.id) ? '▸' : '▾', title: 'Fold / unfold', onclick: (e) => { e.stopPropagation(); UI.fold.has(g.id) ? UI.fold.delete(g.id) : UI.fold.add(g.id); UI.saveFold(); UI.refreshTree(); } });
  const hd = h('div', { class: 'tsubh' + (S.selGroup === g.id ? ' sel' : ''), draggable: 'true' },
    fold, h('span', { class: 'sw', style: { background: g.color } }), nm,
    UI.motionChip(Motion.forTarget(g.id), 'Group motions:\n'),
    h('span', { class: 'chip', text: all.length }),
    h('button', { class: 'ib', style: { width: '26px', height: '26px' }, title: vis ? 'Hide all' : 'Show all', html: ic(vis ? 'eye' : 'eyeOff'), onclick: (e) => { e.stopPropagation(); commit(() => all.forEach(m => (item(m.id).visible = !vis)), { keepProps: true }); } }));
  hd.onclick = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) { S.selGroup = null; S.selMotion = null; all.forEach(m => S.multi.add(m.id)); S.sel = all[0] && all[0].id; V.applyMode(); UI.refreshTree(); UI.refreshProps(); S.needRender = true; return; }
    UI.selectGroup(g.id);
  };
  hd.onmouseenter = () => { V.ovl.hover = []; V.clearHL('hover'); const b = new THREE.Box3(); all.forEach(m => b.union(V.worldBox(m.id))); if (!b.isEmpty()) { const hl = new THREE.Box3Helper(b, new THREE.Color(COL.hover)); hl.material.depthTest = false; hl.renderOrder = 950; V.hlGroup.add(hl); V.hl.hover = hl; S.needRender = true; } };
  hd.onmouseleave = () => P.hoverItem(null);
  nm.ondblclick = (e) => {
    e.stopPropagation();
    const inp = h('input', { value: g.name, 'aria-label': 'Group name' });
    nm.replaceWith(inp); inp.focus(); inp.select();
    let fin = false;
    const done = (ok) => { if (fin) return; fin = true; if (ok && inp.value.trim() && inp.value !== g.name) commit(() => { groupOf(g.id).name = inp.value.trim(); }); else UI.refreshTree(); };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); ev.stopPropagation(); };
    inp.onblur = () => done(true); inp.onclick = (ev) => ev.stopPropagation();
  };
  hd.oncontextmenu = (e) => { e.preventDefault(); UI.selectGroup(g.id); UI.ctxMenu(e.clientX, e.clientY, [
    { ic: 'eye', t: 'Show all', fn: () => commit(() => all.forEach(m => (item(m.id).visible = true)), { keepProps: true }) },
    { ic: 'eyeOff', t: 'Hide all', fn: () => commit(() => all.forEach(m => (item(m.id).visible = false)), { keepProps: true }) },
    { ic: 'fit', t: 'Zoom to group', fn: () => UI.zoomToTarget(g.id) },
    { ic: 'tag', t: 'Rename', fn: () => nm.ondblclick(new Event('x')) },
    '-',
    { ic: 'motion', t: 'New motion (CS at barycentre)', fn: () => UI.newMotionFor(g.id) },
    { ic: 'cs', t: 'CS at barycentre', fn: () => T.csAtCentroid(g.id) },
    '-',
    { ic: 'trash', t: 'Delete group and its meshes', danger: true, fn: () => UI.deleteSel() }]); };
  hd.ondragstart = (e) => { UI.dragGroup = g.id; UI.dragIds = null; e.dataTransfer.effectAllowed = 'copyMove'; try { e.dataTransfer.setData('text/plain', 'group'); } catch (_) { } };
  hd.ondragend = () => { UI.dragGroup = null; };
  hd.ondragover = (e) => { if (UI.dragIds) { e.preventDefault(); hd.classList.add('drop'); } };
  hd.ondragleave = () => hd.classList.remove('drop');
  hd.ondrop = (e) => { e.preventDefault(); hd.classList.remove('drop'); const ids = UI.dragIds; UI.dragIds = null; if (ids) commit(() => ids.forEach(id => (item(id).group = g.id))); };
  return hd;
};
UI.motionRow = function (m) {
  const on = m.env !== false;
  const r = h('div', { class: 'row' + (S.selMotion === m.id ? ' sel' : '') },
    h('button', { class: 'ib', title: on ? 'Hide envelope' : 'Show envelope', 'aria-label': 'Toggle envelope', html: ic(on ? 'eye' : 'eyeOff'), onclick: (e) => { e.stopPropagation(); commit(() => { Motion.get(m.id).env = !on; }, { keepProps: true }); } }),
    h('span', { class: 'mico', html: ic('motion'), style: { color: 'var(--accent)', display: 'inline-flex' } }),
    h('span', { class: 'nm', text: m.name, title: Motion.summary(m) }, h('span', { class: 'sec', text: Motion.short(m) })),
    h('span', { class: 'chip', title: m.targets.map(Motion.targetName).join('\n') || 'Not applied yet', text: '→ ' + m.targets.length }));
  r.onclick = () => UI.selectMotion(m.id);
  r.ondblclick = () => UI.zoomToMotion(m);
  r.oncontextmenu = (e) => { e.preventDefault(); UI.selectMotion(m.id); UI.ctxMenu(e.clientX, e.clientY, [
    { ic: on ? 'eyeOff' : 'eye', t: on ? 'Hide envelope' : 'Show envelope', fn: () => commit(() => { Motion.get(m.id).env = !on; }) },
    { ic: 'fit', t: 'Zoom to envelope', fn: () => UI.zoomToMotion(m) },
    { ic: 'copy', t: 'Duplicate', fn: () => UI.duplicateMotion(m) },
    '-', { ic: 'trash', t: 'Delete', danger: true, fn: () => UI.deleteSel() }]); };
  // drop meshes / groups on a motion to apply it to them
  r.ondragover = (e) => { if (UI.dragIds || UI.dragGroup) { e.preventDefault(); r.classList.add('dropb'); } };
  r.ondragleave = () => r.classList.remove('dropb');
  r.ondrop = (e) => {
    e.preventDefault(); r.classList.remove('dropb');
    const add = UI.dragGroup ? [UI.dragGroup] : (UI.dragIds || []);
    UI.dragIds = null; UI.dragGroup = null;
    const nw = add.filter(t => !m.targets.includes(t));
    if (nw.length) { commit(() => { Motion.get(m.id).targets.push(...nw); }); toast(`${m.name} applied to ${nw.map(Motion.targetName).join(', ')}`); }
  };
  return r;
};
UI.newMotion = function (targets, cs, name) {
  const m = Motion.create(name || 'Motion ' + (Motion.list().length + 1), cs, targets);
  commit(() => { Motion.list().push(m); });
  UI.tab = 'General'; store.set('tab', 'General');
  UI.selectMotion(m.id); UI.drawer('right', true);
  return m;
};
UI.newMotionFor = function (t) {
  const csId = T.csAtCentroid(t);
  return UI.newMotion([t], csId, 'Motion · ' + Motion.targetName(t));
};
UI.duplicateMotion = function (m) {
  const c = JSON.parse(JSON.stringify(m)); c.id = 'm' + newId(); c.name = m.name + ' (copy)';
  commit(() => Motion.list().push(c)); UI.selectMotion(c.id);
};
UI.zoomToMotion = function (m) {
  const b = new THREE.Box3();
  for (const e of V.env.values()) if (e.mid === m.id) b.union(e.box);
  for (const t of m.targets) Motion.members(t).forEach(it => { const wb = V.worldBox(it.id); if (wb) b.union(wb); });
  if (!b.isEmpty()) V.fit(b);
};
UI.zoomToTarget = function (t) {
  const b = new THREE.Box3();
  Motion.members(t).forEach(it => { const wb = V.worldBox(it.id); if (wb) b.union(wb); });
  for (const e of V.env.values()) if (e.t === t || Motion.members(e.t).some(it => Motion.members(t).includes(it))) b.union(e.box);
  if (!b.isEmpty()) V.fit(b);
};
UI.csUsed = function (c) {
  if (c.id === 0 || c.id === S.doc.activeCS) return true;
  return S.doc.items.some(i => i.parent === c.id) || Motion.list().some(m => m.cs === c.id && Motion.enabled(m).length) || (Section.open && Section.plane.startsWith('cs:' + c.id + ':'));
};
UI.row = function (it, depth) {
  const sel = S.multi.has(it.id);
  const mesh = it.kind === 'mesh';
  const r = h('div', { class: 'row' + (sel ? ' sel' : ''), draggable: mesh ? 'true' : null, 'data-id': it.id });
  if (depth) r.style.paddingLeft = (6 + depth * 14) + 'px';
  r.append(h('button', { class: 'ib', title: it.visible ? 'Hide' : 'Show', 'aria-label': it.visible ? 'Hide' : 'Show', html: ic(it.visible ? 'eye' : 'eyeOff'), onclick: (e) => { e.stopPropagation(); commit(() => { item(it.id).visible = !it.visible; }, { keepProps: true }); } }));
  if (it.kind === 'cs') r.append(h('span', { class: 'radio' + (it.id === S.doc.activeCS ? ' on' : ''), title: 'Set as active coordinate system', onclick: (e) => { e.stopPropagation(); commit(() => { S.doc.activeCS = it.id; }); } }));
  r.append(h('span', { class: 'sw', style: { background: V.itemColor(it) } }));
  const nm = h('span', { class: 'nm', text: it.name, title: it.name });
  if (S.set.secNames && mesh && it.file && it.file !== it.name) nm.append(h('span', { class: 'sec', text: '[' + it.file + ']' }));
  r.append(nm);
  if (it.kind === 'cs' && !UI.csUsed(it)) r.append(h('span', { class: 'hint w', text: '⚠', title: 'Unused coordinate system (not active, no motion refers to it)' }));
  if (mesh) { const c = UI.motionChip(Motion.forItem(it).map(x => x.m), 'Motions (incl. group):\n'); if (c) r.append(c); }
  if (mesh) {
    const ap = it.appearance || 'follow';
    r.append(h('button', { class: 'ib', title: 'Appearance: ' + { follow: 'follow global mode', opaque: 'always opaque', transparent: 'always transparent' }[ap] + ' (click to cycle)', html: ic({ follow: 'appear', opaque: 'appearO', transparent: 'appearT' }[ap]),
      onclick: (e) => { e.stopPropagation(); commit(() => { item(it.id).appearance = { follow: 'opaque', opaque: 'transparent', transparent: 'follow' }[ap]; }, { keepProps: true }); } }));
  }
  r.append(h('span', { class: 'chip', text: mesh ? ((it.file || '').split('.').pop().toUpperCase() || 'MESH') : it.id === 0 ? 'WORLD' : 'CS' }));
  r.onclick = (e) => {
    if (e.shiftKey && UI.anchor != null && item(UI.anchor) && item(UI.anchor).kind === it.kind) {
      const rows = $$('#tree .row').map(x => +x.dataset.id).filter(id => item(id) && item(id).kind === it.kind);
      const a = rows.indexOf(UI.anchor), b = rows.indexOf(it.id);
      if (a >= 0 && b >= 0) { S.multi = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1)); S.sel = it.id; V.applyMode(); UI.refreshTree(); UI.refreshProps(); S.needRender = true; return; }
    }
    if (e.ctrlKey || e.metaKey) UI.toggleSel(it.id); else UI.select(it.id);
  };
  r.ondblclick = () => UI.zoomTo(it);
  r.onmouseenter = () => P.hoverItem(it.id);
  r.onmouseleave = () => P.hoverItem(null);
  r.oncontextmenu = (e) => { e.preventDefault(); if (!S.multi.has(it.id)) UI.select(it.id); UI.ctxMenu(e.clientX, e.clientY, UI.rowMenu(it)); };
  if (mesh) {
    r.ondragstart = (e) => { UI.dragGroup = null; UI.dragIds = S.multi.has(it.id) ? [...S.multi].filter(id => item(id) && item(id).kind === 'mesh') : [it.id]; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'mesh'); } catch (_) { } };
    r.ondragend = () => { UI.dragIds = null; };
    r.ondragover = (e) => { if (UI.dragIds && !UI.dragIds.includes(it.id)) { e.preventDefault(); r.classList.add('dropb'); } };
    r.ondragleave = () => r.classList.remove('dropb');
    r.ondrop = (e) => {
      e.preventDefault(); r.classList.remove('dropb'); const ids = UI.dragIds; UI.dragIds = null; if (!ids) return;
      commit(() => {
        const moving = S.doc.items.filter(i => ids.includes(i.id));
        S.doc.items = S.doc.items.filter(i => !ids.includes(i.id));
        const at = S.doc.items.findIndex(i => i.id === it.id) + 1;
        moving.forEach(m => (m.group = it.group));
        S.doc.items.splice(at, 0, ...moving);
      });
    };
  }
  const out = [r];
  if (sel && S.multi.size === 1 && mesh) {
    const val = h('span', { text: Math.round((it.opacity != null ? it.opacity : 1) * 100) + '%', style: { width: '36px', textAlign: 'right' } });
    const rng = h('input', { type: 'range', min: 0, max: 100, value: Math.round((it.opacity != null ? it.opacity : 1) * 100), 'aria-label': 'Opacity' });
    UI.live(rng, () => { item(it.id).opacity = rng.value / 100; val.textContent = rng.value + '%'; });
    out.push(h('div', { class: 'oprow' }, 'Opacity', rng, val));
  }
  return out;
};
UI.rowMenu = function (it) {
  const mesh = it.kind === 'mesh';
  const m = [
    { ic: 'tag', t: 'Rename', fn: () => { UI.select(it.id); UI.tab = 'General'; UI.refreshProps(); UI.drawer('right', true); setTimeout(() => { const i = $('#props input[data-f=name]'); if (i) { i.focus(); i.select(); } }, 50); } },
    { ic: 'eye', t: 'Show', fn: () => commit(() => { for (const id of S.multi) item(id).visible = true; }, { keepProps: true }) },
    { ic: 'eyeOff', t: 'Hide', fn: () => commit(() => { for (const id of S.multi) item(id).visible = false; }, { keepProps: true }) }
  ];
  if (mesh) m.push({ ic: 'fit', t: 'Isolate', fn: () => UI.isolate(it.id) });
  m.push({ ic: 'fit', t: 'Zoom to', fn: () => UI.zoomTo(it) });
  if (mesh) m.push('-', { ic: 'motion', t: 'New motion (CS at barycentre)', fn: () => UI.newMotionFor(it.id) },
    { ic: 'motion', t: 'Motions…', fn: () => { UI.select(it.id); UI.tab = 'Operations'; store.set('tab', 'Operations'); UI.refreshProps(); UI.drawer('right', true); } },
    { ic: 'cs', t: 'CS at barycentre', fn: () => T.csAtCentroid(it.id) },
    { ic: 'folder', t: 'Group selected meshes', fn: () => UI.groupSelection() },
    { ic: 'copy', t: 'Duplicate', fn: () => UI.duplicate() });
  if (it.kind === 'cs') m.push('-', { ic: 'cs', t: 'Set active', fn: () => commit(() => { S.doc.activeCS = it.id; }) }, { ic: 'cs', t: 'Create child CS', fn: () => { commit(() => { S.doc.activeCS = it.id; }); T.csChild(); } }, { ic: 'section', t: 'Section on its XY plane', fn: () => UI.sectionOn('cs:' + it.id + ':XY') });
  m.push('-', { ic: 'trash', t: 'Delete', danger: true, dis: it.id === 0, fn: () => UI.deleteSel() });
  return m;
};
UI.sectionOn = function (key) { Section.plane = key; Section.offset = 0; Section.view = null; if (Section.open) { Section.buildOpts(); Section.invalidate(); } else Section.toggle(true); };
UI.zoomTo = function (it) {
  if (it.kind === 'mesh') UI.zoomToTarget(it.id);
  else if (it.kind === 'cs') { const p = new THREE.Vector3().fromArray(it.o); V.fit(new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(1, 1, 1).multiplyScalar(V.diag() * 0.25))); }
};
UI.live = function (input, apply, after) {
  let pre = null;
  input.addEventListener('input', () => { if (pre == null) pre = snapshot(); apply(); V.sync(); S.needRender = true; Section.invalidate(); if (after) after(); });
  input.addEventListener('change', () => { if (pre != null) { S.undo.push(pre); S.redo.length = 0; pre = null; changed({ keepProps: true }); } });
};

/* ---------- properties ---------- */
UI.refreshProps = function () {
  const host = $('#props'); const sc = host.scrollTop;
  host.innerHTML = '';
  if (S.pick && S.pick.type !== 'object' && item(S.pick.id)) {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Pick'));
    const c = P.card(S.pick); if (c) sec.append(c);
    host.append(sec);
  }
  if (S.selMotion && Motion.get(S.selMotion)) { UI.tabbed(host, Motion.get(S.selMotion), UI.motionProps); host.scrollTop = sc; return; }
  if (S.selGroup && groupOf(S.selGroup)) { UI.tabbed(host, groupOf(S.selGroup), UI.groupProps); host.scrollTop = sc; return; }
  if (S.multi.size > 1) { host.append(UI.multiProps()); host.scrollTop = sc; return; }
  const it = S.sel != null ? item(S.sel) : null;
  if (!it) { if (!host.children.length) host.append(UI.sceneSummary()); return; }
  const tabs = ['General', 'View', 'Operations'];
  if (!tabs.includes(UI.tab)) UI.tab = 'General';
  host.append(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t => h('button', { class: 'tab' + (UI.tab === t ? ' on' : ''), role: 'tab', onclick: () => { UI.tab = t; store.set('tab', t); UI.refreshProps(); } }, t))));
  const body = h('div');
  ({ General: UI.propGeneral, View: UI.propView, Operations: UI.propOps })[UI.tab].call(UI, it, body);
  host.append(body);
  host.scrollTop = sc;
};
UI.tabbed = function (host, obj, fn) {
  const tabs = ['General', 'View', 'Operations'];
  if (!tabs.includes(UI.tab)) UI.tab = 'General';
  host.append(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t => h('button', { class: 'tab' + (UI.tab === t ? ' on' : ''), role: 'tab', onclick: () => { UI.tab = t; store.set('tab', t); UI.refreshProps(); } }, t))));
  const body = h('div'); fn.call(UI, obj, UI.tab, body); host.append(body);
};
UI.sceneSummary = function () {
  const meshes = itemsOf('mesh');
  if (!meshes.length) return h('div', { class: 'empty', html: ic('cube') + '<div>Nothing loaded yet.</div><div style="margin-top:4px">Drop STL / OBJ files on the view, then click an object in the view or in the tree.</div>' });
  let nf = 0; for (const m of meshes) nf += (S.geo.get(m.geo) || { nf: 0 }).nf;
  const b = V.computeBox(); const s = b.getSize(new THREE.Vector3());
  const nMot = Motion.list().length;
  return h('div', { class: 'sec' }, h('h4', null, 'Scene'), h('div', { class: 'card' }, kvTable([
    ['Files', S.doc.groups.length], ['Meshes', meshes.length], ['Triangles', nf.toLocaleString('en-US')], ['Motions', nMot],
    ['Visible box', `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} cm`], ['Min', fmtV(b.min)], ['Max', fmtV(b.max)], ['File units', S.set.units]])),
  h('div', { class: 'muted', style: { fontSize: '12.5px', margin: '8px 2px' } }, 'Select an object to edit its properties.'));
};
UI.fld = function (label, input, cls) { return h('div', { class: 'fld' + (cls ? ' ' + cls : '') }, h('label', null, label), input); };
UI.numInput = function (val, onCommit, o) {
  o = o || {};
  const inp = h('input', { type: 'number', step: o.step || S.set.step, value: +(+val).toFixed(6), 'aria-label': o.label || 'value' });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) onCommit(v); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
  inp.addEventListener('wheel', (e) => { if (document.activeElement !== inp) return; e.preventDefault(); const st = +inp.step || 1; inp.value = +(parseFloat(inp.value || 0) + (e.deltaY < 0 ? st : -st)).toFixed(6); inp.dispatchEvent(new Event('change')); }, { passive: false });
  return inp;
};
UI.vecField = function (label, arr, onCommit, pickKind, o) {
  o = o || {};
  const wrap = h('div', { class: 'vecrow' });
  const f = h('div', { class: 'fields' });
  const names = o.names || ['X', 'Y', 'Z'];
  arr.forEach((v, k) => f.append(UI.fld(names[k] + (o.unit ? ' (' + o.unit + ')' : ''), UI.numInput(v, (nv) => { const a = arr.slice(); a[k] = nv; onCommit(a); }, { label: label + ' ' + names[k], step: o.step }))));
  wrap.append(f);
  if (pickKind) wrap.append(h('button', { class: 'pickb', title: 'Pick in the view', 'aria-label': 'Pick ' + label + ' in the view', html: ic('pick'), onclick: () => T.pickValue(pickKind, (p) => onCommit(p.toArray().map(v => +v.toFixed(9))), 'Pick a value · ' + label) }));
  return h('div', { style: { marginBottom: '8px' } }, h('div', { class: 'muted', style: { fontSize: '11.5px', marginBottom: '3px' } }, label), wrap);
};
UI.set = function (id, fn, opts) { commit(() => fn(item(id)), opts); };

UI.propGeneral = function (it, body) {
  const sec = h('div', { class: 'sec' }, h('h4', null, 'Identity'));
  const name = h('input', { type: 'text', value: it.name, 'data-f': 'name', 'aria-label': 'Name' });
  name.onchange = () => { const v = name.value.trim(); if (v) UI.set(it.id, x => (x.name = v)); };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); };
  sec.append(h('div', { class: 'fields one' }, UI.fld('Name', name)));
  if (it.kind === 'mesh') {
    const t = S.geo.get(it.geo);
    const rows = [['File', esc(it.file || '—')], ['Triangles', t.nf.toLocaleString('en-US')], ['Vertices', t.nv.toLocaleString('en-US')], ['Units', (it.units || 'mm') + ' → cm']];
    if (t.collapsed) rows.push(['Removed', t.collapsed + ' degenerate triangle(s)']);
    sec.append(h('div', { class: 'card' }, kvTable(rows)));
    sec.append(h('div', { class: 'fields one', style: { marginTop: '8px' } }, UI.fld('Group', h('select', { 'aria-label': 'Group', onchange: (e) => UI.set(it.id, x => (x.group = e.target.value)) }, S.doc.groups.map(g => h('option', { value: g.id, selected: g.id === it.group ? 'selected' : null }, g.name))))));
    body.append(sec);
    return;
  }
  // coordinate system
  body.append(sec);
  if (it.id === 0) { sec.append(h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'World coordinate system (fixed).')); }
  else {
    sec.append(h('div', { class: 'fields one' }, UI.fld('Parent', h('select', { 'aria-label': 'Parent', onchange: (e) => UI.set(it.id, x => (x.parent = +e.target.value || null)) },
      h('option', { value: 0 }, '— none —'), itemsOf('cs').filter(c => c.id !== 0 && c.id !== it.id).map(c => h('option', { value: c.id, selected: c.id === it.parent ? 'selected' : null }, c.name))))));
  }
  sec.append(h('div', { class: 'actions' }, h('button', { class: 'btn sm' + (S.doc.activeCS === it.id ? ' primary' : ''), onclick: () => UI.set(it.id, () => (S.doc.activeCS = it.id)) }, S.doc.activeCS === it.id ? '● Active coordinate system' : 'Set as active')));
  if (it.id === 0) return;
  const d = h('div', { class: 'sec' }, h('h4', null, 'Definition'));
  d.append(UI.vecField('Origin', it.o, (a) => UI.set(it.id, x => (x.o = a)), 'point', { unit: 'cm' }));
  d.append(UI.vecField('Rotation (°, XYZ order)', it.r, (a) => UI.set(it.id, x => (x.r = a)), null, { step: 5 }));
  const m = P.csMatrix(it);
  const ax = [0, 1, 2].map(k => new THREE.Vector3().setFromMatrixColumn(m, k));
  d.append(h('div', { class: 'card' }, kvTable([['X axis', fmtV(ax[0])], ['Y axis', fmtV(ax[1])], ['Z axis', fmtV(ax[2])]])));
  d.append(h('div', { class: 'actions' },
    h('button', { class: 'btn sm', onclick: () => T.pickValue('dir', (n) => { const z = n.clone().normalize(); let x = ax[0].clone().addScaledVector(z, -ax[0].dot(z)); if (x.lengthSq() < 1e-8) { x = new THREE.Vector3(1, 0, 0); if (Math.abs(x.dot(z)) > .9) x.set(0, 1, 0); x.addScaledVector(z, -x.dot(z)); } x.normalize(); UI.set(it.id, c => (c.r = T.eulerDeg(x, z.clone().cross(x), z))); }, 'Pick Z axis') }, 'Z axis from…'),
    h('button', { class: 'btn sm', onclick: () => T.pickValue('dir', (n) => { const z = ax[2]; let x = n.clone().addScaledVector(z, -n.dot(z)); if (x.lengthSq() < 1e-8) { toast('⚠ Direction is parallel to Z'); return; } x.normalize(); UI.set(it.id, c => (c.r = T.eulerDeg(x, z.clone().cross(x), z))); }, 'Pick X axis') }, 'X axis from…'),
    h('button', { class: 'btn sm', onclick: () => UI.set(it.id, c => { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...c.r.map(v => v * Math.PI / 180), 'XYZ')).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'); c.r = [e.x, e.y, e.z].map(v => +(v * 180 / Math.PI).toFixed(6)); }) }, 'Flip Z')));
  body.append(d);
};
UI.propView = function (it, body) {
  const sec = h('div', { class: 'sec' }, h('h4', null, 'Appearance'));
  const f = h('div', { class: 'fields two' });
  const col = h('input', { type: 'color', value: it.color, 'aria-label': 'Colour' });
  UI.live(col, () => { item(it.id).color = col.value; });
  f.append(UI.fld('Colour', col));
  f.append(UI.fld('Visibility', h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: it.visible, onchange: (e) => UI.set(it.id, x => (x.visible = e.target.checked)) }), 'Visible')));
  if (it.kind === 'mesh') {
    const val = h('span', { text: Math.round((it.opacity != null ? it.opacity : 1) * 100) + '%' });
    const rng = h('input', { type: 'range', min: 0, max: 100, value: Math.round((it.opacity != null ? it.opacity : 1) * 100), style: { accentColor: 'var(--accent)' }, 'aria-label': 'Opacity' });
    UI.live(rng, () => { item(it.id).opacity = rng.value / 100; val.textContent = rng.value + '%'; });
    f.append(h('div', { class: 'fld span' }, h('label', null, 'Opacity ', val), rng));
    f.append(UI.fld('Appearance', h('select', { 'aria-label': 'Appearance', onchange: (e) => UI.set(it.id, x => (x.appearance = e.target.value)) },
      [['follow', 'Follow global mode'], ['opaque', 'Always opaque'], ['transparent', 'Always transparent']].map(([v, l]) => h('option', { value: v, selected: (it.appearance || 'follow') === v ? 'selected' : null }, l))), 'span'));
  }
  sec.append(f); body.append(sec);
  if (S.set.colorByFile && it.kind === 'mesh') body.append(h('div', { class: 'sec' }, h('div', { class: 'warnline', text: '⚠ “Colour by file” is on: the group colour is shown instead of this colour.' })));
};

/* Operations: motion definition + information + actions */
UI.propOps = function (it, body) {
  if (it.kind === 'mesh') body.append(UI.motionsFor(it.id));
  const sec = h('div', { class: 'sec' }, h('h4', null, 'Information'));
  if (it.kind === 'mesh') { const c = P.card({ type: 'object', id: it.id }); if (c) sec.append(c); }
  if (it.kind === 'cs') {
    const users = Motion.list().filter(m => m.cs === it.id);
    sec.append(h('div', { class: 'card' }, kvTable([['Origin', fmtV(new THREE.Vector3().fromArray(it.o))], ['Rotation', it.r.map(v => fmt(v, 3)).join(', ') + ' °'], ['Used by motions', users.length ? users.map(u => esc(u.name)).join(', ') : '—']])));
  }
  body.append(sec);
  const s2 = h('div', { class: 'sec' }, h('h4', null, 'Operations'));
  const acts = [['Zoom to', () => UI.zoomTo(it)]];
  if (it.kind === 'mesh') acts.push(['Isolate', () => UI.isolate(it.id)], ['Show all', () => UI.showAll(null, true)], ['Duplicate', () => UI.duplicate()]);
  if (it.kind === 'cs') acts.push(['Set active', () => UI.set(it.id, () => (S.doc.activeCS = it.id))], ['Child CS', () => { UI.set(it.id, () => (S.doc.activeCS = it.id)); T.csChild(); }], ['Section XY', () => UI.sectionOn('cs:' + it.id + ':XY')]);
  s2.append(h('div', { class: 'actions' }, acts.map(([l, f]) => h('button', { class: 'btn sm', onclick: f }, l))));
  if (it.id !== 0) s2.append(h('div', { class: 'actions' }, h('button', { class: 'btn sm danger', onclick: () => UI.deleteSel(), html: ic('trash') + 'Delete' })));
  body.append(s2);
};
/* motions applied to a mesh or a group (Operations tab) */
UI.motionsFor = function (t) {
  const sec = h('div', { class: 'sec' }, h('h4', null, 'Motions'));
  const isG = Motion.isGroup(t);
  const grp = !isG && item(t) ? item(t).group : null;
  const list = Motion.list();
  if (!list.length) sec.append(h('div', { class: 'muted', style: { fontSize: '12.5px', marginBottom: '6px' } }, 'No motion defined yet.'));
  for (const m of list) {
    const direct = m.targets.includes(t), via = grp && m.targets.includes(grp);
    sec.append(h('div', { class: 'mrow' },
      h('input', { type: 'checkbox', checked: direct, title: direct ? 'Applied — click to remove' : 'Apply this motion', 'aria-label': 'Apply ' + m.name,
        onchange: (e) => commit(() => { const mm = Motion.get(m.id); mm.targets = mm.targets.filter(x => x !== t); if (e.target.checked) mm.targets.push(t); }) }),
      h('div', { class: 'nm' }, h('b', null, m.name, via ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ' · via group') : null), h('small', null, Motion.summary(m))),
      h('a', { onclick: () => UI.selectMotion(m.id) }, 'Edit')));
  }
  sec.append(h('div', { class: 'actions' },
    h('button', { class: 'btn sm primary', onclick: () => UI.newMotionFor(t), title: 'Creates a coordinate system at the barycentre (axes = global) and a motion in it' }, 'New motion (CS at barycentre)'),
    h('button', { class: 'btn sm', onclick: () => UI.newMotion([t], S.doc.activeCS, 'Motion · ' + Motion.targetName(t)) }, 'New motion (active CS)'),
    h('button', { class: 'btn sm', onclick: () => T.csAtCentroid(t) }, 'CS at barycentre')));
  return sec;
};

/* motion entity: General (definition) / View (envelope) / Operations (targets) */
UI.setM = function (mid, fn, opts) { commit(() => fn(Motion.get(mid)), opts); };
UI.motionProps = function (m, tab, body) {
  if (tab === 'General') {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Motion'));
    const name = h('input', { type: 'text', value: m.name, 'data-f': 'name', 'aria-label': 'Name' });
    name.onchange = () => { const v = name.value.trim(); if (v) UI.setM(m.id, x => (x.name = v)); };
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); };
    sec.append(h('div', { class: 'fields one' }, UI.fld('Name', name)));
    const csSel = h('select', { 'aria-label': 'Motion coordinate system', onchange: (e) => UI.setM(m.id, x => (x.cs = e.target.value === 'centroid' ? 'centroid' : +e.target.value)) },
      h('option', { value: 'centroid', selected: m.cs === 'centroid' ? 'selected' : null }, '⊙ Barycentre (per target, global axes)'),
      itemsOf('cs').map(c => h('option', { value: c.id, selected: c.id === m.cs ? 'selected' : null }, c.id === 0 ? 'Global' : c.name)));
    const one = m.targets.length === 1;
    sec.append(h('div', { class: 'vecrow', style: { margin: '8px 0 10px' } },
      h('div', { class: 'fields one', style: { flex: 1 } }, UI.fld('Coordinate system', csSel)),
      h('button', { class: 'btn sm', style: { height: '32px' }, disabled: one ? null : true, title: one ? 'Create a CS at the barycentre of ' + Motion.targetName(m.targets[0]) + ' (axes = global) and use it' : 'Available when the motion has exactly one target',
        onclick: () => { const id = T.csAtCentroid(m.targets[0]); UI.setM(m.id, x => (x.cs = id)); } }, 'CS at barycentre')));
    // DOF table
    const tbl = h('div', { class: 'dofs' });
    tbl.append(h('div', { class: 'dofh' }, h('span'), h('span', null, 'Min'), h('span', null, 'Max'), h('span')));
    for (const k of Motion.DOFS) {
      const d = m.dofs[k], rot = k[0] === 'r', unit = rot ? '°' : 'cm';
      const clampV = (q) => { q.v = clamp(q.v, Math.min(q.min, q.max), Math.max(q.min, q.max)); };
      tbl.append(h('div', { class: 'dof' + (d.on ? ' on' : '') },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: d.on, onchange: (e) => UI.setM(m.id, x => { x.dofs[k].on = e.target.checked; }) }), h('b', null, Motion.LABEL[k])),
        UI.numInput(d.min, (v) => UI.setM(m.id, x => { const q = x.dofs[k]; q.min = v; q.on = true; clampV(q); }), { step: rot ? 1 : S.set.step, label: Motion.LABEL[k] + ' min' }),
        UI.numInput(d.max, (v) => UI.setM(m.id, x => { const q = x.dofs[k]; q.max = v; q.on = true; clampV(q); }), { step: rot ? 1 : S.set.step, label: Motion.LABEL[k] + ' max' }),
        h('span', { class: 'muted' }, unit)));
      if (d.on) {
        const lo = Math.min(d.min, d.max), hi = Math.max(d.min, d.max);
        const val = h('span', { class: 'tabnum', text: fmt(d.v, 2) + ' ' + unit });
        const rng = h('input', { type: 'range', min: lo, max: hi, step: (hi - lo) / 200 || 1, value: d.v, 'aria-label': Motion.LABEL[k] + ' current position' });
        UI.live(rng, () => { Motion.get(m.id).dofs[k].v = +rng.value; val.textContent = fmt(+rng.value, 2) + ' ' + unit; });
        tbl.append(h('div', { class: 'dofs-cur' }, h('span', { class: 'muted' }, 'current'), rng, val));
      }
    }
    sec.append(tbl);
    sec.append(h('div', { class: 'fields two', style: { marginTop: '10px' } },
      UI.fld('Intermediate positions', UI.numInput(m.steps || 0, (v) => UI.setM(m.id, x => (x.steps = clamp(Math.round(v), 0, 20))), { step: 1, label: 'Intermediate positions' }))));
    sec.append(h('div', { class: 'muted', style: { fontSize: '12px', margin: '8px 0 4px' } }, 'Rotations turn about the CS axes through its origin, then translations move along its axes. Group motions are applied before object motions.'));
    sec.append(h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => UI.setM(m.id, x => Motion.DOFS.forEach(k => (x.dofs[k].v = 0))) }, 'Back to nominal')));
    body.append(sec);
    if (!m.targets.length) body.append(h('div', { class: 'sec' }, h('div', { class: 'warnline' }, '⚠ Not applied to anything yet — see the Operations tab, or drag meshes / groups onto the motion in the tree.')));
  } else if (tab === 'View') {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Envelope'));
    sec.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: m.env !== false, onchange: (e) => UI.setM(m.id, x => (x.env = e.target.checked)) }), 'Show the envelope (extreme positions as one object per target)'));
    const eo = h('input', { type: 'range', min: 5, max: 80, value: Math.round((m.envOpacity != null ? m.envOpacity : .22) * 100), style: { accentColor: 'var(--accent)' }, 'aria-label': 'Envelope opacity' });
    UI.live(eo, () => { Motion.get(m.id).envOpacity = eo.value / 100; V.applyMode(); });
    sec.append(h('div', { class: 'fld', style: { marginTop: '6px' } }, h('label', null, 'Envelope opacity'), eo));
    const rows = [];
    for (const e of V.env.values()) if (e.mid === m.id) rows.push([esc(Motion.targetName(e.t)), e.count + ' position(s)']);
    sec.append(h('div', { class: 'card' }, rows.length ? kvTable(rows) : h('div', { class: 'muted' }, 'No envelope shown (no DOF ticked, no visible target, or envelope off).')));
    sec.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'The envelope takes the colour of its target (mesh or group).'));
    body.append(sec);
  } else {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Applies to'));
    const tl = h('div', { class: 'tlist' });
    const toggle = (t, on) => UI.setM(m.id, x => { x.targets = x.targets.filter(y => y !== t); if (on) x.targets.push(t); });
    for (const g of S.doc.groups) {
      const mem = itemsOf('mesh').filter(it => it.group === g.id); if (!mem.length) continue;
      tl.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: m.targets.includes(g.id), onchange: (e) => toggle(g.id, e.target.checked) }), h('span', { class: 'sw', style: { background: g.color } }), h('b', null, g.name), h('span', { class: 'muted' }, ` group · ${mem.length}`)));
      for (const it of mem) tl.append(h('label', { class: 'chk sub' }, h('input', { type: 'checkbox', checked: m.targets.includes(it.id), onchange: (e) => toggle(it.id, e.target.checked) }), it.name));
    }
    for (const it of itemsOf('mesh').filter(x => !groupOf(x.group))) tl.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: m.targets.includes(it.id), onchange: (e) => toggle(it.id, e.target.checked) }), it.name));
    if (!itemsOf('mesh').length) tl.append(h('div', { class: 'muted', text: 'Drop STL / OBJ files first.' }));
    sec.append(tl, h('div', { class: 'muted', style: { fontSize: '12px', margin: '6px 0' } }, 'Tick a group to move it as a whole (one envelope for the group), or individual meshes. You can also drag meshes / groups from the tree onto the motion.'));
    body.append(sec);
    const s2 = h('div', { class: 'sec' }, h('h4', null, 'Operations'));
    s2.append(h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => UI.zoomToMotion(m) }, 'Zoom to envelope'),
      h('button', { class: 'btn sm', onclick: () => UI.setM(m.id, x => Motion.DOFS.forEach(k => (x.dofs[k].v = 0))) }, 'Back to nominal'),
      h('button', { class: 'btn sm', onclick: () => UI.duplicateMotion(m) }, 'Duplicate'),
      h('button', { class: 'btn sm danger', onclick: () => UI.deleteSel(), html: ic('trash') + 'Delete' })));
    body.append(s2);
  }
};

/* mesh group (one per imported file, or user group) */
UI.groupProps = function (g, tab, body) {
  const mem = itemsOf('mesh').filter(m => m.group === g.id);
  const setG = (fn, opts) => commit(() => fn(groupOf(g.id), itemsOf('mesh').filter(m => m.group === g.id)), opts);
  if (tab === 'General') {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Group'));
    const name = h('input', { type: 'text', value: g.name, 'data-f': 'name', 'aria-label': 'Name' });
    name.onchange = () => { const v = name.value.trim(); if (v) setG(x => (x.name = v)); };
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); };
    sec.append(h('div', { class: 'fields one' }, UI.fld('Name', name)));
    let nf = 0; mem.forEach(m => (nf += S.geo.get(m.geo).nf));
    sec.append(h('div', { class: 'card' }, kvTable([['Meshes', mem.length], ['Triangles', nf.toLocaleString('en-US')], ['Barycentre', fmtV(Motion.centroid(g.id))], ['Members', mem.map(m => esc(m.name)).join(', ')]])));
    body.append(sec);
  } else if (tab === 'View') {
    const sec = h('div', { class: 'sec' }, h('h4', null, 'Appearance (all meshes of the group)'));
    const f = h('div', { class: 'fields two' });
    const col = h('input', { type: 'color', value: g.color, 'aria-label': 'Colour' });
    UI.live(col, () => { groupOf(g.id).color = col.value; itemsOf('mesh').filter(m => m.group === g.id).forEach(m => (m.color = col.value)); UI.refreshLegend(); });
    f.append(UI.fld('Colour', col));
    f.append(UI.fld('Visibility', h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: mem.every(m => m.visible), onchange: (e) => setG((x, ms) => ms.forEach(m => (m.visible = e.target.checked))) }), 'Visible')));
    const rng = h('input', { type: 'range', min: 0, max: 100, value: Math.round((mem[0] && mem[0].opacity != null ? mem[0].opacity : 1) * 100), style: { accentColor: 'var(--accent)' }, 'aria-label': 'Opacity' });
    UI.live(rng, () => itemsOf('mesh').filter(m => m.group === g.id).forEach(m => (m.opacity = rng.value / 100)));
    f.append(h('div', { class: 'fld span' }, h('label', null, 'Opacity'), rng));
    f.append(UI.fld('Appearance', h('select', { onchange: (e) => setG((x, ms) => ms.forEach(m => (m.appearance = e.target.value))) }, h('option', { value: '' }, '— choose —'), [['follow', 'Follow global mode'], ['opaque', 'Always opaque'], ['transparent', 'Always transparent']].map(([v, l]) => h('option', { value: v }, l))), 'span'));
    sec.append(f); body.append(sec);
  } else {
    body.append(UI.motionsFor(g.id));
    const b = new THREE.Box3(); mem.forEach(m => b.union(V.worldBox(m.id))); const s = b.getSize(new THREE.Vector3());
    body.append(h('div', { class: 'sec' }, h('h4', null, 'Information'), h('div', { class: 'card' }, kvTable([['Box min', fmtV(b.min)], ['Box max', fmtV(b.max)], ['Size', `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} cm`]]))),
      h('div', { class: 'sec' }, h('h4', null, 'Operations'), h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onclick: () => UI.zoomToTarget(g.id) }, 'Zoom to'),
        h('button', { class: 'btn sm', onclick: () => commit(() => itemsOf('mesh').forEach(m => (m.visible = m.group === g.id))) }, 'Isolate'),
        h('button', { class: 'btn sm', onclick: () => UI.showAll('mesh', true) }, 'Show all'),
        h('button', { class: 'btn sm danger', onclick: () => UI.deleteSel(), html: ic('trash') + 'Delete' }))));
  }
};
UI.multiProps = function () {
  const ids = [...S.multi].filter(id => item(id)); const its = ids.map(item);
  const sec = h('div', { class: 'sec' }, h('h4', null, `${its.length} objects selected`));
  const f = h('div', { class: 'fields two' });
  const col = h('input', { type: 'color', value: its[0].color, 'aria-label': 'Colour' });
  UI.live(col, () => its.forEach(i => (item(i.id).color = col.value)));
  f.append(UI.fld('Colour', col));
  f.append(UI.fld('Visibility', h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: its.every(i => i.visible), onchange: (e) => commit(() => ids.forEach(id => (item(id).visible = e.target.checked))) }), 'Visible')));
  const ms = its.filter(i => i.kind === 'mesh');
  if (ms.length) {
    const rng = h('input', { type: 'range', min: 0, max: 100, value: Math.round((ms[0].opacity != null ? ms[0].opacity : 1) * 100), style: { accentColor: 'var(--accent)' }, 'aria-label': 'Opacity' });
    UI.live(rng, () => ms.forEach(i => (item(i.id).opacity = rng.value / 100)));
    f.append(h('div', { class: 'fld span' }, h('label', null, 'Opacity'), rng));
    f.append(UI.fld('Appearance', h('select', { onchange: (e) => commit(() => ms.forEach(i => (item(i.id).appearance = e.target.value))) }, h('option', { value: '' }, '— mixed —'), [['follow', 'Follow global mode'], ['opaque', 'Always opaque'], ['transparent', 'Always transparent']].map(([v, l]) => h('option', { value: v }, l))), 'span'));
  }
  sec.append(f);
  if (ms.length) {
    const b = new THREE.Box3(); ms.forEach(i => b.union(V.worldBox(i.id))); const s = b.getSize(new THREE.Vector3());
    let vol = 0; ms.forEach(i => { const o = P.objectStats(i.id); if (o) vol += o.volume; });
    sec.append(h('div', { class: 'card' }, h('div', { class: 'ct' }, 'Combined'), kvTable([['Box min', fmtV(b.min)], ['Box max', fmtV(b.max)], ['Size', `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} cm`], ['Σ Volume', fmt(vol) + ' cm³']])));
  }
  sec.append(h('div', { class: 'actions' },
    ms.length ? h('button', { class: 'btn sm', onclick: () => { const b = new THREE.Box3(); ms.forEach(i => b.union(V.worldBox(i.id))); if (!b.isEmpty()) V.fit(b); } }, 'Zoom to') : null,
    ms.length ? h('button', { class: 'btn sm', onclick: () => UI.groupSelection() }, 'Group') : null,
    h('button', { class: 'btn sm', onclick: () => UI.duplicate() }, 'Duplicate'),
    h('button', { class: 'btn sm danger', onclick: () => UI.deleteSel() }, 'Delete')));
  return sec;
};

/* ---------- tool window ---------- */
UI.optChk = function (key, label) {
  return h('label', null, h('input', { type: 'checkbox', checked: S.set[key], onchange: (e) => { S.set[key] = e.target.checked; saveSettings(); P.clearHover(); UI.refreshToolwin(); } }), label);
};
UI.optNum = function (key, label, step, unit) {
  return h('label', null, label, h('input', { type: 'number', value: S.set[key], step, min: 0, onchange: (e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { S.set[key] = v; saveSettings(); P.clearHover(); } }, onkeydown: (e) => e.stopPropagation() }), unit || '');
};
UI.activeCsSelect = function () {
  return h('select', { 'aria-label': 'Active coordinate system', onchange: (e) => commit(() => { S.doc.activeCS = +e.target.value; }) },
    itemsOf('cs').map(c => h('option', { value: c.id, selected: c.id === S.doc.activeCS ? 'selected' : null }, c.id === 0 ? 'Global (0,0,0)' : c.name)));
};
UI.twCollapsed = store.get('twc', false);
UI.refreshToolwin = function () {
  const w = $('#toolwin');
  const st = S.set;
  const show = T.active || S.pick || st.tool === 'info' || st.filter !== 'object';
  if (!show) { w.classList.add('hidden'); return; }
  w.classList.remove('hidden'); w.innerHTML = '';
  const fname = { point: 'points', edge: 'edges', face: 'faces', object: 'objects' }[st.filter];
  const title = T.active ? T.active.title : (st.tool === 'info' ? 'Information · ' : 'Selection · ') + fname;
  w.append(h('div', { class: 'tw-h', onclick: () => { UI.twCollapsed = !UI.twCollapsed; store.set('twc', UI.twCollapsed); UI.refreshToolwin(); } }, title, h('span', { class: 'pm', text: UI.twCollapsed ? '+' : '−' })));
  if (UI.twCollapsed) return;
  const b = h('div', { class: 'tw-b' });
  if (T.active) b.append(T.panel());
  else {
    const o = h('div', { class: 'tw-opts' });
    if (st.filter === 'point') o.append(UI.optChk('snapVert', 'Snap to vertices'), UI.optNum('snapPx', 'radius', 1, 'px'));
    if (st.filter === 'edge') o.append(UI.optChk('sharpOnly', 'Sharp edges only'), UI.optNum('edgeAngle', 'angle ≥', 1, '°'), UI.optChk('edgeRetry', 'retry with lower angle if rim open'));
    if (st.filter === 'face') o.append(UI.optChk('wholeFace', 'Whole face (coplanar triangles)'), UI.optNum('faceTol', 'tolerance', .5, '°'));
    if (o.children.length) b.append(o);
    if (S.pick) { const c = P.card(S.pick); if (c) b.append(c); }
    else b.append(h('div', { class: 'tw-msg muted', text: `Click ${{ point: 'a point', edge: 'an edge', face: 'a face', object: 'an object' }[st.filter]} in the view.` }));
  }
  w.append(b);
};

/* ---------- status chip ---------- */
UI.status = function (text, details) {
  const c = $('#statusChip'); c.innerHTML = '';
  if (!text) {
    if (T.active) return T.prompt();
    const n = itemsOf('mesh').length;
    if (!n) { c.textContent = 'Drop STL / OBJ files on the view to start'; return; }
    let nf = 0; for (const m of itemsOf('mesh')) nf += (S.geo.get(m.geo) || { nf: 0 }).nf;
    text = `${n} mesh${n > 1 ? 'es' : ''} · ${nf.toLocaleString('en-US')} triangles — drag: rotate · right/shift-drag: pan · wheel: zoom · double-click: rotation centre`;
  }
  c.append(text);
  if (details) c.append(h('a', { onclick: () => UI.drawer('right', true) }, 'Details ▸'));
};

UI.refreshUndo = function () { $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length; };
UI.refreshLegend = function () {
  const lg = $('#matLegend');
  if (!S.set.colorByFile || !S.doc.groups.length) { lg.classList.add('hidden'); return; }
  lg.classList.remove('hidden'); lg.innerHTML = '<b>Colour by file</b>';
  for (const g of S.doc.groups) {
    const n = itemsOf('mesh').filter(m => m.group === g.id).length; if (!n) continue;
    lg.append(h('div', { class: 'lr' }, h('span', { class: 'sw', style: { background: g.color } }), h('span', { text: g.name }), h('span', { class: 'c', text: n })));
  }
};
UI.refreshAll = function () { UI.refreshToolbar(); UI.refreshTree(); UI.refreshProps(); UI.refreshToolwin(); UI.refreshUndo(); UI.refreshLegend(); };

/* ---------- drawers, resize handles, sheet ---------- */
UI.narrow = () => window.innerWidth < 900;
UI.drawer = function (side, force) {
  const d = side === 'left' ? $('#dLeft') : $('#dRight');
  const open = force != null ? force : d.classList.contains('closed');
  if (UI.narrow() && open) { $('#dLeft').classList.add('closed'); $('#dRight').classList.add('closed'); }
  d.classList.toggle('closed', !open);
  if (!UI.narrow()) { S.set[side === 'left' ? 'leftOpen' : 'rightOpen'] = open; saveSettings(); }
  UI.syncScrim();
  $('#btnLeft').classList.toggle('on', !$('#dLeft').classList.contains('closed'));
  $('#btnRight').classList.toggle('on', !$('#dRight').classList.contains('closed'));
};
UI.syncScrim = function () {
  const any = UI.narrow() && (!$('#dLeft').classList.contains('closed') || !$('#dRight').classList.contains('closed'));
  $('#scrim').classList.toggle('on', any);
};
UI.initDrawers = function () {
  const root = document.documentElement;
  for (const k of ['lw', 'rw', 'dw']) root.style.setProperty('--' + k, S.set[k] + 'px');
  if (UI.narrow()) { $('#dLeft').classList.add('closed'); $('#dRight').classList.add('closed'); }
  else { $('#dLeft').classList.toggle('closed', !S.set.leftOpen); $('#dRight').classList.toggle('closed', !S.set.rightOpen); }
  $('#btnLeft').classList.toggle('on', !$('#dLeft').classList.contains('closed'));
  $('#btnRight').classList.toggle('on', !$('#dRight').classList.contains('closed'));
  $('#scrim').onclick = () => { $('#dLeft').classList.add('closed'); $('#dRight').classList.add('closed'); UI.syncScrim(); };
  for (const hnd of $$('.rsz')) {
    const key = hnd.dataset.var; const left = key === 'lw';
    hnd.addEventListener('pointerdown', (e) => {
      e.preventDefault(); hnd.setPointerCapture(e.pointerId); hnd.classList.add('drag');
      const x0 = e.clientX, w0 = S.set[key];
      const mv = (ev) => { const w = clamp(w0 + (left ? ev.clientX - x0 : x0 - ev.clientX), 200, Math.min(760, window.innerWidth * .6)); S.set[key] = Math.round(w); root.style.setProperty('--' + key, S.set[key] + 'px'); };
      const upf = () => { hnd.classList.remove('drag'); hnd.removeEventListener('pointermove', mv); hnd.removeEventListener('pointerup', upf); saveSettings(); };
      hnd.addEventListener('pointermove', mv); hnd.addEventListener('pointerup', upf);
    });
    hnd.addEventListener('dblclick', () => {
      const body = hnd.parentElement.querySelector('.dbody') || hnd.parentElement;
      let w = 0; for (const el of $$('.row,.tsubh,.card,table', body)) w = Math.max(w, el.scrollWidth + 40);
      S.set[key] = Math.round(clamp(w || 320, 220, 640)); root.style.setProperty('--' + key, S.set[key] + 'px'); saveSettings();
    });
  }
  window.addEventListener('resize', () => UI.syncScrim());
};
/* ---------- floating windows ---------- */
UI.makeDraggable = function (win, head, grip) {
  head.addEventListener('pointerdown', (e) => {
    if (win.classList.contains('docked') || e.target.closest('button')) return;
    e.preventDefault(); head.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, l0 = win.offsetLeft, t0 = win.offsetTop, vp = $('#viewport');
    const mv = (ev) => { win.style.left = clamp(l0 + ev.clientX - x0, 0, vp.clientWidth - 60) + 'px'; win.style.top = clamp(t0 + ev.clientY - y0, 0, vp.clientHeight - 40) + 'px'; };
    const upf = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', upf); };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', upf);
  });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, w0 = win.offsetWidth, h0 = win.offsetHeight;
    const mv = (ev) => { win.style.width = Math.max(260, w0 + ev.clientX - x0) + 'px'; win.style.height = Math.max(180, h0 + ev.clientY - y0) + 'px'; };
    const upf = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upf); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', upf);
  });
};


/* ---------- settings dialog ---------- */
UI.settings = function (tab) {
  const d = $('#dlg'); d.innerHTML = '';
  const tabs = ['General', 'Picking', 'Import', 'About'];
  tab = tab || UI.setTab || 'General'; UI.setTab = tab;
  const st = S.set;
  const chk = (k, l, after) => h('label', { class: 'setrow chk' }, h('input', { type: 'checkbox', checked: st[k], onchange: (e) => { st[k] = e.target.checked; saveSettings(); after && after(); } }), h('span', { text: l }));
  const num = (k, l, step, min, max, after) => h('div', { class: 'setrow' }, h('span', { text: l }), h('input', { type: 'number', step, min, max, value: st[k], onchange: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) { st[k] = clamp(v, min, max); saveSettings(); after && after(); } } }));
  const sel = (k, l, opts, after) => h('div', { class: 'setrow' }, h('span', { text: l }), h('select', { onchange: (e) => { st[k] = e.target.value; saveSettings(); after && after(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(st[k]) === String(v) ? 'selected' : null }, t))));
  const body = h('div', { class: 'db setgrid' });
  const refresh = () => { V.sync(); UI.refreshAll(); S.needRender = true; };
  if (tab === 'General') body.append(
    chk('axes', 'Axes at origin', () => { V.updateHelpers(); S.needRender = true; }),
    chk('secNames', 'Show file names in the tree', () => UI.refreshTree()),
    chk('pickPop', 'Overlapping-entities pop-up'),
    chk('hoverPreview', 'Hover preview (blue highlight before clicking)'),
    chk('invX', 'Invert mouse rotation X', () => UI.refreshToolbar()), chk('invY', 'Invert mouse rotation Y', () => UI.refreshToolbar()),
    num('step', 'Numeric step (arrows / wheel)', .1, .001, 1000, () => UI.refreshProps()),
    num('decimals', 'Decimals', 1, 0, 8, refresh),
    num('margin', 'Render-zone margin (%)', 1, 0, 100),
    sel('theme', 'Theme', [['light', 'Light'], ['dark', 'Dark']], () => App.applyTheme()),
    h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: async () => { if (await confirmDlg('Reset settings', 'Restore every setting to its default value?', 'Reset', true)) { S.set = Object.assign({}, DEFAULTS); saveSettings(); App.applyTheme(); UI.initDrawers(); V.setProjection(S.set.proj); refresh(); UI.settings('General'); toast('Settings reset'); } } }, 'Reset all settings')));
  if (tab === 'Picking') body.append(
    num('snapPx', 'Vertex snap radius (px)', 1, 2, 60), num('edgeAngle', 'Sharp-edge angle (°)', 1, 1, 89), chk('edgeRetry', 'Retry with a lower angle if a rim is open'),
    chk('sharpOnly', 'Edge picking: sharp edges only'), num('faceTol', 'Coplanar face tolerance (°)', .5, 0, 45), chk('wholeFace', 'Face picking: whole face'));
  if (tab === 'Import') body.append(
    sel('units', 'File units (applies to the next drop)', [['mm', 'Millimetres (mm)'], ['cm', 'Centimetres (cm)'], ['m', 'Metres (m)'], ['in', 'Inches (in)']]),
    num('crease', 'Smoothing crease angle (°)', 1, 0, 90, () => UI.redraw()),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Values are always displayed in cm with the mm equivalent.'));
  if (tab === 'About') body.append(h('div', { html: `<p><b>${APP.name}</b> ${APP.version} — multi-file STL / OBJ viewer with motion envelopes.<br>Runs entirely in the browser: files never leave your device.</p><p class="muted">three.js r${THREE.REVISION}</p>` }),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => App.checkUpdate() }, 'Check for updates')));
  d.append(h('div', { class: 'dh', text: 'Settings' }),
    h('div', { class: 'tabs' }, tabs.map(t => h('button', { class: 'tab' + (t === tab ? ' on' : ''), onclick: () => UI.settings(t) }, t))), body,
    h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => d.close() }, 'Close')));
  if (!d.open) d.showModal();
};

/* ---------- init ---------- */
UI.init = function () {
  $('#ver').textContent = 'v' + APP.version;
  $('#logo').innerHTML = ic('cube');
  $('#btnLeft').innerHTML = ic('tree'); $('#btnRight').innerHTML = ic('props');
  $('#btnUndo').innerHTML = ic('undo'); $('#btnRedo').innerHTML = ic('redo');
  $('#btnInstall').innerHTML = ic('install'); $('#btnOpen2').innerHTML = ic('open'); $('#btnClear').innerHTML = ic('trash');
  $('#btnSettings').innerHTML = ic('gear'); $('#btnSave').innerHTML = ic('save');
  $('#btnSave').onclick = () => App.saveProject();
  $('#btnLeft').onclick = () => UI.drawer('left'); $('#btnRight').onclick = () => UI.drawer('right');
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnOpen2').onclick = () => $('#fileIn').click();
  $('#btnClear').onclick = () => App.newProject();
  $('#btnSettings').onclick = () => UI.settings();
  $('#btnTheme').onclick = () => { S.set.theme = S.set.theme === 'dark' ? 'light' : 'dark'; saveSettings(); App.applyTheme(); };
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.menu')) UI.closeMenu();
    if (!e.target.closest('#resPop') && !e.target.closest('[data-cmd=res]')) $('#resPop').classList.add('hidden');
  });
  UI.buildToolbar(); UI.initDrawers();
  new ResizeObserver(() => $('#viewport').style.setProperty('--vt', $('#vtools').offsetHeight + 'px')).observe($('#vtools'));
};
