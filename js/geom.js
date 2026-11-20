'use strict';
/* geom.js — file parsers, welded topology, feature edges, chains, circle fit, face patches, slicing, checks */

const G = {};

/* ---------- parsers: return [{name, pos: Float32Array (non-indexed triangles)}] ---------- */
G.parseSTL = function (buf, fname) {
  const len = buf.byteLength;
  const dv = new DataView(buf);
  const base = fname.replace(/\.[^.]+$/, '');
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(len, 512)));
  const binOk = len >= 84 && (84 + dv.getUint32(80, true) * 50 === len);
  if (!binOk && /^\s*solid/i.test(head) && /facet|endsolid/i.test(head + new TextDecoder().decode(new Uint8Array(buf, Math.max(0, len - 256))))) {
    const text = new TextDecoder().decode(buf);
    const re = /^\s*solid[ \t]*([^\r\n]*)|vertex\s+(\S+)\s+(\S+)\s+(\S+)/gim;
    const out = []; let cur = null, m;
    while ((m = re.exec(text))) {
      if (m[1] !== undefined) { cur = { name: m[1].trim() || base, arr: [] }; out.push(cur); }
      else { if (!cur) { cur = { name: base, arr: [] }; out.push(cur); } cur.arr.push(+m[2], +m[3], +m[4]); }
    }
    const res = out.filter(o => o.arr.length >= 9).map(o => ({ name: o.name, pos: new Float32Array(o.arr.slice(0, o.arr.length - o.arr.length % 9)) }));
    if (res.length === 1) res[0].name = base;
    if (res.length) return res;
  }
  // binary (also used as fallback for broken headers)
  const n = Math.floor((len - 84) / 50);
  if (n <= 0) throw new Error('empty or unreadable STL');
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return [{ name: base, pos }];
};

G.parseOBJ = function (text, fname) {
  const base = fname.replace(/\.[^.]+$/, '');
  const V = [];
  const objs = []; let cur = null;
  const useO = /^\s*o\s+/m.test(text);
  const lines = text.split(/\r?\n/);
  const start = (name) => { cur = { name: name || base, arr: [] }; objs.push(cur); };
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    while (line.endsWith('\\') && li + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++li];
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const c0 = t.charCodeAt(0), c1 = t.charCodeAt(1);
    if (c0 === 118 && (c1 === 32 || c1 === 9)) { // 'v '
      const p = t.split(/\s+/); V.push(+p[1], +p[2], +p[3]);
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) { // 'f '
      if (!cur) start(base);
      const p = t.split(/\s+/).slice(1);
      const nv = V.length / 3;
      const ids = p.map(s => { let k = parseInt(s, 10); return k < 0 ? nv + k : k - 1; }).filter(k => k >= 0 && k < nv);
      for (let j = 1; j + 1 < ids.length; j++) {
        for (const k of [ids[0], ids[j], ids[j + 1]]) cur.arr.push(V[k * 3], V[k * 3 + 1], V[k * 3 + 2]);
      }
    } else if ((useO && c0 === 111 && c1 === 32) || (!useO && c0 === 103 && c1 === 32)) {
      start(t.slice(2).trim());
    }
  }
  const res = objs.filter(o => o.arr.length >= 9).map(o => ({ name: o.name, pos: new Float32Array(o.arr) }));
  if (!res.length) throw new Error('no faces found in OBJ');
  // make names unique
  const seen = {};
  for (const r of res) { if (seen[r.name]) r.name += ' (' + (++seen[r.name]) + ')'; else seen[r.name] = 1; }
  return res;
};

/* ---------- topology ---------- */
G.buildTopo = function (src, scale) {
  scale = scale || 1;
  const nt = Math.floor(src.length / 9);
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < nt * 9; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const diag = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) || 1;
  const tol = Math.max(diag * (S.set.weldTol || 1e-6), 1e-12), inv = 1 / tol;
  const map = new Map();
  const pos = []; const raw = new Uint32Array(nt * 3);
  for (let i = 0; i < nt * 3; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(x * scale, y * scale, z * scale); }
    raw[i] = k;
  }
  // drop collapsed triangles
  let collapsed = 0; const keep = [];
  for (let f = 0; f < nt; f++) {
    const a = raw[f * 3], b = raw[f * 3 + 1], c = raw[f * 3 + 2];
    if (a === b || b === c || a === c) { collapsed++; continue; }
    keep.push(a, b, c);
  }
  return G.topoFrom(new Float32Array(pos), new Uint32Array(keep), collapsed);
};

