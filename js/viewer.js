'use strict';
/* viewer.js — three.js scene, cameras, trackball navigation, render modes, triad, overlays, labels */

const V = {
  rec: new Map(),          // item id -> record
  env: new Map(),          // item id -> motion envelope {key, obj, mesh, lines}
  geoRender: new Map(),    // geoKey -> {g, eg}
  pivot: new THREE.Vector3(),
  halfH: 10,
  ovl: { hover: [], pick: [], pending: [], tool: [] },   // SVG overlay primitives
  hl: {},                  // highlight 3D objects by slot
  box: new THREE.Box3(),
  anim: null,
  w: 1, h: 1
};

V.init = function () {
  const cv = $('#gl');
  const r = this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setClearColor(0x000000, 0);
  this.scene = new THREE.Scene();
  this.persp = new THREE.PerspectiveCamera(45, 1, 0.01, 1000); this.persp.up.set(0, 0, 1);
  this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000); this.ortho.up.set(0, 0, 1);
  this.cam = S.set.proj === 'ortho' ? this.ortho : this.persp;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xaab4c2, 0.85); hemi.position.set(0, 0, 1);
  this.head = new THREE.DirectionalLight(0xffffff, 0.55);
  this.scene.add(hemi, this.head, this.head.target);
  this.root = new THREE.Group(); this.helpers = new THREE.Group(); this.hlGroup = new THREE.Group();
  this.scene.add(this.root, this.helpers, this.hlGroup);
  this.axes = new THREE.AxesHelper(1);
  this.axes.material.depthTest = false; this.axes.renderOrder = 990; this.axes.visible = S.set.axes;
  this.scene.add(this.axes);
  // initial iso view
  this.cam.position.set(20, -20, 20);
  this.orient(new THREE.Vector3(1, -1, 1), new THREE.Vector3(0, 0, 1));
  this.halfH = 12;
  new ResizeObserver(() => this.resize()).observe($('#viewport'));
  this.resize();
  this.initControls();
  this.initTriad();
  const loop = () => { requestAnimationFrame(loop); this.frame(); };
  requestAnimationFrame(loop);
};

V.setPixelRatio = function () {
  const pr = clamp(Math.min(window.devicePixelRatio || 1, 2) * (S.set.res || 1), 0.25, 3);
  this.renderer.setPixelRatio(pr);
  this.renderer.setSize(this.w, this.h, false);
  S.needRender = true;
};
V.resize = function () {
  const vp = $('#viewport'); this.w = Math.max(1, vp.clientWidth); this.h = Math.max(1, vp.clientHeight);
  this.setPixelRatio();
  this.updateProj();
};
V.updateProj = function () {
  const a = this.w / this.h;
  this.persp.aspect = a;
  this.ortho.left = -this.halfH * a; this.ortho.right = this.halfH * a; this.ortho.top = this.halfH; this.ortho.bottom = -this.halfH;
  this.persp.updateProjectionMatrix(); this.ortho.updateProjectionMatrix();
  S.needRender = true;
};

/* ---------- camera helpers ---------- */
V.fwd = function () { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion); };
V.right = function () { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.cam.quaternion); };
V.up = function () { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.cam.quaternion); };
V.orient = function (dirToCam, up) {
  const m = new THREE.Matrix4().lookAt(dirToCam.clone().normalize(), new THREE.Vector3(), up);
  this.cam.quaternion.setFromRotationMatrix(m);
};
V.pivotDepth = function () { return Math.max(1e-6, this.fwd().dot(this.pivot.clone().sub(this.cam.position))); };
V.setProjection = function (p) {
  if ((p === 'ortho') === (this.cam === this.ortho)) return;
  const from = this.cam, fov = this.persp.fov * Math.PI / 360;
  if (p === 'ortho') {
    this.halfH = this.pivotDepth() * Math.tan(fov);
    this.ortho.position.copy(from.position); this.ortho.quaternion.copy(from.quaternion);
    this.cam = this.ortho;
  } else {
    const f = this.fwd(), d = this.halfH / Math.tan(fov);
    const q = from.position.clone().addScaledVector(f, f.dot(this.pivot.clone().sub(from.position)));
    this.persp.quaternion.copy(from.quaternion);
    this.persp.position.copy(q).addScaledVector(f, -d);
    this.cam = this.persp;
  }
  S.set.proj = p; saveSettings(); this.updateProj();
};

