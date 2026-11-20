'use strict';
/* pick.js — raycasting, selection filters (point / edge / face / object), highlights, info cards, overlap pop-up */

const P = { ray: new THREE.Raycaster() };
const COL = { pick: '#e11d48', hover: '#7aa7ff', pend: '#16a34a' };
const KIND = { mesh: 'Mesh', cs: 'Coordinate system' };

P.raycast = function (x, y) {
  const ndc = new THREE.Vector2(x / V.w * 2 - 1, -(y / V.h) * 2 + 1);
  this.ray.setFromCamera(ndc, V.cam);
  const meshes = [];
  for (const r of V.rec.values()) if (r.mesh && r.shown) meshes.push(r.mesh);
  return this.ray.intersectObjects(meshes, false).map(h => ({ id: h.object.userData.id, f: h.faceIndex, point: h.point.clone(), dist: h.distance }));
};
P.totalFaces = function () { let n = 0; for (const r of V.rec.values()) if (r.mesh && r.shown) n += S.geo.get(r.key).nf; return n; };

/* ---------- geometry helpers ---------- */
P.ctx = function (id) {
  const r = V.rec.get(id); if (!r || !r.mesh) return null;
  r.mesh.updateMatrixWorld(true);
  const m = r.mesh.matrixWorld;
  return { r, t: S.geo.get(r.key), m, nm: new THREE.Matrix3().getNormalMatrix(m), it: item(id), s: (item(id).s || 1) };
};
P.vw = function (c, v) { const p = c.t.pos; return new THREE.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).applyMatrix4(c.m); };
function segDist2(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0; t = clamp(t, 0, 1);
  const qx = a[0] + t * dx - px, qy = a[1] + t * dy - py; return qx * qx + qy * qy;
}

P.computePoint = function (hit, x, y) {
  const c = this.ctx(hit.id); if (!c) return null;
  let best = null, bd = Infinity;
  if (S.set.snapVert) for (let k = 0; k < 3; k++) {
    const v = c.t.idx[hit.f * 3 + k], w = this.vw(c, v), sp = V.project(w);
    if (!sp) continue;
    const d = Math.hypot(sp[0] - x, sp[1] - y);
    if (d < bd) { bd = d; best = { v, w }; }
  }
  if (best && bd <= S.set.snapPx) return { type: 'point', id: hit.id, p: best.w, snapped: true, v: best.v };
  return { type: 'point', id: hit.id, p: hit.point.clone(), snapped: false };
};

P.computeEdge = function (hit, x, y) {
  const c = this.ctx(hit.id); if (!c) return null;
  const t = c.t, E = G.edges(t);
  const angle = S.set.edgeAngle, cosA = Math.cos(angle * Math.PI / 180);
  const cand = new Set();
  for (let k = 0; k < 3; k++) {
    const v = t.idx[hit.f * 3 + k];
    for (let j = t.vfOff[v]; j < t.vfOff[v + 1]; j++) {
      const f = t.vf[j];
      for (let q = 0; q < 3; q++) cand.add(E.map.get(G.edgeKey(t, t.idx[f * 3 + q], t.idx[f * 3 + (q + 1) % 3])));
    }
  }
  let best = -1, bd = Infinity;
  const spCache = new Map();
  const sp = (v) => { let s = spCache.get(v); if (s === undefined) { s = V.project(this.vw(c, v)); spCache.set(v, s); } return s; };
  for (const e of cand) {
    if (S.set.sharpOnly && !G.isSharp(t, e, cosA)) continue;
    const a = sp(E.a[e]), b = sp(E.b[e]); if (!a || !b) continue;
    const d = segDist2(x, y, a, b);
    if (d < bd) { bd = d; best = e; }
  }
  const lim = Math.max(28, S.set.snapPx * 2);
  if (best < 0 || Math.sqrt(bd) > lim) return null;
  let ch = G.isSharp(t, best, cosA) ? G.chain(t, best, angle) : { verts: [E.a[best], E.b[best]], closed: false };
  let usedAngle = angle;
  if (!ch.closed && S.set.edgeRetry && G.isSharp(t, best, cosA)) {
    for (let a = angle / 2; a >= 3; a /= 2) {
      if (!G.isSharp(t, best, Math.cos(a * Math.PI / 180))) break;
      const c2 = G.chain(t, best, a);
      if (c2.closed) { ch = c2; usedAngle = a; break; }
    }
  }
  const pts = ch.verts.map(v => this.vw(c, v));
  let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  if (ch.closed) len += pts[pts.length - 1].distanceTo(pts[0]);
  let rim = null;
  const n = pts.length;
  if (n >= 5) {
    const f = G.fitCircle(pts);
    let ext = 0; for (const p of pts) ext = Math.max(ext, p.distanceTo(pts[0]));
    if (f && f.rms < 0.01 * f.r && f.planar < 0.01 * f.r && f.r < 20 * ext) rim = f;
  }
  return { type: 'edge', id: hit.id, verts: ch.verts, pts, closed: ch.closed, len, segs: ch.closed ? n : n - 1, rim, angle: usedAngle };
};

