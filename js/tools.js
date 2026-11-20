'use strict';
/* tools.js — multi-step tools (distance, CS, boxes, planes, field pickers) and the section window */

const T = { active: null, last: null };

T.DEFS = {
  distance: { title: 'Distance', need: 'point', steps: ['point A', 'point B'], repeat: true },
  cs3: { title: 'Coordinate system from 3 points', need: 'point', steps: ['the origin', 'a point on +X', 'a point in the XY plane (+Y side)'] },
  csFace: { title: 'Coordinate system on a face', need: 'face', steps: ['a face'] },
  csRim: { title: 'Coordinate system on a circular edge', need: 'dir', dirFrom: 'edge', steps: ['a circular edge'] },
  lookNormal: { title: 'Look normal to a face', need: 'face', steps: ['a face'] }
};

T.start = function (name, extra) {
  this.cancel(true);
  const def = Object.assign({ name }, this.DEFS[name] || {}, extra || {});
  def.pts = []; def.face3 = []; def.result = null;
  this.active = def;
  S.pick = null; P.show('pick', null);
  UI.refreshToolbar(); UI.refreshToolwin(); this.prompt();
};
T.cancel = function (silent) {
  if (!this.active) return;
  const a = this.active; this.active = null;
  V.ovl.pending = []; V.ovl.tool = []; P.show('hover', null);
  if (a.onCancel) a.onCancel();
  S.needRender = true;
  if (!silent) { UI.refreshToolbar(); UI.refreshToolwin(); UI.status(); }
};
T.finish = function () { this.cancel(); };
T.prompt = function (msg) {
  const a = this.active; if (!a) return;
  const step = a.steps[Math.min(a.pts.length, a.steps.length - 1)];
  let s = msg || `${a.title}: click ${step}`;
  if (a.need === 'point' && S.set.pointFrom === 'face3') s += ` · face ${a.face3.length + 1}/3`;
  UI.status(s + ' · Cancel (Esc)');
};
T.hoverFilter = function () {
  const a = this.active; if (!a) return null;
  if (a.need === 'face') return 'face';
  if (a.need === 'dir') return a.dirFrom === 'edge' ? 'edge' : 'face';
  return { vertex: 'point', arc: 'edge', mid: 'edge', face3: 'face' }[S.set.pointFrom] || 'point';
};
T.pendingMarks = function () {
  const a = this.active;
  V.ovl.pending = a ? a.pts.map(p => ({ type: 'dot', p, color: COL.pend, r: 6, sw: 2 })).concat(a.face3.map(f => ({ type: 'dot', p: f.c, color: COL.pend, r: 4, cross: true }))) : [];
  S.needRender = true;
};

/* resolve a click into a point according to the point-source mode */
T.resolvePoint = function (hit, x, y) {
  const m = S.set.pointFrom;
  if (m === 'vertex') { const e = P.computePoint(hit, x, y); return e ? { p: e.p } : { err: '⚠ No point' }; }
  if (m === 'arc' || m === 'mid') {
    const e = P.computeEdge(hit, x, y); if (!e) return { err: '⚠ No edge near the cursor' };
    if (m === 'arc') return e.rim ? { p: e.rim.c.clone() } : { err: '⚠ Not a circular edge — try another edge or lower the angle' };
    // midpoint along the chain length
    const pts = e.closed ? e.pts.concat([e.pts[0]]) : e.pts;
    let half = e.len / 2;
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); if (half <= d) return { p: pts[i - 1].clone().lerp(pts[i], d ? half / d : 0) }; half -= d; }
    return { p: pts[pts.length - 1].clone() };
  }
  // intersection of 3 planar faces
  const f = P.computeFace(hit); if (!f) return { err: '⚠ No face' };
  const a = this.active;
  a.face3.push({ n: f.n.clone(), d: f.d, c: f.c.clone() });
  if (a.face3.length < 3) { this.pendingMarks(); return { pending: true }; }
  const F = a.face3; a.face3 = [];
  const A = F.map(q => [q.n.x, q.n.y, q.n.z]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(F[i].n.dot(F[j].n)) > 0.9995) return { err: '⚠ Two of the faces are parallel — no intersection point' };
  const s = G.solve3(A, F.map(q => q.d));
  if (!s) return { err: '⚠ Faces do not meet in a single point' };
  return { p: new THREE.Vector3(s[0], s[1], s[2]) };
};