G.topoFrom = function (pos, idx, collapsed) {
  const nv = pos.length / 3, nf = idx.length / 3;
  const fn = new Float32Array(nf * 3), fa = new Float32Array(nf);
  let area = 0, vol6 = 0, cx = 0, cy = 0, cz = 0;
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    fa[f] = l / 2; area += l / 2;
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    fn[f * 3] = nx; fn[f * 3 + 1] = ny; fn[f * 3 + 2] = nz;
    const v6 = pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    vol6 += v6;
    cx += v6 * (pos[a] + pos[b] + pos[c]); cy += v6 * (pos[a + 1] + pos[b + 1] + pos[c + 1]); cz += v6 * (pos[a + 2] + pos[b + 2] + pos[c + 2]);
  }
  // vertex -> faces (CSR)
  const cnt = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) cnt[idx[i] + 1]++;
  for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
  const vf = new Uint32Array(idx.length), fill = cnt.slice(0, nv);
  for (let f = 0; f < nf; f++) for (let c = 0; c < 3; c++) { const v = idx[f * 3 + c]; vf[fill[v]++] = f; }
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const x = pos[i * 3 + k]; if (x < bb.min[k]) bb.min[k] = x; if (x > bb.max[k]) bb.max[k] = x; }
  const volume = vol6 / 6;
  const centroid = Math.abs(vol6) > 1e-30 ? [cx / (4 * vol6), cy / (4 * vol6), cz / (4 * vol6)] : [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  return { pos, idx, nv, nf, fn, fa, vfOff: cnt, vf, area, volume, centroid, bb, collapsed: collapsed || 0, sharpCache: new Map() };
};