P.computeFace = function (hit) {
  const c = this.ctx(hit.id); if (!c) return null;
  const t = c.t;
  const faces = S.set.wholeFace ? G.facePatch(t, hit.f, S.set.faceTol) : [hit.f];
  let area = 0; const cen = new THREE.Vector3(), nrm = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const f of faces) {
    const a = t.fa[f]; area += a;
    const vs = [0, 1, 2].map(k => t.idx[f * 3 + k]);
    const w = vs.map(v => this.vw(c, v));
    w.forEach(p => box.expandByPoint(p));
    cen.addScaledVector(w[0].clone().add(w[1]).add(w[2]), a / 3);
    nrm.x += t.fn[f * 3] * a; nrm.y += t.fn[f * 3 + 1] * a; nrm.z += t.fn[f * 3 + 2] * a;
  }
  if (area > 0) cen.multiplyScalar(1 / area);
  nrm.applyMatrix3(c.nm).normalize();
  const s = c.s;
  return { type: 'face', id: hit.id, faces, area: area * s * s, n: nrm, c: cen, d: nrm.dot(cen), box, planar: faces.length === 1 || S.set.wholeFace };
};

P.compute = function (hit, x, y, filter) {
  if (filter === 'point') return this.computePoint(hit, x, y);
  if (filter === 'edge') return this.computeEdge(hit, x, y);
  if (filter === 'face') return this.computeFace(hit);
  return { type: 'object', id: hit.id };
};

/* ---------- highlights ---------- */
P.show = function (slot, ent) {
  V.ovl[slot] = []; V.clearHL(slot);
  if (!ent) { S.needRender = true; return; }
  const col = slot === 'hover' ? COL.hover : COL.pick;
  if (ent.type === 'point') V.ovl[slot].push({ type: 'dot', p: ent.p, color: col, r: 5.5 });
  else if (ent.type === 'edge') {
    V.ovl[slot].push({ type: 'poly', pts: ent.pts, color: slot === 'hover' ? '#2563eb' : col, w: 3.5, closed: ent.closed });
    if (!ent.closed) { V.ovl[slot].push({ type: 'dot', p: ent.pts[0], color: col, r: 4 }, { type: 'dot', p: ent.pts[ent.pts.length - 1], color: col, r: 4 }); }
    if (ent.rim) V.ovl[slot].push({ type: 'dot', p: ent.rim.c, color: col, r: 3.5, cross: true });
  } else if (ent.type === 'face') V.faceHL(slot, ent.id, ent.faces, col, slot === 'hover' ? 0.3 : 0.5);
  else if (ent.type === 'object') V.boxHL(slot, ent.id, col);
  S.needRender = true;
};
P.clearHover = function () { if (V.ovl.hover.length || V.hl.hover) { this.show('hover', null); } this.hoverKey = null; };
P.refreshHighlights = function () {
  this.show('hover', null);
  if (S.pick && item(S.pick.id) && V.rec.get(S.pick.id) && V.rec.get(S.pick.id).mesh) this.show('pick', S.pick);
  else { S.pick = null; this.show('pick', null); }
};
P.hoverItem = function (id) { // tree / list hover → highlight even if hidden
  if (id == null) { this.show('hover', null); return; }
  const it = item(id); if (!it) return;
  V.ovl.hover = []; V.clearHL('hover');
  if (it.kind === 'mesh') V.boxHL('hover', id, COL.hover);
  else if (it.kind === 'cs') V.ovl.hover.push({ type: 'dot', p: new THREE.Vector3().fromArray(it.o), color: COL.hover, r: 7 });
  S.needRender = true;
};