T.click = function (x, y, e) {
  const a = this.active;
  const hits = P.raycast(x, y);
  if (!hits.length) { this.prompt('⚠ Nothing under the cursor'); return; }
  const hit = hits[0];
  if (a.need === 'face' || (a.need === 'dir' && a.dirFrom !== 'edge')) {
    const f = P.computeFace(hit); if (!f) return;
    return this.done(a, { face: f, n: f.n, c: f.c });
  }
  if (a.need === 'dir') {
    const ed = P.computeEdge(hit, x, y); if (!ed) { this.prompt('⚠ No edge near the cursor'); return; }
    const n = ed.rim ? ed.rim.n.clone() : ed.pts[ed.pts.length - 1].clone().sub(ed.pts[0]).normalize();
    return this.done(a, { n, c: ed.rim ? ed.rim.c : ed.pts[0], rim: ed.rim });
  }
  const r = this.resolvePoint(hit, x, y);
  if (r.err) { this.prompt(r.err); toast(r.err); return; }
  if (r.pending) { this.prompt(); UI.refreshToolwin(); return; }
  a.pts.push(r.p);
  this.pendingMarks();
  if (a.multi && a.pts.length < 3) { this.prompt(); UI.refreshToolwin(); return; }
  if (!a.multi && a.pts.length < a.steps.length) { this.prompt(); UI.refreshToolwin(); return; }
  if (a.multi) { this.prompt(`${a.title}: ${a.pts.length} points · Enter to finish`); UI.refreshToolwin(); return; }
  this.done(a, { pts: a.pts.slice() });
};
T.enter = function () {
  const a = this.active; if (!a || !a.multi) return;
  if (a.pts.length < 3) { toast('⚠ At least 3 points are needed'); return; }
  const f = G.fitCircle(a.pts);
  if (!f) { toast('⚠ Points are collinear'); return; }
  if (f.rms > 0.01 * f.r) toast(`⚠ Points are not on one circle (rms ${fmt(f.rms)} cm)`);
  this.done(a, { pts: [f.c], circle: f });
};

T.done = function (a, res) {
  if (a.onPick) { const keep = a.onPick(res); this.cancel(); return keep; }
  switch (a.name) {
    case 'distance': {
      const [A, B] = res.pts;
      a.result = { A, B }; a.pts = []; this.pendingMarks();
      V.ovl.tool = [{ type: 'poly', pts: [A, B], color: '#f97316', w: 2.5 }, { type: 'dot', p: A, color: '#f97316', r: 4.5 }, { type: 'dot', p: B, color: '#f97316', r: 4.5 }];
      UI.refreshToolwin(); this.prompt(`Distance = ${fmt(A.distanceTo(B))} cm — click point A for a new measure`);
      return;
    }
    case 'cs3': {
      const [O, X, Q] = res.pts;
      const x = X.clone().sub(O); const z = x.clone().cross(Q.clone().sub(O));
      if (x.lengthSq() < 1e-20 || z.lengthSq() < 1e-20) { toast('⚠ Points are coincident or collinear'); a.pts = []; this.pendingMarks(); this.prompt(); return; }
      x.normalize(); z.normalize(); const y = z.clone().cross(x);
      this.addCS(O, x, y, z, 'CS (3 points)'); this.cancel(); return;
    }
    case 'csFace': this.csFrom(res.c, res.n, 'CS on face'); this.cancel(); return;
    case 'csRim':
      if (!res.rim) { this.prompt('⚠ Not a circular edge — click a round edge'); toast('⚠ Not a circular edge'); return; }
      this.csFrom(res.rim.c, res.rim.n, 'CS on circle'); this.cancel(); return;
    case 'lookNormal': V.viewNormal(res.n, res.c); this.cancel(); return;
  }
};