/* visible scene box (world) */
V.computeBox = function (onlyVisible) {
  const b = new THREE.Box3();
  for (const [id, r] of this.rec) {
    if (!r.mesh) continue;
    if (onlyVisible !== false && !r.shown) continue;
    b.union(new THREE.Box3().setFromObject(r.mesh));
  }
  for (const e of this.env.values()) if (e.obj.visible || onlyVisible === false) b.union(e.box);
  if (b.isEmpty() && onlyVisible !== false) return this.computeBox(false);
  if (b.isEmpty()) b.set(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
  return b;
};
V.diag = function () { const s = this.box.getSize(new THREE.Vector3()); return Math.max(1e-6, s.length()); };

V.fitParams = function (box) {
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const R = Math.max(sph.radius, 1e-4) * (1 + S.set.margin / 100);
  const a = this.w / this.h, vf = this.persp.fov * Math.PI / 360;
  const hf = Math.atan(Math.tan(vf) * a);
  const d = R / Math.sin(Math.min(vf, hf));
  return { c: sph.center, R, d, halfH: a < 1 ? R / a : R };
};
V.fit = function (box, anim) {
  box = box || this.computeBox();
  const p = this.fitParams(box), f = this.fwd();
  this.animateTo(p.c.clone().addScaledVector(f, -p.d), this.cam.quaternion.clone(), p.c, p.halfH, anim);
};
V.setView = function (dir, up, box) {
  box = box || this.computeBox();
  const p = this.fitParams(box);
  const m = new THREE.Matrix4().lookAt(dir.clone().normalize(), new THREE.Vector3(), up);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  this.animateTo(p.c.clone().addScaledVector(dir.clone().normalize(), p.d), q, p.c, p.halfH, true);
};
V.viewAxis = function (axis, sign) {
  const d = new THREE.Vector3(); d.setComponent(axis, sign);
  const up = axis === 2 ? new THREE.Vector3(0, sign > 0 ? 1 : 1, 0) : new THREE.Vector3(0, 0, 1);
  this.setView(d, up);
};
V.viewIso = function () { this.setView(new THREE.Vector3(1, -1, 1), new THREE.Vector3(0, 0, 1)); };
V.viewNormal = function (n, center) {
  n = n.clone().normalize();
  const axes = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)];
  let up = axes[0]; let best = 2;
  for (const a of axes) { const d = Math.abs(a.dot(n)); if (d < best) { best = d; up = a; } }
  up = up.clone().addScaledVector(n, -up.dot(n)).normalize();
  const box = this.computeBox(); const p = this.fitParams(box);
  const c = center ? center.clone() : p.c;
  const m = new THREE.Matrix4().lookAt(n, new THREE.Vector3(), up);
  this.animateTo(c.clone().addScaledVector(n, p.d), new THREE.Quaternion().setFromRotationMatrix(m), c, p.halfH, true);
};
V.flipView = function () {
  const q = new THREE.Quaternion().setFromAxisAngle(this.up(), Math.PI);
  const pos = this.cam.position.clone().sub(this.pivot).applyQuaternion(q).add(this.pivot);
  this.animateTo(pos, q.multiply(this.cam.quaternion.clone()), this.pivot.clone(), this.halfH, true);
};
V.animateTo = function (pos, quat, pivot, halfH, anim) {
  if (anim === false) {
    this.cam.position.copy(pos); this.cam.quaternion.copy(quat); this.pivot.copy(pivot); this.halfH = halfH; this.updateProj(); return;
  }
  this.anim = { t0: performance.now(), dur: 280, p0: this.cam.position.clone(), p1: pos, q0: this.cam.quaternion.clone(), q1: quat, v0: this.pivot.clone(), v1: pivot.clone(), h0: this.halfH, h1: halfH };
  S.needRender = true;
};
V.stepAnim = function () {
  const a = this.anim; if (!a) return;
  let t = (performance.now() - a.t0) / a.dur; if (t >= 1) { t = 1; this.anim = null; }
  const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  this.cam.position.lerpVectors(a.p0, a.p1, e);
  this.cam.quaternion.slerpQuaternions(a.q0, a.q1, e);
  this.pivot.lerpVectors(a.v0, a.v1, e);
  this.halfH = a.h0 + (a.h1 - a.h0) * e;
  this.updateProj();
  S.needRender = true;
};