/* render geometry: non-indexed, creased normals; triangle i == topology face i */
G.renderGeometry = function (t, creaseDeg) {
  const cosA = Math.cos((creaseDeg || 30) * Math.PI / 180);
  const { pos, idx, nf, fn, fa, vfOff, vf } = t;
  const P = new Float32Array(nf * 9), N = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    const fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = idx[f * 3 + c], o = f * 9 + c * 3;
      P[o] = pos[v * 3]; P[o + 1] = pos[v * 3 + 1]; P[o + 2] = pos[v * 3 + 2];
      let nx = 0, ny = 0, nz = 0;
      for (let j = vfOff[v]; j < vfOff[v + 1]; j++) {
        const g = vf[j];
        const gx = fn[g * 3], gy = fn[g * 3 + 1], gz = fn[g * 3 + 2];
        if (fx * gx + fy * gy + fz * gz >= cosA) { const w = fa[g]; nx += gx * w; ny += gy * w; nz += gz * w; }
      }
      const l = Math.hypot(nx, ny, nz);
      if (l > 0) { N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l; } else { N[o] = fx; N[o + 1] = fy; N[o + 2] = fz; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
};

/* edge table (lazy) */
G.edges = function (t) {
  if (t.E) return t.E;
  const { idx, nf, nv } = t;
  const map = new Map();
  const ea = [], eb = [], f1 = [], f2 = [], cnt = [], dirOk = [];
  for (let f = 0; f < nf; f++) for (let c = 0; c < 3; c++) {
    const u = idx[f * 3 + c], w = idx[f * 3 + (c + 1) % 3];
    const a = u < w ? u : w, b = u < w ? w : u, key = a * nv + b;
    let e = map.get(key);
    if (e === undefined) { e = ea.length; map.set(key, e); ea.push(a); eb.push(b); f1.push(f); f2.push(-1); cnt.push(1); dirOk.push(u < w ? 1 : -1); }
    else { cnt[e]++; if (cnt[e] === 2) { f2[e] = f; if ((u < w ? 1 : -1) === dirOk[e]) dirOk[e] = 0; } }
  }
  t.E = { map, a: ea, b: eb, f1, f2, cnt, dir: dirOk, n: ea.length };
  return t.E;
};
G.edgeKey = (t, u, w) => (u < w ? u * t.nv + w : w * t.nv + u);
G.isSharp = function (t, e, cosA) {
  const E = G.edges(t);
  if (E.cnt[e] !== 2) return true;
  const a = E.f1[e], b = E.f2[e], fn = t.fn;
  return fn[a * 3] * fn[b * 3] + fn[a * 3 + 1] * fn[b * 3 + 1] + fn[a * 3 + 2] * fn[b * 3 + 2] < cosA;
};
/* vertex -> sharp edges, cached per angle */
G.sharpAdj = function (t, angle) {
  const key = Math.round(angle * 100);
  if (t.sharpCache.has(key)) return t.sharpCache.get(key);
  const E = G.edges(t), cosA = Math.cos(angle * Math.PI / 180), adj = new Map();
  for (let e = 0; e < E.n; e++) if (G.isSharp(t, e, cosA)) {
    for (const v of [E.a[e], E.b[e]]) { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }
  }
  t.sharpCache.set(key, adj);
  return adj;
};
/* follow a chain of sharp edges through degree-2 vertices */
G.chain = function (t, e0, angle) {
  const E = G.edges(t), adj = G.sharpAdj(t, angle);
  const a = E.a[e0], b = E.b[e0];
  const isS = (adj.get(a) || []).includes(e0);
  if (!isS) return { verts: [a, b], closed: false };
  const other = (e, v) => (E.a[e] === v ? E.b[e] : E.a[e]);
  const used = new Set([e0]);
  const verts = [a, b]; let closed = false;
  let prev = e0, v = b;
  for (let guard = 0; guard < 500000; guard++) {
    const l = adj.get(v); if (!l || l.length !== 2) break;
    const nx = l[0] === prev ? l[1] : l[0];
    if (nx === e0) { closed = true; break; }
    if (used.has(nx)) break;
    used.add(nx); const w = other(nx, v); verts.push(w); prev = nx; v = w;
  }
  if (closed && verts.length > 2 && verts[verts.length - 1] === verts[0]) verts.pop();
  if (!closed) {
    prev = e0; v = a;
    for (let guard = 0; guard < 500000; guard++) {
      const l = adj.get(v); if (!l || l.length !== 2) break;
      const nx = l[0] === prev ? l[1] : l[0];
      if (used.has(nx)) break;
      used.add(nx); const w = other(nx, v); verts.unshift(w); prev = nx; v = w;
    }
  }
  return { verts, closed };
};

/* least-squares circle through 3D points (Newell plane + Kasa fit) */
G.fitCircle = function (pts) {
  const n = pts.length; if (n < 3) return null;
  const m = new THREE.Vector3(); pts.forEach(p => m.add(p)); m.multiplyScalar(1 / n);
  const N = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    N.x += (p.y - q.y) * (p.z + q.z); N.y += (p.z - q.z) * (p.x + q.x); N.z += (p.x - q.x) * (p.y + q.y);
  }
  if (N.lengthSq() < 1e-30) return null;
  N.normalize();
  const U = new THREE.Vector3().subVectors(pts[0], m); U.addScaledVector(N, -U.dot(N));
  if (U.lengthSq() < 1e-30) return null;
  U.normalize(); const W = new THREE.Vector3().crossVectors(N, U);
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0, planar = 0;
  const xy = pts.map(p => { const d = new THREE.Vector3().subVectors(p, m); planar = Math.max(planar, Math.abs(d.dot(N))); return [d.dot(U), d.dot(W)]; });
  for (const [x, y] of xy) { const z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z; }
  // [sxx sxy sx; sxy syy sy; sx sy n] [D E F]^T = -[sxz syz sz]
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [-sxz, -syz, -sz];
  const s = G.solve3(A, B); if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let e2 = 0; for (const [x, y] of xy) { const d = Math.hypot(x - cx, y - cy) - r; e2 += d * d; }
  const c = m.clone().addScaledVector(U, cx).addScaledVector(W, cy);
  return { c, r, n: N, rms: Math.sqrt(e2 / n), planar };
};
G.solve3 = function (A, b) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const scale = Math.abs(A[0][0]) + Math.abs(A[1][1]) + Math.abs(A[2][2]) || 1;
  if (Math.abs(D) < 1e-14 * scale * scale * scale) return null;
  const r = [];
  for (let k = 0; k < 3; k++) { const M = A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v))); r.push(det(M) / D); }
  return r;
};

/* coplanar patch flood fill */
G.facePatch = function (t, f0, tolDeg) {
  const E = G.edges(t), cosT = Math.cos(tolDeg * Math.PI / 180), fn = t.fn, pos = t.pos, idx = t.idx;
  const nx = fn[f0 * 3], ny = fn[f0 * 3 + 1], nz = fn[f0 * 3 + 2];
  const a0 = idx[f0 * 3] * 3, d0 = nx * pos[a0] + ny * pos[a0 + 1] + nz * pos[a0 + 2];
  const dtol = Math.max(1e-9, Math.hypot(t.bb.max[0] - t.bb.min[0], t.bb.max[1] - t.bb.min[1], t.bb.max[2] - t.bb.min[2]) * Math.sin(tolDeg * Math.PI / 180) * 0.05 + 1e-6);
  const seen = new Uint8Array(t.nf); seen[f0] = 1;
  const out = [f0], st = [f0];
  while (st.length) {
    const f = st.pop();
    for (let c = 0; c < 3; c++) {
      const e = E.map.get(G.edgeKey(t, idx[f * 3 + c], idx[f * 3 + (c + 1) % 3]));
      if (E.cnt[e] !== 2) continue;
      const g = E.f1[e] === f ? E.f2[e] : E.f1[e];
      if (g < 0 || seen[g]) continue;
      if (fn[g * 3] * nx + fn[g * 3 + 1] * ny + fn[g * 3 + 2] * nz < cosT) continue;
      const ag = idx[g * 3] * 3;
      if (Math.abs(nx * pos[ag] + ny * pos[ag + 1] + nz * pos[ag + 2] - d0) > dtol) continue;
      seen[g] = 1; out.push(g); st.push(g);
    }
  }
  return out;
};