/* ---------- creation helpers (all undoable) ---------- */
T.eulerDeg = function (x, y, z) {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z].map(v => +(v * 180 / Math.PI).toFixed(6));
};
T.addCS = function (O, x, y, z, name) {
  let id;
  commit(() => {
    id = newId();
    const n = itemsOf('cs').length;
    S.doc.items.push({ id, kind: 'cs', name: (name || 'CS') + ' ' + n, color: PALETTE[n % PALETTE.length], o: O.toArray().map(v => +v.toFixed(9)), r: this.eulerDeg(x, y, z), parent: S.doc.activeCS || null, visible: true });
  });
  UI.select(id); toast('Coordinate system created');
  return id;
};
T.csFrom = function (O, n, name) {
  const z = n.clone().normalize();
  let x = new THREE.Vector3(1, 0, 0); if (Math.abs(x.dot(z)) > 0.9) x.set(0, 1, 0);
  x.addScaledVector(z, -x.dot(z)).normalize();
  return this.addCS(O, x, z.clone().cross(x), z, name);
};
T.csAtCentroid = function (t) {
  const c = Motion.centroid(t);
  let id;
  commit(() => { id = newId(); const n = itemsOf('cs').length; S.doc.items.push({ id, kind: 'cs', name: 'CS · ' + Motion.targetName(t), color: PALETTE[n % PALETTE.length], o: c.toArray().map(v => +v.toFixed(9)), r: [0, 0, 0], parent: null, visible: true }); }, { keepProps: true });
  toast('Coordinate system created at the barycentre of ' + Motion.targetName(t));
  return id;
};
T.csAt = function (p) {
  const a = item(S.doc.activeCS);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.r.map(v => v * Math.PI / 180), 'XYZ'));
  return this.addCS(p, new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(0, 0, 1).applyQuaternion(q), 'CS');
};
T.csChild = function () {
  const a = item(S.doc.activeCS);
  let id;
  commit(() => { id = newId(); const n = itemsOf('cs').length; S.doc.items.push({ id, kind: 'cs', name: 'CS ' + n, color: PALETTE[n % PALETTE.length], o: a.o.slice(), r: a.r.slice(), parent: a.id, visible: true }); });
  UI.select(id); UI.tab = 'Definition'; UI.refreshProps();
};
/* field picker: fills a numeric field group from the view */
T.pickValue = function (kind, cb, title) {
  this.start('field', {
    title: title || 'Pick a value', need: kind === 'dir' ? 'dir' : 'point', steps: [kind === 'dir' ? 'a face (normal) or an edge' : 'a point'],
    dirFrom: 'face', multi: kind === 'circle',
    onPick: (res) => { if (kind === 'dir') cb(res.n); else cb(res.pts[0], res.circle); }
  });
  if (kind === 'circle') this.prompt('Pick a value: click ≥ 3 points on the circle · Enter to finish');
};