/* ---------- navigation ---------- */
V.rotate = function (dx, dy) {
  const k = 0.008;
  const sx = S.set.invX ? -1 : 1, sy = S.set.invY ? -1 : 1;
  const q = new THREE.Quaternion().setFromAxisAngle(this.up(), -dx * k * sx)
    .multiply(new THREE.Quaternion().setFromAxisAngle(this.right(), -dy * k * sy));
  this.cam.position.sub(this.pivot).applyQuaternion(q).add(this.pivot);
  this.cam.quaternion.premultiply(q);
  S.needRender = true;
};
V.worldPerPx = function () {
  if (this.cam === this.ortho) return 2 * this.halfH / this.h;
  return 2 * this.pivotDepth() * Math.tan(this.persp.fov * Math.PI / 360) / this.h;
};
V.pan = function (dx, dy) {
  const s = this.worldPerPx();
  this.cam.position.addScaledVector(this.right(), -dx * s).addScaledVector(this.up(), dy * s);
  S.needRender = true;
};
V.zoomAt = function (x, y, f) {
  const nx = x / this.w * 2 - 1, ny = -(y / this.h) * 2 + 1;
  if (this.cam === this.ortho) {
    const a = this.w / this.h;
    const off = this.right().multiplyScalar(nx * a * this.halfH * (1 - f)).add(this.up().multiplyScalar(ny * this.halfH * (1 - f)));
    this.halfH = clamp(this.halfH * f, 1e-5, 1e7);
    this.cam.position.add(off);
    this.updateProj();
  } else {
    const ray = new THREE.Vector3(nx, ny, 0.5).unproject(this.cam).sub(this.cam.position).normalize();
    const fw = this.fwd(), depth = this.pivotDepth();
    const t = depth / Math.max(1e-6, ray.dot(fw));
    const P = this.cam.position.clone().addScaledVector(ray, t);
    const v = this.cam.position.clone().sub(P);
    if (v.length() * f < 1e-5) return;
    this.cam.position.copy(P).add(v.multiplyScalar(f));
  }
  S.needRender = true;
};

V.initControls = function () {
  const cv = $('#gl');
  const pts = new Map(); let mode = null, down = null, pinch = null, hoverReq = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.focus({ preventScroll: true });
    UI.closePopups();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { }
    const p = pos(e); pts.set(e.pointerId, p);
    this.anim = null;
    if (pts.size === 1) {
      down = { x: p.x, y: p.y, t: performance.now(), moved: false, button: e.button };
      mode = (e.button === 1 || e.button === 2 || e.shiftKey) ? 'pan' : 'rot';
      down.last = p;
    } else if (pts.size === 2) {
      down = null; mode = 'pinch';
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        if (hoverReq) return;
        hoverReq = requestAnimationFrame(() => { hoverReq = null; P.onHover(p.x, p.y, e); });
      }
      return;
    }
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
    if (mode === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch && d > 0) {
        this.pan(m.x - pinch.m.x, m.y - pinch.m.y);
        this.zoomAt(m.x, m.y, pinch.d / d);
      }
      pinch = { d, m };
      return;
    }
    if (!down) return;
    if (!down.moved && Math.hypot(p.x - down.x, p.y - down.y) >= 6) { down.moved = true; P.clearHover(); }
    if (!down.moved) return;
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (mode === 'rot') this.rotate(dx, dy); else if (mode === 'pan') this.pan(dx, dy);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const p = pos(e);
    if (down && !down.moved && performance.now() - down.t < 700 && pts.size === 1 && down.button !== 2) P.onClick(p.x, p.y, e);
    pts.delete(e.pointerId);
    if (pts.size === 0) { mode = null; down = null; pinch = null; }
    else if (pts.size === 1) { mode = 'rot'; const q = [...pts.values()][0]; down = { x: q.x, y: q.y, t: 0, moved: true }; pinch = null; }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); if (!pts.size) { mode = null; down = null; } });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pts.size) P.clearHover(); });
  cv.addEventListener('dblclick', e => { const p = pos(e); P.onDbl(p.x, p.y); });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); this.anim = null;
    const p = pos(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomAt(p.x, p.y, Math.exp(clamp(dy, -200, 200) * 0.0015));
  }, { passive: false });
};