/* ---------- events from the viewer ---------- */
P.hoverFilter = function () {
  if (T.active) return T.hoverFilter();
  return S.set.filter;
};
P.onHover = function (x, y) {
  if (!S.set.hoverPreview || this.totalFaces() > 600000) return;
  const filter = this.hoverFilter();
  if (!filter) { this.clearHover(); return; }
  const hits = this.raycast(x, y);
  if (!hits.length) { this.clearHover(); return; }
  const ent = this.compute(hits[0], x, y, filter);
  const key = ent ? ent.type + ':' + ent.id + ':' + (ent.v != null ? ent.v : ent.verts ? ent.verts[0] + '-' + ent.verts.length : ent.faces ? ent.faces[0] + '-' + ent.faces.length : ent.type === 'point' ? Math.round(x) + ',' + Math.round(y) : '') : null;
  if (key === this.hoverKey) return;
  this.hoverKey = key;
  this.show('hover', ent);
};
P.onDbl = function (x, y) {
  const hits = this.raycast(x, y);
  if (!hits.length) return;
  V.pivot.copy(hits[0].point);
  toast('Rotation centre: ' + fmtV(hits[0].point) + ' cm');
  S.needRender = true;
};
P.onClick = function (x, y, e) {
  if (T.active) { T.click(x, y, e); return; }
  const hits = this.raycast(x, y);
  if (!hits.length) {
    S.pick = null; this.show('pick', null);
    if (S.set.tool === 'select' && !(e.ctrlKey || e.metaKey)) UI.select(null);
    UI.refreshToolwin(); UI.status(); return;
  }
  const ids = []; for (const h of hits) if (!ids.includes(h.id)) ids.push(h.id);
  const front = item(hits[0].id);
  const frontTransparent = front && V.effOpacity(front, false) < 0.995;
  if (S.set.pickPop && ids.length > 1 && (S.set.filter === 'object' || frontTransparent)) {
    this.popup(x, y, hits, ids, (id) => { const h = hits.find(q => q.id === id); this.pickFrom(h, x, y, e); });
    return;
  }
  this.pickFrom(hits[0], x, y, e);
};
P.pickFrom = function (hit, x, y, e) {
  const ent = this.compute(hit, x, y, S.set.filter);
  if (!ent) { UI.status('⚠ No edge near the cursor — click closer to an edge'); return; }
  S.pick = ent; this.show('pick', ent);
  if (S.set.tool === 'select') {
    if (e && (e.ctrlKey || e.metaKey)) UI.toggleSel(ent.id); else UI.select(ent.id, { keepPick: true });
  } else UI.refreshProps();
  UI.refreshToolwin();
  UI.status(this.summary(ent), true);
};

