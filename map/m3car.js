/* ===== 3D の車両モデル（t66）：map3d.js が 3D をひらくときに読む（window.M3CAR）=====
   GLB（glTF。KHR_mesh_quantization）を自分で読んで、形式・遠さ（mid ちかく・far とおく）ごとに 1つの形にまとめる：
   ・色だけの材質は 頂点の色に（まとめて1回で描く）。絵のある材質（前面・車番・マーク）は 絵ごと。ガラスは こい色の不透明に。
     行先・種別の表示は 字なし（列車ごとに ちがうので）
   ・InstancedMesh：何両あっても、形式・遠さ・材質ごとに 1回で描く
   車両のモデルは +X が運転台、進む向きの右が +Z、上が +Y、レールの面が y = 0（1 = 1m）
   使いかた（map3d.js の m3Runs）：of(系列の名前) → モデルのキー・need(キー) → 読めていれば モデル（なければ 読みはじめて null）・
     begin(シーン)・put(モデル, 形式, 遠さ, 行列)・end() */
(function () {
  'use strict';
  // モデル：dir（GLB のフォルダ）・len（連結面間 m）・bogie（台車の中心まで m）・sets（両数 → 編成。下り方から。~ は運転台を上り方へ）
  const MODELS = {
    r500: {
      series: ['500形'], dir: 'map/models/r500/', len: 18.0, bogie: 5.95, cars: ['Mc', 'Tc', 'Tcg'], lv: ['mid', 'far'],
      file: (c, lv) => 'r500_' + c + '_' + lv + '.glb',
      sets: { 1: ['Mc'], 2: ['Mc', 'Tc~'], 3: ['Mc', 'Tc~', 'Mc~'], 4: ['Mc', 'Tc~', 'Mc', 'Tcg~'], 5: ['Mc', 'Tc~', 'Mc', 'Tc~', 'Mc~'], 6: ['Mc', 'Tc~', 'Mc', 'Tc~', 'Mc', 'Tcg~'] },
      // 形式の記号（DB の形式の role・label）→ モデルの形式
      pick: (lab, role) => /Tcg|TcG|クロハ|グリーン/.test(lab || '') ? 'Tcg' : /^Mc|^M/.test(role || '') ? 'Mc' : 'Tc'
    }
  };
  const BY = new Map(); for (const k in MODELS) { MODELS[k].key = k; for (const s of MODELS[k].series) BY.set(s, k); }
  const ST = {};   // キー → { st: 'load'|'ok'|'fail', m: { 形式: { 遠さ: [グループ] } } }
  let SC = null;
  const lin2s = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;   // 色（glTF は linear）→ 画面の色

  /* ---------- GLB を読む ---------- */
  function glb(buf) {
    const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('GLB ではありません');
    let o = 12, J = null, B = null;
    while (o + 8 <= buf.byteLength) {
      const len = dv.getUint32(o, true), ty = dv.getUint32(o + 4, true);
      if (ty === 0x4E4F534A) J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
      else if (ty === 0x004E4942) B = new Uint8Array(buf, o + 8, len);
      o += 8 + len;
    }
    if (!J || !B) throw new Error('GLB の中身がありません');
    return { J, B };
  }
  // アクセサ → Float32Array（normalized は −1〜1・0〜1 に。KHR_mesh_quantization）
  const CT = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 0], 5126: [4, 'getFloat32', 0] };
  function acc(G, i) {
    const a = G.J.accessors[i], bv = G.J.bufferViews[a.bufferView], k = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], ct = CT[a.componentType];
    if (!bv || !k || !ct || a.sparse) throw new Error('読めないアクセサ');
    const bs = ct[0], st = bv.byteStride || k * bs, dv = new DataView(G.B.buffer, G.B.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0)), f = dv[ct[1]].bind(dv);
    const nf = a.normalized ? ct[2] : 0, sg = a.componentType === 5120 || a.componentType === 5122, out = new Float32Array(a.count * k);
    for (let j = 0; j < a.count; j++) for (let c = 0; c < k; c++) {
      let v = f(j * st + c * bs, true);
      if (nf) v = sg ? Math.max(-1, v / nf) : v / nf;
      out[j * k + c] = v;
    }
    return out;
  }
  // 材質の なかま：'vc'（頂点の色）か 'tx:絵の番号:MASK'
  function matKind(m) {
    const n = m.name || '', pb = m.pbrMetallicRoughness || {}, t = pb.baseColorTexture;
    if (/^tx_led/.test(n)) return { k: 'vc', c: [0.16, 0.11, 0.08] };   // 行先・種別の表示：字なしの くらい表示
    if (t && m._img != null) return { k: 'tx:' + m._img + ':' + (m.alphaMode === 'MASK' ? 'm' : 'o'), img: m._img, mask: m.alphaMode === 'MASK' };
    const f = pb.baseColorFactor || [1, 1, 1, 1];
    if (m.alphaMode === 'BLEND') return { k: 'vc', c: [0.13, 0.17, 0.18] };   // ガラス：こい色の不透明に
    return { k: 'vc', c: [lin2s(f[0]), lin2s(f[1]), lin2s(f[2])] };
  }
  // 形を まとめる：{ k → { P, N, C|U, I } }（ノードの行列をかけて 1つの座標に）
  function bake(G, T3) {
    const J = G.J, out = {};
    for (const m of J.materials || []) { const t = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture; m._img = t && J.textures[t.index] ? J.textures[t.index].source : null; }
    const M = new T3.Matrix4(), NM = new T3.Matrix3(), v = new T3.Vector3();
    const walk = (ni, parent) => {
      const nd = J.nodes[ni], L = new T3.Matrix4();
      if (nd.matrix) L.fromArray(nd.matrix);
      else L.compose(new T3.Vector3().fromArray(nd.translation || [0, 0, 0]), new T3.Quaternion().fromArray(nd.rotation || [0, 0, 0, 1]), new T3.Vector3().fromArray(nd.scale || [1, 1, 1]));
      const W = new T3.Matrix4().multiplyMatrices(parent, L);
      if (nd.mesh != null) {
        NM.getNormalMatrix(W);
        for (const pr of J.meshes[nd.mesh].primitives) {
          if (pr.mode != null && pr.mode !== 4) continue;
          const mt = J.materials[pr.material] || {}, mk = matKind(mt), P = acc(G, pr.attributes.POSITION), N = pr.attributes.NORMAL != null ? acc(G, pr.attributes.NORMAL) : null;
          const U = mk.k !== 'vc' && pr.attributes.TEXCOORD_0 != null ? acc(G, pr.attributes.TEXCOORD_0) : null;
          const I = pr.indices != null ? acc(G, pr.indices) : null, nv = P.length / 3;
          const o = out[mk.k] || (out[mk.k] = { P: [], N: [], C: [], U: [], I: [], mk });
          const base = o.P.length / 3;
          for (let j = 0; j < nv; j++) {
            v.set(P[3 * j], P[3 * j + 1], P[3 * j + 2]).applyMatrix4(W); o.P.push(v.x, v.y, v.z);
            if (N) { v.set(N[3 * j], N[3 * j + 1], N[3 * j + 2]).applyMatrix3(NM).normalize(); o.N.push(v.x, v.y, v.z); } else o.N.push(0, 1, 0);
            if (mk.k === 'vc') o.C.push(mk.c[0], mk.c[1], mk.c[2]); else o.U.push(U ? U[2 * j] : 0, U ? U[2 * j + 1] : 0);
          }
          if (I) for (let j = 0; j < I.length; j++) o.I.push(base + I[j]); else for (let j = 0; j < nv; j++) o.I.push(base + j);
          // 左右が反転する行列（はさみかたが逆）なら 三角の向きを もどす
          if (W.determinant() < 0) for (let j = o.I.length - (I ? I.length : nv); j + 2 < o.I.length; j += 3) { const t = o.I[j + 1]; o.I[j + 1] = o.I[j + 2]; o.I[j + 2] = t; }
        }
      }
      for (const c of nd.children || []) walk(c, W);
    };
    const sc = J.scenes ? J.scenes[J.scene || 0] : null;
    for (const ni of sc ? sc.nodes : J.nodes.map((_, i) => i)) walk(ni, new T3.Matrix4());
    return out;
  }
  // 絵（GLB の中の PNG・JPEG）→ テクスチャ
  function tex(G, T3, img) {
    const im = G.J.images[img], bv = G.J.bufferViews[im.bufferView];
    const blob = new Blob([new Uint8Array(G.B.buffer, G.B.byteOffset + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType || 'image/png' });
    const t = new T3.Texture(); t.flipY = false; t.anisotropy = 4;
    const u = URL.createObjectURL(blob), el = new Image();
    el.onload = () => { t.image = el; t.needsUpdate = true; URL.revokeObjectURL(u); };
    el.src = u;
    return t;
  }
  // 1つの GLB → [{ mesh（InstancedMesh）, n }]（材質のなかまごと）
  function groups(G, T3) {
    const B = bake(G, T3), out = [];
    for (const k in B) {
      const o = B[k], g = new T3.BufferGeometry();
      g.setAttribute('position', new T3.Float32BufferAttribute(o.P, 3));
      g.setAttribute('normal', new T3.Float32BufferAttribute(o.N, 3));
      let mat;
      if (o.mk.k === 'vc') { g.setAttribute('color', new T3.Float32BufferAttribute(o.C, 3)); mat = new T3.MeshLambertMaterial({ vertexColors: true }); }
      else { g.setAttribute('uv', new T3.Float32BufferAttribute(o.U, 2)); mat = new T3.MeshLambertMaterial({ map: tex(G, T3, o.mk.img), alphaTest: o.mk.mask ? 0.5 : 0 }); }
      g.setIndex(o.I.length > 65535 ? new T3.Uint32BufferAttribute(o.I, 1) : new T3.Uint16BufferAttribute(o.I, 1));
      g.computeBoundingSphere();
      out.push({ g, mat, mesh: null, cap: 0, n: 0 });
    }
    return out;
  }
  function load(key) {
    const md = MODELS[key], T3 = window.THREE; if (!md || !T3) return;
    const s = ST[key] = { st: 'load', m: {} }, v = typeof MAPV !== 'undefined' ? MAPV : '';
    const jobs = [];
    for (const c of md.cars) for (const lv of md.lv) {
      jobs.push(fetch(md.dir + md.file(c, lv) + '?v=' + v).then(r => { if (!r.ok) throw new Error('GLB が読めません'); return r.arrayBuffer(); })
        .then(buf => { (s.m[c] || (s.m[c] = {}))[lv] = groups(glb(buf), T3); }));
    }
    Promise.all(jobs).then(() => { s.st = 'ok'; if (window.MP_STATE) window.MP_STATE.dirty = true; })
      .catch(e => { console.error(e); s.st = 'fail'; });
  }
  /* ---------- 描く ---------- */
  function begin(sc) { SC = sc; for (const k in ST) { const s = ST[k]; if (s.st !== 'ok') continue; for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) g.n = 0; } }
  function put(md, car, lv, m4) {
    const s = ST[md.key]; if (!s || s.st !== 'ok') return false;
    const L = s.m[car] && (s.m[car][lv] || s.m[car].mid || s.m[car].far); if (!L) return false;
    const T3 = window.THREE; if (!M4) M4 = new T3.Matrix4();
    for (const g of L) {
      if (g.n >= g.cap) {
        const cap = Math.max(16, g.cap * 2), mesh = new T3.InstancedMesh(g.g, g.mat, cap);
        mesh.instanceMatrix.setUsage(T3.DynamicDrawUsage); mesh.frustumCulled = false;
        if (g.mesh) { for (let i = 0; i < g.n; i++) { g.mesh.getMatrixAt(i, M4); mesh.setMatrixAt(i, M4); } if (g.mesh.parent) g.mesh.parent.remove(g.mesh); g.mesh.dispose && g.mesh.dispose(); }
        g.mesh = mesh; g.cap = cap;
      }
      if (SC && g.mesh.parent !== SC) SC.add(g.mesh);
      g.mesh.setMatrixAt(g.n++, m4);
    }
    return true;
  }
  let M4 = null;
  function end() {
    for (const k in ST) {
      const s = ST[k]; if (s.st !== 'ok') continue;
      for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) {
        if (!g.mesh) continue;
        g.mesh.count = g.n; g.mesh.visible = g.n > 0; if (g.n) g.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  // 系列の名前 → モデル（読めていなければ 読みはじめて null）
  function need(series) {
    const key = BY.get(series); if (!key) return null;
    const s = ST[key];
    if (!s) { load(key); return null; }
    return s.st === 'ok' ? MODELS[key] : null;
  }
  // 編成：[{ c: 形式, r: 運転台が上り方か }]（下り方から）。fm（DB の更新107：[[形式, 役割, 向き（奇数向き・偶数向き）]…]）があれば それ、なければ 両数の決まりの形
  function comp(md, fn, fm) {
    if (Array.isArray(fm) && fm.length) return fm.map(x => ({ c: md.pick(x[0], x[1]), r: String(x[2] || '').startsWith('偶') }));
    const L = md.sets[fn] || (fn > 6 ? [].concat(...Array(Math.ceil(fn / 2)).fill(md.sets[2])).slice(0, fn) : md.sets[2]);
    return L.map(x => ({ c: x.replace('~', ''), r: x.endsWith('~') }));
  }
  window.M3CAR = { ver: 1, fail: false, MODELS, of: s => BY.get(s) || null, need, comp, begin, put, end, get state() { return ST; } };
})();