/* ---------- document → scene ---------- */
V.isShown = function (it) {
  if (it.kind === 'cs') return !!it.visible || (it.id !== 0 && it.id === S.doc.activeCS);
  return !!it.visible;
};
V.itemColor = function (it) {
  if (S.set.colorByFile && it.kind === 'mesh') { const g = groupOf(it.group); if (g) return g.color; }
  return it.color;
};
V.geoKeyOf = function (it) {
  return it.kind === 'mesh' ? it.geo : null;
};
V.renderGeo = function (key) {
  let rg = this.geoRender.get(key);
  if (!rg) {
    const g = G.renderGeometry(S.geo.get(key), S.set.crease);
    rg = { g, eg: new THREE.EdgesGeometry(g, 30) };
    this.geoRender.set(key, rg);
  }
  return rg;
};
V.disposeRec = function (r) {
  if (r.obj) { this.root.remove(r.obj); this.helpers.remove(r.obj); r.obj.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry && o.userData.own) o.geometry.dispose(); }); }
};
V.sync = function (forceRebuild) {
  const ids = new Set(S.doc.items.map(i => i.id));
  for (const [id, r] of this.rec) if (!ids.has(id) || forceRebuild) { this.disposeRec(r); this.rec.delete(id); }
  for (const it of S.doc.items) {
    let r = this.rec.get(it.id);
    if (it.kind !== 'mesh' && it.kind !== 'cs') continue;
    const key = it.kind === 'mesh' ? this.geoKeyOf(it) : 'cs';
    if (r && r.key !== key) { this.disposeRec(r); this.rec.delete(it.id); r = null; }
    if (!r) { r = this.create(it, key); this.rec.set(it.id, r); }
    this.update(r, it);
  }
  // drop unused render geometries / box topologies
  const used = new Set([...this.rec.values()].map(r => r.key));
  for (const [k, rg] of this.geoRender) if (!used.has(k)) { rg.g.dispose(); rg.eg.dispose(); this.geoRender.delete(k); }
  this.syncEnvelopes();
  this.box = this.computeBox();
  this.updateHelpers();
  this.applyMode();
  P.refreshHighlights();
};
V.create = function (it, key) {
  const r = { id: it.id, kind: it.kind, key, obj: null, mesh: null, edges: null };
  if (it.kind === 'mesh') {
    const rg = this.renderGeo(key);
    const mat = new THREE.MeshPhongMaterial({ color: it.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, shininess: 28, specular: 0x1c1c1c });
    r.mesh = new THREE.Mesh(rg.g, mat); r.mesh.userData.id = it.id;
    r.edges = new THREE.LineSegments(rg.eg, new THREE.LineBasicMaterial({ color: 0x39434f }));
    r.obj = new THREE.Group(); r.obj.add(r.mesh, r.edges);
    r.obj.matrixAutoUpdate = false;
    this.root.add(r.obj);
  } else if (it.kind === 'cs') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([.86, .15, .15, .86, .15, .15, .09, .64, .29, .09, .64, .29, .15, .39, .92, .15, .39, .92], 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    l.userData.own = true; l.renderOrder = 980;
    r.obj = new THREE.Group(); r.obj.add(l); this.helpers.add(r.obj);
  }
  return r;
};
V.update = function (r, it) {
  r.shown = this.isShown(it);
  if (r.mesh) {
    r.obj.visible = r.shown;
    // current motion position (nominal = identity)
    r.obj.matrix.copy(Motion.itemMatrix(it));
    r.obj.updateMatrixWorld(true);
  } else if (it.kind === 'cs') {
    r.obj.visible = r.shown;
    r.obj.position.fromArray(it.o);
    r.obj.rotation.set(it.r[0] * Math.PI / 180, it.r[1] * Math.PI / 180, it.r[2] * Math.PI / 180, 'XYZ');
    r.obj.updateMatrixWorld(true);
  }
};
V.updateHelpers = function () {
  const D = this.diag();
  for (const [id, r] of this.rec) {
    if (r.kind === 'cs') r.obj.scale.setScalar(D * 0.07);
  }
  this.axes.scale.setScalar(D * 0.06);
  this.axes.visible = !!S.set.axes;
};
V.effOpacity = function (it, sel) {
  const m = S.set.renderMode; let o = it.opacity != null ? it.opacity : 1;
  if (m === 'wire') return 0;
  if (it.appearance === 'opaque') o = 1;
  else if (it.appearance === 'transparent') o = Math.min(o, 0.3);
  else if (m === 'opaque') o = 1;
  else if (m === 'ghost') o = Math.min(o, 0.12);
  if (sel) o = Math.min(1, o + 0.15);
  return o;
};
V.applyMode = function () {
  const wire = S.set.renderMode === 'wire';
  for (const [id, r] of this.rec) {
    const it = item(id); if (!it) continue;
    if (r.mesh) {
      const sel = S.multi.has(id);
      const o = this.effOpacity(it, sel);
      const mat = r.mesh.material;
      const col = this.itemColor(it);
      mat.color.set(col);
      mat.opacity = o; mat.transparent = o < 0.995; mat.depthWrite = !mat.transparent; mat.visible = o > 0.001;
      if (mat.emissive) mat.emissive.setHex(sel ? 0x0b2a66 : 0x000000);
      mat.needsUpdate = true;
      r.edges.visible = S.set.edges || wire;
      const ec = sel ? new THREE.Color(0xff6a00) : new THREE.Color(S.set.theme === 'dark' ? 0x0d1117 : 0x39434f);
      r.edges.material.color.copy(ec);
    }
  }
  for (const e of this.env.values()) {
    const m = Motion.get(e.mid); if (!m) continue;
    const col = new THREE.Color(Motion.targetColor(e.t));
    const hi = S.selMotion === m.id;
    e.mesh.material.color.copy(col); e.mesh.visible = !wire;
    e.mesh.material.opacity = Math.min(1, (m.envOpacity != null ? m.envOpacity : 0.22) + (hi ? 0.1 : 0));
    e.lines.material.color.copy(hi ? new THREE.Color(0xff6a00) : col.clone().multiplyScalar(0.6));
  }
  S.needRender = true;
};