/* ---------- checks ---------- */
G.check = function (t) {
  const E = G.edges(t);
  let open = 0, nonMan = 0, flip = 0, zero = 0;
  const openSeg = [];
  for (let e = 0; e < E.n; e++) {
    if (E.cnt[e] === 1) { open++; if (openSeg.length < 60000) openSeg.push(E.a[e], E.b[e]); }
    else if (E.cnt[e] > 2) nonMan++;
    else if (E.dir[e] === 0) flip++;
  }
  const amax = t.area / Math.max(1, t.nf);
  for (let f = 0; f < t.nf; f++) if (t.fa[f] < amax * 1e-9) zero++;
  return { open, nonMan, flip, degenerate: zero + t.collapsed, closed: open === 0 && nonMan === 0, inverted: open === 0 && t.volume < 0, openSeg };
};

/* ---------- section: slice a topology with a plane, in world space ---------- */
/* m = Matrix4.elements (column-major), P/N/U/Vv: arrays [x,y,z]; returns [{pts:[[u,v]..], closed}] */
G.slice = function (t, m, P, N, U, Vv) {
  const { pos, idx, nv, nf } = t;
  const W = new Float64Array(nv * 3), d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    W[i * 3] = wx; W[i * 3 + 1] = wy; W[i * 3 + 2] = wz;
    let dd = (wx - P[0]) * N[0] + (wy - P[1]) * N[1] + (wz - P[2]) * N[2];
    if (dd === 0) dd = 1e-12;
    d[i] = dd;
  }
  const ptKey = new Map(), ptUV = [], segs = [];
  const getPt = (a, b) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let k = ptKey.get(key);
    if (k === undefined) {
      const s = d[a] / (d[a] - d[b]);
      const x = W[a * 3] + (W[b * 3] - W[a * 3]) * s - P[0], y = W[a * 3 + 1] + (W[b * 3 + 1] - W[a * 3 + 1]) * s - P[1], z = W[a * 3 + 2] + (W[b * 3 + 2] - W[a * 3 + 2]) * s - P[2];
      k = ptUV.length; ptKey.set(key, k);
      ptUV.push([x * U[0] + y * U[1] + z * U[2], x * Vv[0] + y * Vv[1] + z * Vv[2]]);
    }
    return k;
  };
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const sa = d[a] > 0, sb = d[b] > 0, sc = d[c] > 0;
    if (sa === sb && sb === sc) continue;
    const r = [];
    if (sa !== sb) r.push(getPt(a, b));
    if (sb !== sc) r.push(getPt(b, c));
    if (sc !== sa) r.push(getPt(c, a));
    if (r.length === 2 && r[0] !== r[1]) segs.push(r[0], r[1]);
  }
  // chain segments into polylines
  const adj = new Map();
  const nseg = segs.length / 2;
  for (let s = 0; s < nseg; s++) for (const p of [segs[s * 2], segs[s * 2 + 1]]) { let l = adj.get(p); if (!l) adj.set(p, l = []); l.push(s); }
  const used = new Uint8Array(nseg), lines = [];
  const walk = (s0, from) => {
    const out = [from]; let s = s0, p = from;
    while (s >= 0 && !used[s]) {
      used[s] = 1;
      const q = segs[s * 2] === p ? segs[s * 2 + 1] : segs[s * 2];
      out.push(q); p = q;
      const l = adj.get(p); s = -1;
      if (l) for (const x of l) if (!used[x]) { s = x; break; }
    }
    return out;
  };
  // open chains first (start at degree-1 points), then loops
  for (const [p, l] of adj) if (l.length === 1 && !used[l[0]]) { const ids = walk(l[0], p); lines.push({ pts: ids.map(i => ptUV[i]), closed: false }); }
  for (let s = 0; s < nseg; s++) if (!used[s]) {
    const ids = walk(s, segs[s * 2]);
    const closed = ids.length > 3 && ids[0] === ids[ids.length - 1];
    lines.push({ pts: ids.map(i => ptUV[i]), closed });
  }
  return lines;
};


/* ---------- base64 helpers for project files ---------- */
G.b64 = function (typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
G.unb64 = function (str, Type) {
  const s = atob(str), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Type(u8.buffer);
};