/* ---------- tool window content ---------- */
T.panel = function () {
  const a = this.active; const body = h('div');
  const opts = h('div', { class: 'tw-opts' });
  if (a.need === 'point') {
    const sel = h('select', { onchange: e => { S.set.pointFrom = e.target.value; saveSettings(); a.face3 = []; this.pendingMarks(); this.prompt(); P.clearHover(); } },
      [['vertex', 'Vertex / point on surface'], ['arc', 'Centre of a circular edge'], ['mid', 'Midpoint of an edge'], ['face3', 'Intersection of 3 faces']].map(([v, l]) => h('option', { value: v, selected: S.set.pointFrom === v ? 'selected' : null }, l)));
    opts.append(h('label', null, 'Point from', sel));
    if (S.set.pointFrom === 'vertex') opts.append(UI.optChk('snapVert', 'Snap to vertices'));
  }
  if (a.need === 'dir' && a.name !== 'csRim') {
    const sel = h('select', { onchange: e => { a.dirFrom = e.target.value; P.clearHover(); } }, [['face', 'Face normal'], ['edge', 'Edge direction / circle axis']].map(([v, l]) => h('option', { value: v, selected: a.dirFrom === v ? 'selected' : null }, l)));
    opts.append(h('label', null, 'Direction from', sel));
  }
  if (a.need === 'face') opts.append(UI.optChk('wholeFace', 'Whole face'));
  if (opts.children.length) body.append(opts);
  const csSel = UI.activeCsSelect(); body.append(h('div', { class: 'tw-opts' }, h('label', null, 'Active coordinate system', csSel)));
  const step = a.multi ? `${a.pts.length} point(s) picked` : `Step ${Math.min(a.pts.length + 1, a.steps.length)}/${a.steps.length}: click ${a.steps[Math.min(a.pts.length, a.steps.length - 1)]}`;
  body.append(h('div', { class: 'tw-msg' }, step + (S.set.pointFrom === 'face3' && a.need === 'point' ? ` · face ${a.face3.length}/3 picked` : '')));
  if (a.name === 'distance' && a.result) {
    const { A, B } = a.result, d = B.clone().sub(A);
    const card = h('div', { class: 'card' }, h('div', { class: 'ct' }, 'Distance'),
      kvTable([['Distance', fmtLen(A.distanceTo(B))], ['ΔX', fmtLen(d.x)], ['ΔY', fmtLen(d.y)], ['ΔZ', fmtLen(d.z)], ['Point A', fmtV(A)], ['Point B', fmtV(B)]]),
      h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => copyText(fmt(A.distanceTo(B))) }, 'Copy distance')));
    body.append(card);
  }
  const btns = h('div', { class: 'actions' });
  if (a.multi) btns.append(h('button', { class: 'btn sm primary', onclick: () => this.enter() }, 'Finish (Enter)'));
  btns.append(h('button', { class: 'btn sm', onclick: () => { this.cancel(); UI.setTool('select'); } }, 'Cancel (Esc)'));
  body.append(btns);
  return body;
};

/* ======================= Section view ======================= */
const Section = { open: false, docked: false, plane: 'cs:0:XY', offset: 0, flip: false, show3D: true, view: null, lines: [], dirty: true, win: null };