/* ---------- motion envelopes (one merged object per motion × target) ---------- */
V.syncEnvelopes = function () {
  const seen = new Set();
  for (const m of Motion.list()) for (const t of m.targets) {
    const k = m.id + '|' + t, key = Motion.envKey(m, t);
    let e = this.env.get(k);
    if (!key) { if (e) this.disposeEnv(k); continue; }
    seen.add(k);
    if (!e || e.key !== key) { if (e) this.disposeEnv(k); e = this.buildEnv(m, t, key); if (!e) continue; this.env.set(k, e); }
    e.obj.visible = true;
  }
  for (const k of [...this.env.keys()]) if (!seen.has(k)) this.disposeEnv(k);
};
V.disposeEnv = function (k) {
  const e = this.env.get(k); if (!e) return;
  this.root.remove(e.obj);
  e.obj.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
  this.env.delete(k);
};
V.buildEnv = function (m, t, key) {
  const mem = Motion.members(t).filter(it => it.visible && this.rec.get(it.id));
  let nf = 0; mem.forEach(it => (nf += S.geo.get(it.geo).nf));
  const { list, capped, total } = Motion.combos(m, nf);
  if (!list.length || !mem.length) return null;
  if (capped) toast(`⚠ ${m.name} on ${Motion.targetName(t)}: envelope limited to ${list.length} of ${total} positions`);
  const parts = mem.map(it => ({ id: it.id, rg: this.renderGeo(it.geo), mats: list.map(vals => Motion.itemMatrix(it, { mid: m.id, vals }).elements) }));
  let nP = 0, nE = 0;
  for (const p of parts) { nP += p.rg.g.attributes.position.array.length * list.length; nE += p.rg.eg.attributes.position.array.length * list.length; }
  const OP = new Float32Array(nP), ON = new Float32Array(nP), OE = new Float32Array(nE);
  let oP = 0, oE = 0;
  const xf = (src, dst, off, me, rot) => {
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      dst[off + i] = me[0] * x + me[4] * y + me[8] * z + (rot ? 0 : me[12]);
      dst[off + i + 1] = me[1] * x + me[5] * y + me[9] * z + (rot ? 0 : me[13]);
      dst[off + i + 2] = me[2] * x + me[6] * y + me[10] * z + (rot ? 0 : me[14]);
    }
  };
  for (const p of parts) {
    const P = p.rg.g.attributes.position.array, N = p.rg.g.attributes.normal.array, E = p.rg.eg.attributes.position.array;
    for (const me of p.mats) { xf(P, OP, oP, me, false); xf(N, ON, oP, me, true); xf(E, OE, oE, me, false); oP += P.length; oE += E.length; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(OP, 3)); g.setAttribute('normal', new THREE.BufferAttribute(ON, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(OE, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: 0x888888, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, shininess: 10 }));
  mesh.renderOrder = 5;
  const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.6 }));
  lines.renderOrder = 6;
  const obj = new THREE.Group(); obj.add(mesh, lines); this.root.add(obj);
  return { key, mid: m.id, t, obj, mesh, lines, box: g.boundingBox.clone(), count: list.length, parts: parts.map(p => ({ id: p.id, mats: p.mats })) };
};

