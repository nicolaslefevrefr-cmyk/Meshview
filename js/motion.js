'use strict';
/* motion.js — motions (Tx Ty Tz Rx Ry Rz) as standalone entities, applied to meshes and/or mesh groups */

const Motion = {
  DOFS: ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'],
  LABEL: { tx: 'Tx', ty: 'Ty', tz: 'Tz', rx: 'Rx', ry: 'Ry', rz: 'Rz' },
  MAX_INSTANCES: 400,
  MAX_TRIANGLES: 3e6
};

/* motion record: { id:'m12', name, cs: <csId> | 'centroid', dofs:{tx:{on,min,max,v}…}, steps, env, envOpacity, targets:[meshId | groupId] } */
Motion.create = function (name, cs, targets) {
  const dofs = {};
  for (const k of this.DOFS) dofs[k] = { on: false, min: k[0] === 't' ? -1 : -10, max: k[0] === 't' ? 1 : 10, v: 0 };
  return { id: 'm' + newId(), name, cs: cs == null ? 'centroid' : cs, dofs, steps: 0, env: true, envOpacity: 0.22, targets: targets || [] };
};
Motion.list = () => S.doc.motions || (S.doc.motions = []);
Motion.get = (id) => Motion.list().find(m => m.id === id) || null;
Motion.enabled = (m) => (m ? Motion.DOFS.filter(k => m.dofs[k] && m.dofs[k].on) : []);
Motion.summary = function (m) {
  return this.enabled(m).map(k => {
    const d = m.dofs[k], u = k[0] === 'r' ? '°' : '';
    return `${this.LABEL[k]} ${fmt(d.min, 2)}…${fmt(d.max, 2)}${u}`;
  }).join(' · ') || 'no DOF';
};
Motion.short = function (m) { return this.enabled(m).map(k => this.LABEL[k]).join(' ') || '—'; };

/* targets */
Motion.isGroup = (t) => typeof t === 'string';
Motion.targetName = (t) => (Motion.isGroup(t) ? (groupOf(t) || { name: '?' }).name : (item(t) || { name: '?' }).name);
Motion.targetColor = (t) => (Motion.isGroup(t) ? (groupOf(t) || { color: '#888' }).color : V.itemColor(item(t) || { color: '#888' }));
Motion.members = (t) => (Motion.isGroup(t) ? itemsOf('mesh').filter(m => m.group === t) : [item(t)].filter(Boolean));
/* motions acting on a mesh: group-level first, then object-level */
Motion.forItem = function (it) {
  const g = [], o = [];
  for (const m of this.list()) {
    if (it.group && m.targets.includes(it.group)) g.push({ m, t: it.group });
    if (m.targets.includes(it.id)) o.push({ m, t: it.id });
  }
  return g.concat(o);
};
Motion.forTarget = (t) => Motion.list().filter(m => m.targets.includes(t));

/* barycentre of a target in its nominal position (volume-weighted, box centre as fallback) */
Motion.centroid = function (t) {
  const ms = this.members(t); let w = 0; const c = new THREE.Vector3(); const box = new THREE.Box3();
  for (const it of ms) {
    const topo = S.geo.get(it.geo); if (!topo) continue;
    box.expandByPoint(new THREE.Vector3().fromArray(topo.bb.min)); box.expandByPoint(new THREE.Vector3().fromArray(topo.bb.max));
    const v = Math.abs(topo.volume);
    if (v > 1e-12) { c.addScaledVector(new THREE.Vector3().fromArray(topo.centroid), v); w += v; }
  }
  if (w > 0) return c.multiplyScalar(1 / w);
  return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
};
Motion.csMatrix = function (m, t) {
  if (m.cs === 'centroid') return new THREE.Matrix4().setPosition(this.centroid(t));
  const cs = item(m.cs) || item(0);
  const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cs.r[0] * Math.PI / 180, cs.r[1] * Math.PI / 180, cs.r[2] * Math.PI / 180, 'XYZ'));
  return M.setPosition(new THREE.Vector3().fromArray(cs.o));
};
/* L = C · T(tx,ty,tz) · Rx · Ry · Rz · C⁻¹ — rotations about the CS axes through its origin, then translations along its axes */
Motion.local = function (m, t, vals) {
  const C = this.csMatrix(m, t), d = Math.PI / 180, v = (k) => (vals[k] || 0);
  const L = new THREE.Matrix4().makeTranslation(v('tx'), v('ty'), v('tz'))
    .multiply(new THREE.Matrix4().makeRotationX(v('rx') * d))
    .multiply(new THREE.Matrix4().makeRotationY(v('ry') * d))
    .multiply(new THREE.Matrix4().makeRotationZ(v('rz') * d));
  return C.clone().multiply(L).multiply(C.clone().invert());
};
Motion.current = function (m) { const vals = {}; for (const k of this.enabled(m)) vals[k] = m.dofs[k].v || 0; return vals; };
/* full world matrix of a mesh; `over` = {mid, vals} replaces one motion's values (envelopes) */
Motion.itemMatrix = function (it, over) {
  const W = new THREE.Matrix4();
  for (const { m, t } of this.forItem(it)) {
    if (!this.enabled(m).length) continue;
    W.multiply(this.local(m, t, over && over.mid === m.id ? over.vals : this.current(m)));
  }
  return W;
};
/* DOF value sets for an envelope: extremes (+ intermediate positions) of every enabled DOF, cartesian product */
Motion.combos = function (m, nf) {
  const keys = this.enabled(m); if (!keys.length) return { list: [], capped: false, total: 0 };
  const steps = Math.max(0, Math.round(m.steps || 0));
  const lists = keys.map(k => {
    const d = m.dofs[k], lo = Math.min(d.min, d.max), hi = Math.max(d.min, d.max);
    if (hi - lo < 1e-12) return [lo];
    const n = steps + 2, out = [];
    for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * i / (n - 1));
    return out;
  });
  let list = [{}];
  keys.forEach((k, i) => { const nx = []; for (const base of list) for (const v of lists[i]) nx.push(Object.assign({}, base, { [k]: v })); list = nx; });
  const total = list.length;
  const cap = Math.max(2, Math.min(this.MAX_INSTANCES, Math.floor(this.MAX_TRIANGLES / Math.max(1, nf || 1))));
  let capped = false;
  if (list.length > cap) { capped = true; const stride = list.length / cap; list = Array.from({ length: cap }, (_, i) => list[Math.floor(i * stride)]); }
  return { list, capped, total };
};
/* cache key of the envelope of motion m on target t (changes when anything that shapes it changes) */
Motion.envKey = function (m, t) {
  if (!this.enabled(m).length || m.env === false) return null;
  const mem = this.members(t).filter(it => it.visible);
  if (!mem.length) return null;
  const strip = (x) => JSON.stringify(Object.assign({}, x, { dofs: Object.fromEntries(Object.entries(x.dofs).map(([k, d]) => [k, { on: d.on, min: d.min, max: d.max }])), env: 0, envOpacity: 0, name: 0 }));
  const others = new Set(); mem.forEach(it => this.forItem(it).forEach(({ m: o }) => { if (o.id !== m.id) others.add(o); }));
  return JSON.stringify([strip(m), [...others].map(o => JSON.stringify(o)), itemsOf('cs').map(c => [c.id, c.o, c.r]), mem.map(it => [it.id, it.geo])]);
};