/* ---------- overlap pop-up ---------- */
P.popup = function (x, y, hits, ids, done) {
  const pop = $('#pickPop'); pop.innerHTML = '';
  let act = ids[0];
  const close = () => { pop.classList.add('hidden'); this.show('hover', null); };
  const ok = () => { close(); done(act); };
  pop.append(h('div', { class: 'pp-h', text: `${ids.length} overlapping entities` }));
  ids.forEach((id, i) => {
    const it = item(id);
    const row = h('div', { class: 'pp-r' + (i === 0 ? ' on' : '') },
      h('span', { class: 'n', text: i + 1 }), h('span', { class: 'sw', style: { background: V.itemColor(it) } }), h('span', { text: it.name }),
      h('span', { class: 'k', text: (it.file || '').split('.').pop().toUpperCase() }));
    row.onmouseenter = () => this.hoverItem(id);
    row.onclick = () => { act = id; $$('.pp-r', pop).forEach(r => r.classList.remove('on')); row.classList.add('on'); };
    row.ondblclick = () => { act = id; ok(); };
    pop.append(row);
  });
  pop.append(h('div', { class: 'pp-f' }, h('button', { class: 'btn sm', onclick: close }, 'Cancel'), h('button', { class: 'btn sm primary', onclick: ok }, 'Select')));
  pop.classList.remove('hidden');
  const vw = $('#viewport').clientWidth, vh = $('#viewport').clientHeight;
  pop.style.left = clamp(x + 12, 6, vw - pop.offsetWidth - 6) + 'px';
  pop.style.top = clamp(y + 12, 48, vh - pop.offsetHeight - 6) + 'px';
};

/* ---------- local coordinates ---------- */
P.csMatrix = function (cs) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cs.r[0] * Math.PI / 180, cs.r[1] * Math.PI / 180, cs.r[2] * Math.PI / 180, 'XYZ'));
  m.setPosition(new THREE.Vector3().fromArray(cs.o));
  return m;
};
P.toLocal = function (p, csId) {
  const cs = item(csId == null ? S.doc.activeCS : csId); if (!cs || cs.id === 0 && csId == null) return null;
  return p.clone().applyMatrix4(this.csMatrix(cs).invert());
};
P.dirLocal = function (n) {
  const cs = item(S.doc.activeCS); if (!cs || cs.id === 0) return null;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cs.r[0] * Math.PI / 180, cs.r[1] * Math.PI / 180, cs.r[2] * Math.PI / 180, 'XYZ'));
  return n.clone().applyQuaternion(q.invert());
};