/* ---------- highlights ---------- */
V.clearHL = function (slot) {
  const o = this.hl[slot];
  if (o) { o.parent && o.parent.remove(o); o.traverse(x => { x.geometry && x.geometry.dispose(); x.material && x.material.dispose(); }); }
  this.hl[slot] = null; S.needRender = true;
};
V.faceHL = function (slot, id, faces, color, opacity) {
  this.clearHL(slot);
  const r = this.rec.get(id), it = item(id); if (!r || !r.mesh) return;
  const t = S.geo.get(r.key);
  const P = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => { for (let c = 0; c < 3; c++) { const v = t.idx[f * 3 + c]; P[i * 9 + c * 3] = t.pos[v * 3]; P[i * 9 + c * 3 + 1] = t.pos[v * 3 + 1]; P[i * 9 + c * 3 + 2] = t.pos[v * 3 + 2]; } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.renderOrder = 900;
  r.obj.add(m); this.hl[slot] = m; S.needRender = true;
};
V.boxHL = function (slot, id, color) {
  this.clearHL(slot);
  const r = this.rec.get(id); if (!r || !r.mesh) return;
  const b = new THREE.Box3().setFromObject(r.mesh);
  const hlp = new THREE.Box3Helper(b, new THREE.Color(color));
  hlp.material.depthTest = false; hlp.renderOrder = 950;
  this.hlGroup.add(hlp); this.hl[slot] = hlp; S.needRender = true;
};

/* ---------- projection helpers ---------- */
V.project = function (p) {
  const v = this._pv || (this._pv = new THREE.Vector3());
  v.copy(p).project(this.cam);
  if (v.z > 1 || v.z < -1) return null;
  return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h];
};
V.worldBox = function (id) { const r = this.rec.get(id); return r && r.mesh ? new THREE.Box3().setFromObject(r.mesh) : null; };