Section.planeDefs = function () {
  const out = [];
  for (const cs of itemsOf('cs')) {
    const m = P.csMatrix(cs); const o = new THREE.Vector3().fromArray(cs.o);
    const X = new THREE.Vector3(1, 0, 0).transformDirection(m), Y = new THREE.Vector3(0, 1, 0).transformDirection(m), Z = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const pre = cs.id === 0 ? '' : cs.name + ' ';
    const tag = (a) => cs.id === 0 ? a : a + "'";
    out.push({ key: `cs:${cs.id}:XY`, label: `${cs.name} · XY plane`, P: o, N: Z, U: X, V: Y, lu: tag('+X'), lv: tag('+Y') });
    out.push({ key: `cs:${cs.id}:XZ`, label: `${cs.name} · XZ plane`, P: o, N: Y.clone().negate(), U: X, V: Z, lu: tag('+X'), lv: tag('+Z') });
    out.push({ key: `cs:${cs.id}:YZ`, label: `${cs.name} · YZ plane`, P: o, N: X, U: Y, V: Z, lu: tag('+Y'), lv: tag('+Z') });
  }
  return out;
};
Section.def = function () {
  const defs = this.planeDefs();
  let d = defs.find(q => q.key === this.plane);
  if (!d) { d = defs[0]; this.plane = d.key; }
  return d;
};
Section.range = function (d) {
  const b = V.computeBox(); let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
    const s = c.sub(d.P).dot(d.N); mn = Math.min(mn, s); mx = Math.max(mx, s);
  }
  return [mn, mx];
};
Section.toggle = function (on) {
  on = on == null ? !this.open : on;
  if (on === this.open) return;
  this.open = on;
  if (on) this.build(); else this.destroy();
  UI.refreshToolbar();
};
Section.destroy = function () {
  if (this.win) this.win.remove(); this.win = null;
  $('#dDock').classList.add('closed');
  this.cutPlane(false);
  this.open = false; UI.refreshToolbar();
};
Section.build = function () {
  const w = h('div', { class: 'fwin', id: 'cutwin', style: { left: '', top: '' } });
  const head = h('div', { class: 'fh' }, h('span', { class: 't' }, 'Section view'),
    h('button', { class: 'ib', title: 'Fit', 'aria-label': 'Fit', html: ic('fit'), onclick: () => { this.view = null; this.draw(); } }),
    h('button', { class: 'ib', id: 'cutDock', title: 'Dock / float', 'aria-label': 'Dock or float', html: ic('dock'), onclick: () => this.dock(!this.docked) }),
    h('button', { class: 'ib', title: 'Close', 'aria-label': 'Close', html: ic('close'), onclick: () => this.toggle(false) }));
  const opts = h('div', { class: 'fo' });
  const fb = h('div', { class: 'fb' }); const cv = h('canvas'); fb.append(cv);
  const st = h('div', { class: 'fs', text: '' });
  const grip = h('div', { class: 'grip' });
  w.append(head, opts, fb, st, grip);
  this.win = w; this.cv = cv; this.st = st; this.opts = opts;
  const vp = $('#viewport');
  w.style.width = '380px'; w.style.height = '300px';
  w.style.left = Math.max(10, vp.clientWidth - 380 - 116) + 'px'; w.style.top = ($('#vtools').offsetHeight + 10) + 'px';
  if (vp.clientWidth < 640) { w.style.left = '10px'; w.style.width = (vp.clientWidth - 20) + 'px'; w.style.top = (vp.clientHeight - 320) + 'px'; }
  vp.append(w);
  UI.makeDraggable(w, head, grip);
  this.buildOpts();
  this.initCanvas();
  if (this.docked) this.dock(true);
  this.invalidate();
};
Section.buildOpts = function () {
  const o = this.opts; o.innerHTML = '';
  const d = this.def(); const [mn, mx] = this.range(d);
  const sel = h('select', { onchange: e => { this.plane = e.target.value; this.offset = 0; this.view = null; this.buildOpts(); this.invalidate(); } },
    this.planeDefs().map(q => h('option', { value: q.key, selected: q.key === this.plane ? 'selected' : null }, q.label)));
  const span = Math.max(mx - mn, 1e-6);
  const num = h('input', { type: 'number', step: 'any', value: +this.offset.toFixed(5), 'aria-label': 'Offset (cm)' });
  const rng = h('input', { type: 'range', class: 'cut-rng', 'aria-label': 'Offset slider' });
  // slider range: full extent, or a narrow window centred on the current offset in "Precise" mode
  const setRange = () => {
    let lo, hi;
    if (this.precise) { const w = span * 0.01; lo = this.offset - w; hi = this.offset + w; }
    else { lo = Math.min(mn - span * .02, this.offset); hi = Math.max(mx + span * .02, this.offset); }
    rng.min = lo; rng.max = hi; rng.step = (hi - lo) / 2000; rng.value = this.offset;
    rngLbl.textContent = this.precise ? `±${fmt(span * 0.01, 4)} cm` : '';
  };
  const rngLbl = h('span', { class: 'muted tabnum' });
  const apply = (v) => { this.offset = v; this.invalidate(); };
  num.onchange = () => { const v = parseFloat(num.value); if (isFinite(v)) { apply(v); setRange(); } };
  num.onkeydown = (e) => e.stopPropagation();
  rng.oninput = () => { apply(+rng.value); num.value = (+rng.value).toFixed(5); };
  rng.onchange = () => { if (this.precise) setRange(); };   // re-centre the fine window after each move
  const pick = h('button', { class: 'pickb', title: 'Pick a point in the 3D view: the section passes through it', 'aria-label': 'Pick section position', html: ic('pick'),
    onclick: () => T.pickValue('point', (p) => { apply(p.clone().sub(d.P).dot(d.N)); this.view = null; this.buildOpts(); toast(`Section through ${fmtV(p)} cm`); }, 'Section through a point') });
  o.append(h('div', { class: 'cut-row' }, h('label', null, 'Plane', sel), h('label', null, 'Offset', num, 'cm'), pick,
    h('label', null, h('input', { type: 'checkbox', checked: this.flip, onchange: e => { this.flip = e.target.checked; this.draw(); } }), 'other side'),
    h('label', null, h('input', { type: 'checkbox', checked: this.show3D, onchange: e => { this.show3D = e.target.checked; this.cutPlane(); } }), 'plane in 3D')),
  h('div', { class: 'cut-row cut-sl' }, rng, h('label', { title: 'Fine positioning: the slider covers ±1 % of the model size around the current offset' }, h('input', { type: 'checkbox', checked: !!this.precise, onchange: e => { this.precise = e.target.checked; setRange(); } }), 'Precise'), rngLbl));
  setRange();
};
Section.dock = function (on) {
  this.docked = on;
  const dd = $('#dDock');
  if (on) { dd.classList.remove('closed'); dd.append(this.win); this.win.classList.add('docked'); this.win.style.cssText = ''; }
  else { dd.classList.add('closed'); const vp = $('#viewport'); vp.append(this.win); this.win.classList.remove('docked'); Object.assign(this.win.style, { width: '380px', height: '300px', left: Math.max(10, vp.clientWidth - 496) + 'px', top: ($('#vtools').offsetHeight + 10) + 'px' }); }
  $('#cutDock').innerHTML = ic(on ? 'float' : 'dock');
  setTimeout(() => { V.resize(); this.draw(); }, 30);
};
Section.cutPlane = function (show) {
  if (V.cutObj) { V.helpers.remove(V.cutObj); V.cutObj.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); V.cutObj = null; }
  if (show === false || !this.open || !this.show3D) { S.needRender = true; return; }
  const d = this.def(); const s = V.diag() * 1.1;
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: 0xd9480f, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide }));
  const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(p => new THREE.Vector3(p[0] * s / 2, p[1] * s / 2, 0))), new THREE.LineBasicMaterial({ color: 0xd9480f }));
  g.add(m, ol);
  const basis = new THREE.Matrix4().makeBasis(d.U, d.V, d.N);
  g.quaternion.setFromRotationMatrix(basis);
  const c = V.box.getCenter(new THREE.Vector3());
  const P0 = d.P.clone().addScaledVector(d.N, this.offset);
  // centre the quad on the scene projection
  g.position.copy(P0).addScaledVector(d.U, c.clone().sub(P0).dot(d.U)).addScaledVector(d.V, c.clone().sub(P0).dot(d.V));
  V.helpers.add(g); V.cutObj = g; S.needRender = true;
};
Section.invalidate = function () {
  if (!this.open) return;
  this.dirty = true;
  if (this._raf) return;
  this._raf = requestAnimationFrame(() => { this._raf = null; if (this.open) { this.compute(); this.draw(); this.cutPlane(); } });
};
Section.compute = function () {
  const d = this.def(); const P0 = d.P.clone().addScaledVector(d.N, this.offset);
  this.lines = [];
  for (const [id, r] of V.rec) {
    if (!r.mesh || !r.shown) continue;
    const it = item(id); r.mesh.updateMatrixWorld(true);
    const ls = G.slice(S.geo.get(r.key), r.mesh.matrixWorld.elements, P0.toArray(), d.N.toArray(), d.U.toArray(), d.V.toArray());
    if (ls.length) this.lines.push({ id, color: V.itemColor(it), name: it.name, ls });
  }
  // motion envelopes: every envelope position, drawn dashed
  for (const e of V.env.values()) {
    if (!e.obj.visible) continue;
    const els = [];
    for (const p of e.parts) { const t = S.geo.get(item(p.id).geo); for (const me of p.mats) els.push(...G.slice(t, me, P0.toArray(), d.N.toArray(), d.U.toArray(), d.V.toArray())); }
    if (els.length) this.lines.push({ color: Motion.targetColor(e.t), name: 'envelope', ls: els, env: true });
  }
  this.dirty = false;
};
Section.initCanvas = function () {
  const cv = this.cv; let drag = null;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; });
  cv.addEventListener('pointermove', e => { if (!drag || !this.view) return; this.view.cx -= (e.clientX - drag.x) / this.view.s * (this.flip ? -1 : 1); this.view.cy += (e.clientY - drag.y) / this.view.s; drag = { x: e.clientX, y: e.clientY }; this.draw(); });
  cv.addEventListener('pointerup', () => { drag = null; cv.style.cursor = ''; });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); if (!this.view) return;
    const r = cv.getBoundingClientRect(), f = Math.exp(-e.deltaY * 0.0015);
    const W = r.width, H = r.height, mx = e.clientX - r.left, my = e.clientY - r.top, sg = this.flip ? -1 : 1;
    const u = this.view.cx + (mx - W / 2) / this.view.s * sg, v = this.view.cy - (my - H / 2) / this.view.s;
    this.view.s *= f;
    this.view.cx = u - (mx - W / 2) / this.view.s * sg; this.view.cy = v + (my - H / 2) / this.view.s;
    this.draw();
  }, { passive: false });
  new ResizeObserver(() => this.draw()).observe(cv);
};
function niceNum(x) { const e = Math.pow(10, Math.floor(Math.log10(x))); const f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
Section.draw = function () {
  if (!this.open || !this.cv) return;
  const cv = this.cv, r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, r.width), H = Math.max(1, r.height);
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dark = S.set.theme === 'dark';
  g.fillStyle = dark ? '#151a22' : '#ffffff'; g.fillRect(0, 0, W, H);
  const d = this.def(); const sg = this.flip ? -1 : 1;
  // fit
  if (!this.view) {
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const o of this.lines) for (const l of o.ls) for (const [u, v] of l.pts) { mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v); }
    if (!isFinite(mnu)) { const R = V.diag() / 2; mnu = mnv = -R; mxu = mxv = R; }
    const s = Math.min(W / Math.max(mxu - mnu, 1e-9), H / Math.max(mxv - mnv, 1e-9)) * 0.85;
    this.view = { cx: (mnu + mxu) / 2, cy: (mnv + mxv) / 2, s };
  }
  const vw = this.view;
  const X = u => W / 2 + (u - vw.cx) * vw.s * sg, Y = v => H / 2 - (v - vw.cy) * vw.s;
  // axes through the plane origin
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(220,38,38,.75)'; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke();
  g.strokeStyle = 'rgba(22,163,74,.75)'; g.beginPath(); g.moveTo(X(0), 0); g.lineTo(X(0), H); g.stroke();
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = '#dc2626'; g.fillText('u ' + d.lu, sg > 0 ? W - 46 : 6, Y(0) - 5);
  g.fillStyle = '#16a34a'; g.fillText('v ' + d.lv, X(0) + 5, 13);
  // sections
  let loops = 0;
  for (const o of this.lines) {
    if (o.env) {
      g.beginPath();
      for (const l of o.ls) { l.pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); if (l.closed) g.closePath(); }
      g.setLineDash([5, 4]); g.lineWidth = 1.2; g.strokeStyle = o.color; g.globalAlpha = .9; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      continue;
    }
    g.beginPath();
    for (const l of o.ls) {
      l.pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v))));
      if (l.closed) { g.closePath(); loops++; }
    }
    g.globalAlpha = .25; g.fillStyle = o.color; g.fill('evenodd');
    g.globalAlpha = 1; g.lineWidth = 1.8; g.strokeStyle = o.color; g.lineJoin = 'round'; g.stroke();
  }
  // scale bar
  const len = niceNum(W * 0.22 / vw.s), px = len * vw.s;
  const bx = 12, by = H - 14;
  g.strokeStyle = dark ? '#cfd8e6' : '#1b2430'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + px, by); g.lineTo(bx + px, by - 4); g.stroke();
  g.fillStyle = dark ? '#cfd8e6' : '#1b2430'; g.fillText(`${+len.toPrecision(3)} cm`, bx + px + 6, by + 1);
  const nObj = this.lines.filter(o => !o.env).length, nEnv = this.lines.length - nObj;
  this.st.textContent = `${d.label} · offset ${fmt(this.offset)} cm · ${nObj} object(s) cut · ${loops} closed loop(s)${nEnv ? ` · ${nEnv} envelope(s) dashed` : ''}`;
};