/* ---------- summaries & info cards ---------- */
P.summary = function (ent) {
  const it = item(ent.id); const nm = it ? it.name : '';
  if (ent.type === 'point') return `Point · ${nm} — ${fmtV(ent.p)} cm${ent.snapped ? ' (vertex)' : ''}`;
  if (ent.type === 'edge') return `Edge · ${nm} — L = ${fmt(ent.len)} cm${ent.rim ? ' · circle R = ' + fmt(ent.rim.r) + ' cm' : ''}`;
  if (ent.type === 'face') return `Face · ${nm} — A = ${fmt(ent.area)} cm² · n = ${fmtV(ent.n)}`;
  const b = V.worldBox(ent.id), s = b.getSize(new THREE.Vector3());
  return `${KIND[it.kind]} · ${nm} — ${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} cm`;
};
function kvTable(rows) {
  const t = h('table', { class: 'kv' });
  for (const [k, v] of rows) { if (v == null) continue; const tr = h('tr'); tr.append(h('td', { text: k }), h('td', { html: v })); t.append(tr); }
  return t;
}
function copyText(s) {
  (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('Copied: ' + (s.length > 60 ? s.slice(0, 60) + '…' : s)), () => toast('⚠ Clipboard not available'));
}
P.objectStats = function (id) {
  const c = this.ctx(id); if (!c) return null;
  const s = c.s, b = V.worldBox(id);
  const chk = c.t.chk || (c.t.chk = G.check(c.t));
  return { box: b, size: b.getSize(new THREE.Vector3()), center: b.getCenter(new THREE.Vector3()), volume: Math.abs(c.t.volume) * s * s * s, area: c.t.area * s * s, centroid: new THREE.Vector3().fromArray(c.t.centroid).applyMatrix4(c.m), nf: c.t.nf, nv: c.t.nv, closed: chk ? chk.closed : null, inverted: c.t.volume < 0 };
};
P.card = function (ent) {
  const it = item(ent.id); if (!it) return null;
  const card = h('div', { class: 'card' });
  const title = { point: 'Point', edge: ent.rim ? 'Circular edge' : 'Edge', face: 'Face', object: KIND[it.kind] }[ent.type];
  card.append(h('div', { class: 'ct' }, title, h('span', { text: '· ' + it.name })));
  const loc = (p) => { const l = this.toLocal(p); return l ? fmtV(l) : null; };
  const csName = item(S.doc.activeCS).name;
  let rows = [], acts = [];
  if (ent.type === 'point') {
    rows = [['X', fmtLen(ent.p.x)], ['Y', fmtLen(ent.p.y)], ['Z', fmtLen(ent.p.z)], ['Local (' + esc(csName) + ')', loc(ent.p)], ['Source', ent.snapped ? 'vertex (snapped)' : 'point on surface']];
    acts = [['Copy X Y Z', () => copyText(`${fmt(ent.p.x)} ${fmt(ent.p.y)} ${fmt(ent.p.z)}`)], ['Coordinate system here', () => T.csAt(ent.p)]];
  } else if (ent.type === 'edge') {
    const A = ent.pts[0], B = ent.closed ? ent.pts[0] : ent.pts[ent.pts.length - 1];
    rows = [['Length', fmtLen(ent.len)], ['Segments', ent.segs + (ent.closed ? ' (closed chain)' : '')]];
    if (ent.rim) rows.push(['Centre', fmtV(ent.rim.c)], ['Radius', fmtLen(ent.rim.r)], ['Diameter', fmtLen(ent.rim.r * 2)], ['Axis', fmtV(ent.rim.n)], ['Fit rms', fmt(ent.rim.rms, 5) + ' cm']);
    if (!ent.closed) rows.push(['Start', fmtV(A)], ['End', fmtV(B)], ['Δ', fmtV(B.clone().sub(A))], ['Local start', loc(A)], ['Local end', loc(B)]);
    if (ent.angle !== S.set.edgeAngle) rows.push(['Angle used', fmt(ent.angle, 1) + '° (retry)']);
    acts = [['Copy A B', () => copyText(`${fmt(A.x)} ${fmt(A.y)} ${fmt(A.z)} ${fmt(B.x)} ${fmt(B.y)} ${fmt(B.z)}`)]];
    if (ent.rim) acts.push(['CS on circle', () => T.csFrom(ent.rim.c, ent.rim.n, 'CS on circle')]);
  } else if (ent.type === 'face') {
    const s = ent.box.getSize(new THREE.Vector3());
    const ln = this.dirLocal(ent.n);
    rows = [['Area', `${fmt(ent.area)} cm²<span class="mm">${fmt(ent.area * 100, 1)} mm²</span>`], ['Triangles', ent.faces.length], ['Normal', fmtV(ent.n)], ['Local normal', ln ? fmtV(ln) : null], ['Centre', fmtV(ent.c)], ['Local centre', loc(ent.c)],
    ['Plane', `n·x = ${fmt(ent.d)}`], ['Box min', fmtV(ent.box.min)], ['Box max', fmtV(ent.box.max)], ['Dimensions', `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} cm`]];
    acts = [['CS on face', () => T.csFrom(ent.c, ent.n, 'CS on face')], ['Look normal', () => V.viewNormal(ent.n, ent.c)]];
  } else {
    const st = this.objectStats(ent.id);
    if (st) {
      rows = [['Box min', fmtV(st.box.min)], ['Box max', fmtV(st.box.max)], ['Size', `${fmt(st.size.x)} × ${fmt(st.size.y)} × ${fmt(st.size.z)} cm`], ['Centre', fmtV(st.center)],
      ['Volume', `${fmt(st.volume)} cm³` + (st.closed === false ? ' <span class="mm">⚠ open mesh</span>' : '')], ['Area', `${fmt(st.area)} cm²`], ['Centroid', fmtV(st.centroid)], ['Triangles', st.nf.toLocaleString('en-US')]];
      acts = [['CS at centroid', () => T.csAt(st.centroid)], ['CS at box centre', () => T.csAt(st.center)]];
    }
  }
  card.append(kvTable(rows));
  if (acts.length) card.append(h('div', { class: 'actions' }, acts.map(([l, fn]) => h('button', { class: 'btn sm', onclick: fn }, l))));
  return card;
};