/* ---------- triad ---------- */
V.initTriad = function () {
  const svg = $('#triad');
  svg.innerHTML = '<circle cx="46" cy="46" r="44" fill="rgba(255,255,255,.55)" stroke="rgba(0,0,0,.08)"/>';
  const cols = ['#dc2626', '#16a34a', '#2563eb'], names = ['X', 'Y', 'Z'];
  this.triEnds = [];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'end');
    g.innerHTML = s > 0
      ? `<line x1="46" y1="46" stroke="${cols[a]}" stroke-width="2.2" stroke-linecap="round"/><circle r="8" fill="${cols[a]}"/><text text-anchor="middle" dy="3.6" font-size="10" font-weight="700" fill="#fff" style="pointer-events:none">${names[a]}</text>`
      : `<circle r="5" fill="#fff" stroke="${cols[a]}" stroke-width="1.6"/>`;
    g.addEventListener('click', () => this.viewAxis(a, s));
    g.append(Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'title'), { textContent: `View from ${s > 0 ? '+' : '−'}${names[a]}` }));
    svg.append(g);
    this.triEnds.push({ g, a, s });
  }
};
V.drawTriad = function () {
  const qi = this.cam.quaternion.clone().invert(), L = 30, C = 46;
  const list = this.triEnds.map(e => {
    const v = new THREE.Vector3(); v.setComponent(e.a, e.s); v.applyQuaternion(qi);
    return { e, x: C + v.x * L, y: C - v.y * L, z: v.z };
  }).sort((a, b) => a.z - b.z);
  const svg = $('#triad');
  for (const it of list) {
    const g = it.e.g;
    g.setAttribute('opacity', (0.55 + 0.45 * (it.z + 1) / 2).toFixed(2));
    const line = g.querySelector('line');
    if (line) { line.setAttribute('x2', it.x); line.setAttribute('y2', it.y); }
    g.querySelector('circle').setAttribute('cx', it.x); g.querySelector('circle').setAttribute('cy', it.y);
    const tx = g.querySelector('text'); if (tx) { tx.setAttribute('x', it.x); tx.setAttribute('y', it.y); }
    svg.append(g);
  }
  svg.firstChild.setAttribute('fill', S.set.theme === 'dark' ? 'rgba(40,48,60,.55)' : 'rgba(255,255,255,.55)');
};

