/* ===== 3D の車両モデル（t66）：map3d.js が 3D をひらくときに読む（window.M3CAR）=====
   GLB（glTF。KHR_mesh_quantization）を自分で読んで、形式・遠さ（mid ちかく・far とおく）ごとに 1つの形にまとめる：
   ・色だけの材質は 頂点の色に（まとめて1回で描く）。絵のある材質（前面・車番・マーク）は 絵ごと。ガラスは こい色の不透明に。
     行先・種別の表示は 字なし（列車ごとに ちがうので）
   ・InstancedMesh：何両あっても、形式・遠さ・材質ごとに 1回で描く
   車両のモデルは +X が運転台、進む向きの右が +Z、上が +Y、レールの面が y = 0（1 = 1m）
   使いかた（map3d.js の m3Runs）：of(系列の名前) → モデルのキー・need(キー) → 読めていれば モデル（なければ 読みはじめて null）・
     begin(シーン)・put(モデル, 形式, 遠さ, 行列, 帯の色)・end()
   122系（t68）：near（すぐそば。中の座席まで）は 街を歩いているときだけ、そばの車両の形式だけ あとから読む。帯（line_main・line_sub）は 系統の色。
     つけたり はずしたりする部品（opt_…）は ふだんの形（冷房なし・耐雪なし・半自動なし・トイレなし）に */
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
    },
    // 瑠璃 122系（t68）：20m・4ドアの通勤形（Tc・Mp・M。T は 決まりの形の 5両だけ）。mid：この遠さ（マス）まで mid・near：歩いているとき この遠さまで near
    r122: {
      series: ['122系0番台'], dir: 'map/models/r122/', len: 20.0, bogie: 6.9, w: 2.95, h: 4.1, cars: ['Tc', 'Mp', 'M', 'T'], lv: ['mid', 'far'],
      near: ['Tc', 'Mp', 'M'], nearD: 0.7, midD: 5, line: true,
      file: (c, lv) => 'r122_' + c + '_' + lv + '.glb',
      skip: n => /^opt_(wc|snow|btn|ac)/.test(n),   // 冷房（opt_ac・opt_ac_int）・耐雪・半自動のボタン・トイレは つけない（冷房のときに はずす通風器 opt_vent_ac は のこす）
      sets: { 1: ['Mp'], 2: ['Tc', 'Tc~'], 3: ['Tc', 'M', 'Tc~'], 4: ['Tc', 'Mp', 'M', 'Tc~'], 5: ['Tc', 'Mp', 'M', 'T', 'Tc~'], 6: ['Tc', 'Mp', 'M', 'Mp', 'M', 'Tc~'],
              8: ['Tc', 'Mp', 'M', 'Mp', 'M', 'Mp', 'M', 'Tc~'], 10: ['Tc', 'Mp', 'M', 'Mp', 'M', 'Mp', 'M', 'Mp', 'M', 'Tc~'],
              15: ['Tc', 'Mp', 'M', 'Mp', 'M', 'Mp', 'M', 'Mp', 'M', 'Tc~', 'Tc', 'Mp', 'M', 'T', 'Tc~'] },
      pick: (lab, role) => { const r = String(role || ''); return /^Tc/.test(r) ? 'Tc' : /^Mp/.test(r) ? 'Mp' : /^T/.test(r) ? 'T' : 'M'; }
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
  // 材質の なかま：'vc'（頂点の色）か 'tx:絵の番号:MASK'。帯（line：系統の色にする）は 'ln1'・'ln2'。near のガラスは 'gl'（すける）
  function matKind(m, o) {
    const n = m.name || '', pb = m.pbrMetallicRoughness || {}, t = pb.baseColorTexture;
    if (/^tx_led/.test(n)) return { k: 'vc', c: [0.16, 0.11, 0.08] };   // 行先・種別の表示：字なしの くらい表示
    if (o && o.line && (n === 'line_main' || n === 'line_sub')) return { k: n === 'line_main' ? 'ln1' : 'ln2' };
    if (o && o.lv === 'near' && m.alphaMode === 'BLEND') return { k: 'gl' };
    if (t && m._img != null) return { k: 'tx:' + m._img + ':' + (m.alphaMode === 'MASK' ? 'm' : 'o'), img: m._img, mask: m.alphaMode === 'MASK' };
    const f = pb.baseColorFactor || [1, 1, 1, 1];
    if (m.alphaMode === 'BLEND') return { k: 'vc', c: [0.13, 0.17, 0.18] };   // ガラス：こい色の不透明に
    return { k: 'vc', c: [lin2s(f[0]), lin2s(f[1]), lin2s(f[2])] };
  }
  // 形を まとめる：{ k → { P, N, C|U, I } }（ノードの行列をかけて 1つの座標に）
  function bake(G, T3, op) {   // op：{ skip(ノードの名前), line, lv }
    const J = G.J, out = {}, skip = op && op.skip;
    for (const m of J.materials || []) { const t = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture; m._img = t && J.textures[t.index] ? J.textures[t.index].source : null; }
    const M = new T3.Matrix4(), NM = new T3.Matrix3(), v = new T3.Vector3();
    const walk = (ni, parent) => {
      const nd = J.nodes[ni], L = new T3.Matrix4();
      if (skip && nd.name && skip(nd.name)) return;   // つけない部品（下の部品も）
      if (nd.matrix) L.fromArray(nd.matrix);
      else L.compose(new T3.Vector3().fromArray(nd.translation || [0, 0, 0]), new T3.Quaternion().fromArray(nd.rotation || [0, 0, 0, 1]), new T3.Vector3().fromArray(nd.scale || [1, 1, 1]));
      const W = new T3.Matrix4().multiplyMatrices(parent, L);
      if (nd.mesh != null) {
        NM.getNormalMatrix(W);
        for (const pr of J.meshes[nd.mesh].primitives) {
          if (pr.mode != null && pr.mode !== 4) continue;
          const mt = J.materials[pr.material] || {}, mk = matKind(mt, op), P = acc(G, pr.attributes.POSITION), N = pr.attributes.NORMAL != null ? acc(G, pr.attributes.NORMAL) : null;
          const U = mk.img != null && pr.attributes.TEXCOORD_0 != null ? acc(G, pr.attributes.TEXCOORD_0) : null;
          const I = pr.indices != null ? acc(G, pr.indices) : null, nv = P.length / 3;
          const o = out[mk.k] || (out[mk.k] = { P: [], N: [], C: [], U: [], I: [], mk });
          const base = o.P.length / 3;
          for (let j = 0; j < nv; j++) {
            v.set(P[3 * j], P[3 * j + 1], P[3 * j + 2]).applyMatrix4(W); o.P.push(v.x, v.y, v.z);
            if (N) { v.set(N[3 * j], N[3 * j + 1], N[3 * j + 2]).applyMatrix3(NM).normalize(); o.N.push(v.x, v.y, v.z); } else o.N.push(0, 1, 0);
            if (mk.k === 'vc') o.C.push(mk.c[0], mk.c[1], mk.c[2]); else if (mk.img != null) o.U.push(U ? U[2 * j] : 0, U ? U[2 * j + 1] : 0);
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
  function groups(G, T3, op) {
    const B = bake(G, T3, op), out = [];
    for (const k in B) {
      const o = B[k], g = new T3.BufferGeometry();
      g.setAttribute('position', new T3.Float32BufferAttribute(o.P, 3));
      g.setAttribute('normal', new T3.Float32BufferAttribute(o.N, 3));
      let mat, ln = 0;
      if (o.mk.k === 'vc') { g.setAttribute('color', new T3.Float32BufferAttribute(o.C, 3)); mat = new T3.MeshLambertMaterial({ vertexColors: true }); }
      else if (o.mk.k === 'ln1' || o.mk.k === 'ln2') { mat = new T3.MeshLambertMaterial({ color: '#ffffff' }); ln = o.mk.k === 'ln1' ? 1 : 2; }   // 帯：色は 1両ごと（instanceColor）
      else if (o.mk.k === 'gl') mat = new T3.MeshLambertMaterial({ color: '#33494a', transparent: true, opacity: 0.4, depthWrite: false });   // すぐそばの ガラス：中が見える
      else { g.setAttribute('uv', new T3.Float32BufferAttribute(o.U, 2)); mat = new T3.MeshLambertMaterial({ map: tex(G, T3, o.mk.img), alphaTest: o.mk.mask ? 0.5 : 0 }); }
      mat.userData.noUg = true;   // 地下ビュー（DB の更新109）でも すかさない
      g.setIndex(o.I.length > 65535 ? new T3.Uint32BufferAttribute(o.I, 1) : new T3.Uint16BufferAttribute(o.I, 1));
      g.computeBoundingSphere();
      out.push({ g, mat, mesh: null, cap: 0, n: 0, ln });
    }
    return out;
  }
  const opOf = (md, lv) => ({ skip: md.skip, line: !!md.line, lv });
  const vq = () => (typeof MAPV !== 'undefined' ? MAPV : '');
  const fetchGlb = (md, c, lv) => fetch(md.dir + md.file(c, lv) + '?v=' + vq()).then(r => { if (!r.ok) throw new Error('GLB が読めません'); return r.arrayBuffer(); });
  function load(key) {
    const md = MODELS[key], T3 = window.THREE; if (!md || !T3) return;
    const s = ST[key] = { st: 'load', m: {}, ns: {} };
    const jobs = [];
    for (const c of md.cars) for (const lv of md.lv) {
      jobs.push(fetchGlb(md, c, lv).then(buf => { (s.m[c] || (s.m[c] = {}))[lv] = groups(glb(buf), T3, opOf(md, lv)); }));
    }
    Promise.all(jobs).then(() => { s.st = 'ok'; if (window.MP_STATE) window.MP_STATE.dirty = true; })
      .catch(e => { console.error(e); s.st = 'fail'; });
  }
  // すぐそば（near）：はじめて いるときに、その形式だけ 読む（t68。街を歩いているとき）
  function loadNear(md, c) {
    const s = ST[md.key], T3 = window.THREE; if (!s || s.st !== 'ok' || s.ns[c] || !T3) return;
    s.ns[c] = 'load';
    fetchGlb(md, c, 'near').then(buf => { if (s.m[c]) s.m[c].near = groups(glb(buf), T3, opOf(md, 'near')); s.ns[c] = 'ok'; if (window.MP_STATE) window.MP_STATE.dirty = true; })
      .catch(e => { console.warn(e); s.ns[c] = 'fail'; });
  }
  /* ---------- 描く ---------- */
  function begin(sc) { SC = sc; for (const k in ST) { const s = ST[k]; if (s.st !== 'ok') continue; for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) g.n = 0; } }
  // col：帯の色 [おもな色, 下の細い線の色]（THREE.Color。line のモデルだけ）
  function put(md, car, lv, m4, col) {
    const s = ST[md.key]; if (!s || s.st !== 'ok') return false;
    const m = s.m[car]; if (!m) return false;
    if (lv === 'near' && !m.near) { if (md.near && md.near.includes(car) && !s.ns[car]) loadNear(md, car); lv = 'mid'; }
    const L = m[lv] || m.mid || m.far; if (!L) return false;
    const T3 = window.THREE; if (!M4) { M4 = new T3.Matrix4(); C0 = new T3.Color(); C1 = new T3.Color(1, 1, 1); }
    for (const g of L) {
      if (g.n >= g.cap) {
        const cap = Math.max(16, g.cap * 2), mesh = new T3.InstancedMesh(g.g, g.mat, cap);
        mesh.instanceMatrix.setUsage(T3.DynamicDrawUsage); mesh.frustumCulled = false;
        if (g.ln) mesh.setColorAt(0, C1);   // はじめて描く前に 色の場所をつくる
        if (g.mesh) {
          for (let i = 0; i < g.n; i++) { g.mesh.getMatrixAt(i, M4); mesh.setMatrixAt(i, M4); if (g.ln) { g.mesh.getColorAt(i, C0); mesh.setColorAt(i, C0); } }
          if (g.mesh.parent) g.mesh.parent.remove(g.mesh); g.mesh.dispose && g.mesh.dispose();
        }
        g.mesh = mesh; g.cap = cap;
      }
      if (SC && g.mesh.parent !== SC) SC.add(g.mesh);
      if (g.ln) g.mesh.setColorAt(g.n, col ? col[g.ln - 1] : C1);
      g.mesh.setMatrixAt(g.n++, m4);
    }
    return true;
  }
  let M4 = null, C0 = null, C1 = null;
  function end() {
    for (const k in ST) {
      const s = ST[k]; if (s.st !== 'ok') continue;
      for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) {
        if (!g.mesh) continue;
        g.mesh.count = g.n; g.mesh.visible = g.n > 0; if (g.n) { g.mesh.instanceMatrix.needsUpdate = true; if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true; }
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
  window.M3CAR = { ver: 2, fail: false, MODELS, of: s => BY.get(s) || null, need, comp, begin, put, end, get state() { return ST; } };
})();