/* ---------- SVG overlay (markers, polylines) + HTML labels ---------- */
V.drawOverlay = function () {
  let s = '';
  const prim = (p) => {
    if (p.type === 'poly') {
      const pts = []; let pathParts = [], cur = [];
      for (const q of p.pts) { const sp = this.project(q); if (sp) cur.push(sp[0].toFixed(1) + ',' + sp[1].toFixed(1)); else if (cur.length) { pathParts.push(cur); cur = []; } }
      if (cur.length) pathParts.push(cur);
      for (const c of pathParts) if (c.length > 1 && p.halo !== false) s += `<polyline points="${c.join(' ')}${p.closed && pathParts.length === 1 ? ' ' + c[0] : ''}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="${(p.w || 3) + 3}" stroke-linejoin="round" stroke-linecap="round" opacity="${p.op || 1}"/>`;
      for (const c of pathParts) if (c.length > 1) s += `<polyline points="${c.join(' ')}${p.closed && pathParts.length === 1 ? ' ' + c[0] : ''}" fill="none" stroke="${p.color}" stroke-width="${p.w || 3}" stroke-linejoin="round" stroke-linecap="round" ${p.dash ? 'stroke-dasharray="' + p.dash + '"' : ''} opacity="${p.op || 1}"/>`;
    } else if (p.type === 'dot') {
      const sp = this.project(p.p); if (!sp) return;
      s += `<circle cx="${sp[0].toFixed(1)}" cy="${sp[1].toFixed(1)}" r="${p.r || 4.5}" fill="${p.fill || p.color}" stroke="${p.stroke || '#fff'}" stroke-width="${p.sw || 1.5}"/>`;
      if (p.cross) s += `<path d="M${sp[0] - 7} ${sp[1]}h14M${sp[0]} ${sp[1] - 7}v14" stroke="${p.color}" stroke-width="1.4"/>`;
    }
  };
  // coordinate system origins
  for (const cs of itemsOf('cs')) {
    if (!V.isShown(cs)) continue;
    prim({ type: 'dot', p: new THREE.Vector3().fromArray(cs.o), color: cs.color, r: cs.id === S.doc.activeCS ? 4.5 : 3, sw: 1.2 });
  }
  for (const k of ['hover', 'pick', 'tool', 'pending']) for (const p of this.ovl[k]) prim(p);
  $('#overlay').innerHTML = s;
};
V.drawLabels = function () {
  const host = $('#labels'); const out = [];
  if (S.set.names) for (const it of S.doc.items) {
    if (it.kind !== 'mesh') continue;
    const r = this.rec.get(it.id); if (!r || !r.shown) continue;
    const c = this.worldBox(it.id).getCenter(new THREE.Vector3());
    out.push({ cls: 'lab', text: it.name, p: c });
  }
  for (const cs of itemsOf('cs')) if (V.isShown(cs)) {
    const ax = new THREE.Vector3(1, 1, 0).normalize().multiplyScalar(this.diag() * 0.02);
    out.push({ cls: 'lab cs' + (cs.id === S.doc.activeCS ? ' act' : ''), text: cs.name, p: new THREE.Vector3().fromArray(cs.o).add(ax), color: cs.color, off: [14, -10] });
  }
  if (T.active && T.active.result) {
    const { A, B } = T.active.result;
    out.push({ cls: 'lab ms', text: fmt(A.distanceTo(B)) + ' cm', p: A.clone().add(B).multiplyScalar(.5) });
  }
  while (host.children.length < out.length) host.append(h('div'));
  while (host.children.length > out.length) host.lastChild.remove();
  out.forEach((l, i) => {
    const d = host.children[i];
    const sp = this.project(l.p);
    if (!sp) { d.style.display = 'none'; return; }
    d.style.display = '';
    if (d.className !== l.cls) d.className = l.cls;
    if (d.textContent !== l.text) d.textContent = l.text;
    d.style.color = l.color || '';
    const o = l.off || [0, 0];
    d.style.transform = `translate(${(sp[0] + o[0]).toFixed(1)}px,${(sp[1] + o[1]).toFixed(1)}px) translate(-50%,-50%)`;
  });
};

/* ---------- frame ---------- */
V.updateClip = function () {
  const sph = this.box.getBoundingSphere(new THREE.Sphere());
  const R = Math.max(sph.radius, 1e-3);
  const dist = this.cam.position.distanceTo(this.pivot);
  const far = dist + this.pivot.distanceTo(sph.center) + 2 * R + 10;
  if (this.cam === this.persp) {
    const dc = this.cam.position.distanceTo(sph.center);
    this.persp.near = Math.max(far / 20000, dc - 1.5 * R, 1e-4);
    if (this.persp.near > far / 4) this.persp.near = far / 20000;
    this.persp.far = far;
  } else { this.ortho.near = -far; this.ortho.far = far; }
  this.cam.updateProjectionMatrix();
};
V.frame = function () {
  if (this.anim) this.stepAnim();
  if (!S.needRender) return;
  S.needRender = false;
  this.updateClip();
  this.head.position.copy(this.cam.position); this.head.target.position.copy(this.pivot);
  this.renderer.render(this.scene, this.cam);
  this.drawTriad(); this.drawOverlay(); this.drawLabels();
};
