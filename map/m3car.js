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
    { const lm = /^tx_led_(front|side|type|run)$/.exec(n); if (lm) return { k: 'led:' + lm[1], led: lm[1], uv: true }; }   // 行先・種別・番号の 表示器（列車ごとの 絵。t70）
    if (/^tx_led/.test(n)) return { k: 'vc', c: [0.16, 0.11, 0.08] };
    // 明かり（t70）：前照灯・尾灯（つく・つかないは 1両ごと）・車内の 照明のカバー（いつも つく）
    if (n === 'lamp_head_high' || n === 'lamp_head_low') return { k: 'lh' };
    if (n === 'lamp_tail' || n === 'taillight_small') return { k: 'lt' };
    if (n === 'light_cover') return { k: 'li' };
    if (n === 'int_ceiling') { const f = (m.pbrMetallicRoughness || {}).baseColorFactor || [1, 1, 1]; return { k: 'cb', c: [lin2s(f[0]) * 0.86, lin2s(f[1]) * 0.86, lin2s(f[2]) * 0.86] }; }   // 車内の 天井：照明で 明るい（光を 計算しない）
    if (o && o.line && (n === 'line_main' || n === 'line_sub')) return { k: n === 'line_main' ? 'ln1' : 'ln2' };
    if (o && o.lv === 'near' && m.alphaMode === 'BLEND') return { k: 'gl' };
    if (t && m._img != null) return { k: 'tx:' + m._img + ':' + (m.alphaMode === 'MASK' ? 'm' : 'o'), img: m._img, mask: m.alphaMode === 'MASK' };
    const f = pb.baseColorFactor || [1, 1, 1, 1];
    if (m.alphaMode === 'BLEND' || n === 'far_window') return { k: 'gw', c: [0.13, 0.17, 0.18] };   // ガラス：こい色の不透明に（夜は 中の 蛍光灯で 明るい。t70）
    if (/^(int_wall|int_floor|floor_|seat_|stainless_pipe|strap_|rack_mesh|curtain|fan_|cab_wall|wc_)/.test(n)) return { k: 'vi', c: [lin2s(f[0]), lin2s(f[1]), lin2s(f[2])] };   // 車内：蛍光灯で やわらかく 明るい
    return { k: 'vc', c: [lin2s(f[0]), lin2s(f[1]), lin2s(f[2])] };
  }
  // 形を まとめる：{ k → { P, N, C|U, I } }（ノードの行列をかけて 1つの座標に）
  function bake(G, T3, op) {   // op：{ skip(ノードの名前), line, lv }
    const J = G.J, out = {}, skip = op && op.skip;
    for (const m of J.materials || []) { const t = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture; m._img = t && J.textures[t.index] ? J.textures[t.index].source : null; }
    const M = new T3.Matrix4(), NM = new T3.Matrix3(), v = new T3.Vector3(), DC = {}, GW = {};   // DC：ドア → x の合計・数・GW：貫通扉のある はし（t70）
    const walk = (ni, parent, part) => {
      const nd = J.nodes[ni], L = new T3.Matrix4();
      if (skip && nd.name && skip(nd.name)) return;   // つけない部品（下の部品も）
      const dm = nd.name && /^door_([LR])(\d)([fr])$/.exec(nd.name); if (dm) part = { k: 'd' + dm[1] + dm[3], n: dm[1] + dm[2] + dm[3] };   // ドア（ひらく。t70）
      const gm = nd.name && /^gw_door_([FR])$/.exec(nd.name); if (gm) { part = { k: 'g' + gm[1], n: null }; GW[gm[1]] = true; }   // 貫通扉（F：+x の はし・R：−x の はし。t70）
      if (nd.matrix) L.fromArray(nd.matrix);
      else L.compose(new T3.Vector3().fromArray(nd.translation || [0, 0, 0]), new T3.Quaternion().fromArray(nd.rotation || [0, 0, 0, 1]), new T3.Vector3().fromArray(nd.scale || [1, 1, 1]));
      const W = new T3.Matrix4().multiplyMatrices(parent, L);
      if (nd.mesh != null) {
        NM.getNormalMatrix(W);
        for (const pr of J.meshes[nd.mesh].primitives) {
          if (pr.mode != null && pr.mode !== 4) continue;
          const mt = J.materials[pr.material] || {}, mk = matKind(mt, op), P = acc(G, pr.attributes.POSITION), N = pr.attributes.NORMAL != null ? acc(G, pr.attributes.NORMAL) : null;
          const U = (mk.img != null || mk.uv) && pr.attributes.TEXCOORD_0 != null ? acc(G, pr.attributes.TEXCOORD_0) : null;
          const I = pr.indices != null ? acc(G, pr.indices) : null, nv = P.length / 3;
          const ok = (part ? part.k + '|' : '') + mk.k, o = out[ok] || (out[ok] = { P: [], N: [], C: [], U: [], I: [], mk, part: part ? part.k : null });
          const base = o.P.length / 3, dc = part && part.n ? (DC[part.n] || (DC[part.n] = [0, 0])) : null;
          for (let j = 0; j < nv; j++) {
            v.set(P[3 * j], P[3 * j + 1], P[3 * j + 2]).applyMatrix4(W); o.P.push(v.x, v.y, v.z); if (dc) { dc[0] += v.x; dc[1]++; }
            if (N) { v.set(N[3 * j], N[3 * j + 1], N[3 * j + 2]).applyMatrix3(NM).normalize(); o.N.push(v.x, v.y, v.z); } else o.N.push(0, 1, 0);
            if (mk.c) o.C.push(mk.c[0], mk.c[1], mk.c[2]); else if (mk.img != null || mk.uv) o.U.push(U ? U[2 * j] : 0, U ? U[2 * j + 1] : 0);
          }
          if (I) for (let j = 0; j < I.length; j++) o.I.push(base + I[j]); else for (let j = 0; j < nv; j++) o.I.push(base + j);
          // 左右が反転する行列（はさみかたが逆）なら 三角の向きを もどす
          if (W.determinant() < 0) for (let j = o.I.length - (I ? I.length : nv); j + 2 < o.I.length; j += 3) { const t = o.I[j + 1]; o.I[j + 1] = o.I[j + 2]; o.I[j + 2] = t; }
        }
      }
      for (const c of nd.children || []) walk(c, W, part);
    };
    const sc = J.scenes ? J.scenes[J.scene || 0] : null;
    for (const ni of sc ? sc.nodes : J.nodes.map((_, i) => i)) walk(ni, new T3.Matrix4(), null);
    // ドア：f（前の扉）と r（うしろの扉）の まん中の x → ひらく向き（f が +x がわなら +x へ）・ドアの位置（t70）
    const dx = {}, doors = { L: [], R: [] };
    for (const n in DC) { if (!n.endsWith('f')) continue; const r = DC[n.slice(0, -1) + 'r'], f = DC[n]; if (!r || !f[1] || !r[1]) continue;
      const xf = f[0] / f[1], xr = r[0] / r[1], sd = n[0]; dx['d' + sd + 'f'] = (dx['d' + sd + 'f'] || 0) + Math.sign(xf - xr); dx['d' + sd + 'r'] = (dx['d' + sd + 'r'] || 0) + Math.sign(xr - xf); doors[sd].push((xf + xr) / 2); }
    for (const k in out) if (out[k].part) out[k].dx = Math.sign(dx[out[k].part] || 0) || 1;
    out._doors = { L: doors.L.sort((a, b) => a - b), R: doors.R.sort((a, b) => a - b), gw: { F: !!GW.F, R: !!GW.R } };
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
    out.doors = B._doors; delete B._doors;
    for (const k in B) {
      const o = B[k], g = new T3.BufferGeometry();
      g.setAttribute('position', new T3.Float32BufferAttribute(o.P, 3));
      g.setAttribute('normal', new T3.Float32BufferAttribute(o.N, 3));
      let mat, ln = 0;
      let lamp = 0, cen = null;
      if (o.mk.k === 'vc') { g.setAttribute('color', new T3.Float32BufferAttribute(o.C, 3)); mat = new T3.MeshLambertMaterial({ vertexColors: true }); }
      else if (o.mk.k === 'vi' || o.mk.k === 'gw') {   // 車内・ガラス：蛍光灯の 明かり（夜ほど 目立つ）
        g.setAttribute('color', new T3.Float32BufferAttribute(o.C, 3));
        mat = new T3.MeshLambertMaterial({ vertexColors: true, emissive: o.mk.k === 'gw' ? '#dfeaf6' : '#ffffff', emissiveIntensity: 0 });
        if (o.mk.k === 'vi') {   // 車内：もとの色のまま 明るく（光の色 × 面の色）
          mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor;'); };
          mat.customProgramCacheKey = () => 'm3car-vi';
        }
        mat.userData.nt = o.mk.k === 'gw' ? 0.5 : 0.42; mat.userData.n0 = o.mk.k === 'gw' ? 0 : 0.14; NIGHT.add(mat); mat.emissiveIntensity = mat.userData.n0 + mat.userData.nt * NW;
      }
      else if (o.mk.k === 'lh' || o.mk.k === 'lt') {   // 前照灯・尾灯：1両ごとの色（instanceColor）で つける・けす
        mat = new T3.MeshBasicMaterial({ color: '#ffffff' }); lamp = o.mk.k === 'lh' ? 1 : 2;
        {   // 左右の 灯の まん中（光の 輪を 置く）
          const S = [[0, 0, 0, 0], [0, 0, 0, 0]], n = o.P.length / 3;
          for (let j = 0; j < n; j++) { const q = S[o.P[3 * j + 2] < 0 ? 0 : 1]; q[0] += o.P[3 * j]; q[1] += o.P[3 * j + 1]; q[2] += o.P[3 * j + 2]; q[3]++; }
          cen = S.filter(q => q[3]).map(q => [q[0] / q[3], q[1] / q[3], q[2] / q[3]]);
        }
      }
      else if (o.mk.k === 'li') mat = new T3.MeshBasicMaterial({ color: '#f4f9ff' });   // 蛍光灯
      else if (o.mk.led) { g.setAttribute('uv', new T3.Float32BufferAttribute(o.U, 2)); mat = ledMat(T3, o.mk.led); }   // 表示器（列車ごとの 行の 絵）
      else if (o.mk.k === 'cb') { g.setAttribute('color', new T3.Float32BufferAttribute(o.C, 3)); mat = new T3.MeshBasicMaterial({ vertexColors: true }); }   // 車内の 照明（いつも つく）
      else if (o.mk.k === 'ln1' || o.mk.k === 'ln2') { mat = new T3.MeshLambertMaterial({ color: '#ffffff' }); ln = o.mk.k === 'ln1' ? 1 : 2; }   // 帯：色は 1両ごと（instanceColor）
      else if (o.mk.k === 'gl') { mat = new T3.MeshLambertMaterial({ color: '#33494a', transparent: true, opacity: 0.4, depthWrite: false, emissive: '#dfeaf6', emissiveIntensity: 0 }); mat.userData.nt = 0.06; NIGHT.add(mat); mat.emissiveIntensity = 0.06 * NW; }   // すぐそばの ガラス：中が見える
      else { g.setAttribute('uv', new T3.Float32BufferAttribute(o.U, 2)); mat = new T3.MeshLambertMaterial({ map: tex(G, T3, o.mk.img), alphaTest: o.mk.mask ? 0.5 : 0 }); }
      mat.userData.noUg = true;   // 地下ビュー（DB の更新109）でも すかさない
      g.setIndex(o.I.length > 65535 ? new T3.Uint32BufferAttribute(o.I, 1) : new T3.Uint16BufferAttribute(o.I, 1));
      g.computeBoundingSphere();
      out.push({ g, mat, mesh: null, cap: 0, n: 0, ln, lamp, cen, part: o.part, dx: o.dx || 0, led: o.mk.led || null });
    }
    { const lh = out.find(q => q.lamp === 1 && q.cen && q.cen.length); if (lh && out.doors) out.doors.cab = { end: lh.cen[0][0] > 0 ? 'F' : 'R', x: Math.abs(lh.cen[0][0]) }; }   // 運転台の はし（乗る人は 仕切りの 手前まで。t70）
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
  function begin(sc) { SC = sc; GL.n = 0; GL.s = 0; PL.n = 0; LED.fr++; for (const k in ST) { const s = ST[k]; if (s.st !== 'ok') continue; for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) g.n = 0; } }
  // col：帯の色 [おもな色, 下の細い線の色]（THREE.Color。line のモデルだけ）
  // X（t70）：{ oL, oR（左・右の ドアの あき 0〜1。車両の +Z が右）, gF・gR（貫通扉の あき）, hd（前照灯）, tl（尾灯）, pL・pR（ホームのある がわ） }
  const DOOR_W = 0.63;   // 扉の 1枚が うごく長さ（m）
  function put(md, car, lv, m4, col, X) {
    const s = ST[md.key]; if (!s || s.st !== 'ok') return false;
    const m = s.m[car]; if (!m) return false;
    if (lv === 'near' && !m.near) { if (md.near && md.near.includes(car) && !s.ns[car]) loadNear(md, car); lv = 'mid'; }
    const L = m[lv] || m.mid || m.far; if (!L) return false;
    const T3 = window.THREE; if (!M4) { M4 = new T3.Matrix4(); C0 = new T3.Color(); C1 = new T3.Color(1, 1, 1); MT = new T3.Matrix4(); V3 = new T3.Vector3();
      CH1 = new T3.Color(1, 0.97, 0.86); CH0 = new T3.Color(0.34, 0.34, 0.32); CT1 = new T3.Color(1, 0.1, 0.05); CT0 = new T3.Color(0.3, 0.06, 0.05); }
    for (const g of L) {
      if (g.n >= g.cap) {
        const cap = Math.max(16, g.cap * 2), mesh = new T3.InstancedMesh(g.g, g.mat, cap);
        mesh.instanceMatrix.setUsage(T3.DynamicDrawUsage); mesh.frustumCulled = false;
        if (g.ln || g.lamp) mesh.setColorAt(0, C1);   // はじめて描く前に 色の場所をつくる
        if (g.led) {   // 表示器：1両ごとの 行（aSlot）
          const a = new T3.InstancedBufferAttribute(new Float32Array(cap), 1), o = g.g.getAttribute('aSlot'); if (o) for (let i = 0; i < g.n; i++) a.setX(i, o.getX(i));
          a.setUsage(T3.DynamicDrawUsage); g.g.setAttribute('aSlot', a);
        }
        if (g.mesh) {
          for (let i = 0; i < g.n; i++) { g.mesh.getMatrixAt(i, M4); mesh.setMatrixAt(i, M4); if (g.ln || g.lamp) { g.mesh.getColorAt(i, C0); mesh.setColorAt(i, C0); } }
          if (g.mesh.parent) g.mesh.parent.remove(g.mesh); g.mesh.dispose && g.mesh.dispose();
        }
        g.mesh = mesh; g.cap = cap;
      }
      if (SC && g.mesh.parent !== SC) SC.add(g.mesh);
      if (g.ln) g.mesh.setColorAt(g.n, col ? col[g.ln - 1] : C1);
      if (g.led) g.g.getAttribute('aSlot').setX(g.n, X && X.led ? ledSlot(X.led) : 0);
      if (g.lamp) { const on = X && (g.lamp === 1 ? X.hd : X.tl); g.mesh.setColorAt(g.n, g.lamp === 1 ? (on ? CH1 : CH0) : (on ? CT1 : CT0));
        if (on && g.lamp === 1 && g.cen) for (const c of g.cen) glowAdd(m4, c[0] + 0.08, c[1], c[2], 1);
        if (on && g.lamp === 2 && g.cen) for (const c of g.cen) glowAdd(m4, c[0] + 0.06, c[1], c[2], 2);
        if (on && g.lamp === 1 && g.cen && g.cen.length && lv !== 'far') beam(m4, g.cen[0][0]); }
      const gwd = g.part && g.part[0] === 'g', op = g.part && X ? (gwd ? (g.part[1] === 'F' ? X.gF : X.gR) : g.part[1] === 'L' ? X.oL : X.oR) || 0 : 0;
      if (op > 0) { if (gwd) MT.makeTranslation(0, 0, 0.8 * op); else MT.makeTranslation(g.dx * DOOR_W * op, 0, 0); M4.multiplyMatrices(m4, MT); g.mesh.setMatrixAt(g.n++, M4); }   // 貫通扉は 横（+z）へ
      else g.mesh.setMatrixAt(g.n++, m4);
    }
    if (X && NW > 0.03 && lv !== 'far') sidePools(m4, md, X);   // 窓から もれる 蛍光灯の光（夜）
    return true;
  }
  /* ---------- 行先表示器（t70）：種別・行先・列車番号を 列車ごとに 絵にして、表示器の 形に はる（行の 番号 aSlot を 1両ごとに）。
     4つの 絵（前：種別＋行先・横：種別＋行先・種別・番号）を それぞれ 64行の 絵に まとめる。0行目は なにも出さない ---------- */
  const LS = 64, LK = { front: [320, 52], side: [320, 36], type: [128, 32], run: [128, 32] };
  const LED = { map: new Map(), slot: new Array(LS).fill(null), fr: 0, cv: {}, tx: {} };
  const KCOL = k => /特急|ライナー/.test(k) ? '#ff4d3d' : /急行/.test(k) ? '#ff6a3d' : /快速/.test(k) ? '#ff9a1f' : /準急|区間/.test(k) ? '#3ddc84' : /回送|試運転/.test(k) ? '#bfbfbf' : '#e9f1ff';
  function ledCanvas(kind) {
    if (LED.cv[kind]) return LED.cv[kind];
    const [w, h] = LK[kind], cv = document.createElement('canvas'); cv.width = w; cv.height = h * LS;
    const g = cv.getContext('2d'); g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, w, h * LS);
    return (LED.cv[kind] = cv);
  }
  function ledMat(T3, kind) {
    const cv = ledCanvas(kind), tx = LED.tx[kind] || (LED.tx[kind] = new T3.CanvasTexture(cv));
    tx.flipY = false; tx.anisotropy = 4; tx.minFilter = T3.LinearFilter; tx.generateMipmaps = false;
    const m = new T3.MeshBasicMaterial({ map: tx });
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aSlot;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vUv.y = (vUv.y + aSlot) / ' + LS.toFixed(1) + ';');
    };
    m.customProgramCacheKey = () => 'm3car-led';
    return m;
  }
  const fitText = (g, t, x, y, w, px, wt) => { let s = px; g.font = `${wt || 700} ${s}px system-ui, sans-serif`; while (s > 8 && g.measureText(t).width > w) { s -= 1; g.font = `${wt || 700} ${s}px system-ui, sans-serif`; } g.fillText(t, x, y); };
  function ledDraw(s, L) {
    const kd = L.kind === '普通' ? '各停' : L.kind || '各停', dest = L.dest || '', kc = KCOL(kd);
    for (const kind in LK) {
      const cv = ledCanvas(kind), g = cv.getContext('2d'), [w, h] = LK[kind], y0 = s * h;
      g.fillStyle = '#0b0c0d'; g.fillRect(0, y0, w, h); g.textBaseline = 'middle'; g.textAlign = 'center';
      if (kind === 'type') { g.fillStyle = kc; fitText(g, kd, w / 2, y0 + h / 2 + 1, w - 10, h - 8); }
      else if (kind === 'run') { g.fillStyle = '#ffb02e'; fitText(g, String(L.num || ''), w / 2, y0 + h / 2 + 1, w - 10, h - 8); }
      else {   // 前・横：左に 種別（色の わく）・右に 行先
        const kw = Math.round(w * 0.32);
        g.fillStyle = kc; g.fillRect(3, y0 + 3, kw - 6, h - 6); g.fillStyle = '#0b0c0d'; fitText(g, kd, kw / 2, y0 + h / 2 + 1, kw - 12, h - 12);
        g.fillStyle = '#f2f5f7'; fitText(g, dest ? dest + (kind === 'side' ? ' 行' : '') : '', kw + (w - kw) / 2, y0 + h / 2 + 1, w - kw - 10, h - 10, 600);
      }
      if (LED.tx[kind]) LED.tx[kind].needsUpdate = true;
    }
  }
  // 列車（key）の 行：つかっている 行は そのまま（中身が かわれば かきなおす）。なければ しばらく つかっていない 行を
  function ledSlot(L) {
    let e = LED.map.get(L.key); const sig = (L.kind || '') + '|' + (L.dest || '') + '|' + (L.num || '');
    if (!e) {
      let best = -1, bu = Infinity;
      for (let i = 1; i < LS; i++) { const o = LED.slot[i]; if (!o) { best = i; break; } if (o.used < bu && o.used < LED.fr - 1) { bu = o.used; best = i; } }
      if (best < 0) return 0;   // いっぱい：なにも出さない
      const o = LED.slot[best]; if (o) LED.map.delete(o.key);
      e = { key: L.key, s: best, sig: '', used: LED.fr }; LED.slot[best] = e; LED.map.set(L.key, e);
    }
    e.used = LED.fr;
    if (e.sig !== sig) { e.sig = sig; ledDraw(e.s, L); }
    return e.s;
  }
  /* ---------- 夜の 光（t70）：前照灯・尾灯の 光の輪（GL）・地面や ホームを やわらかく照らす 光（PL：足していく 色の 四角） ---------- */
  function glowAdd(m4, x, y, z, k) {
    if (GL.n >= GL.max) return;
    V3.set(x, y, z).applyMatrix4(m4); const i = GL.n++;
    GL.p[3 * i] = V3.x; GL.p[3 * i + 1] = V3.y; GL.p[3 * i + 2] = V3.z;
    const c = k === 1 ? [1, 0.96, 0.86] : [1, 0.16, 0.08], a = k === 1 ? 0.35 + 0.65 * NW : 0.25 + 0.6 * NW;
    GL.c[3 * i] = c[0] * a; GL.c[3 * i + 1] = c[1] * a; GL.c[3 * i + 2] = c[2] * a;
    GL.s = Math.max(GL.s, m4.getMaxScaleOnAxis());
  }
  const PL = { max: 1500, n: 0, p: new Float32Array(1500 * 12), c: new Float32Array(1500 * 12), mesh: null };
  const PV = [0, 0, 0, 0];
  function plQuad(m4, A, B, C, D, ca, cb, cc, cd) {   // 車両の 座標（m）の 四角 → 地図。色は 4すみ
    if (PL.n >= PL.max) return;
    const o = PL.n * 12;
    [A, B, C, D].forEach((q, j) => { V3.set(q[0], q[1], q[2]).applyMatrix4(m4); PL.p[o + 3 * j] = V3.x; PL.p[o + 3 * j + 1] = V3.y; PL.p[o + 3 * j + 2] = V3.z; });
    [ca, cb, cc, cd].forEach((c, j) => { PL.c[o + 3 * j] = c[0]; PL.c[o + 3 * j + 1] = c[1]; PL.c[o + 3 * j + 2] = c[2]; });
    PL.n++;
  }
  const K0 = [0, 0, 0];
  // 窓から もれる光：車両の 両がわ（ホームのある がわは ホームの上・ないがわは 線路わきの 地面）
  function sidePools(m4, md, X) {
    const Lh = md.len / 2, hw = (md.w || 2.95) / 2, k = 0.3 * NW, col = [0.78 * k, 0.86 * k, 0.95 * k];
    const xs = [-Lh - 0.8, -Lh + 1.6, Lh - 1.6, Lh + 0.8], ks = [0, 1, 1, 0];
    for (const sd of [1, -1]) {
      const pf = sd > 0 ? X.pR : X.pL, y = pf ? 1.115 : -0.1, z0 = sd * (hw + 0.03), z1 = sd * (hw + (pf ? 3.4 : 2.6)), m = pf ? 1.15 : 0.8;
      for (let i = 0; i < 3; i++) {
        const a = ks[i] * m, b = ks[i + 1] * m;
        plQuad(m4, [xs[i], y, z0], [xs[i + 1], y, z0], [xs[i + 1], y, z1], [xs[i], y, z1], [col[0] * a, col[1] * a, col[2] * a], [col[0] * b, col[1] * b, col[2] * b], K0, K0);
      }
    }
  }
  // 前照灯：前の 線路を やわらかく照らす（30m・先へ ひろがって うすく）
  function beam(m4, x0) {
    const k = 0.62 * NW; if (k < 0.02) return;
    const D = [0.4, 2.5, 8, 18, 32], I = [0.3, 1, 0.6, 0.24, 0], Wd = [0.9, 1.5, 2.4, 3.2, 3.8], y = -0.1;
    for (let i = 0; i + 1 < D.length; i++) {
      const a = I[i] * k, b = I[i + 1] * k, ca = [a, a * 0.95, a * 0.84], cb = [b, b * 0.95, b * 0.84];
      plQuad(m4, [x0 + D[i], y, -Wd[i]], [x0 + D[i + 1], y, -Wd[i + 1]], [x0 + D[i + 1], y, 0], [x0 + D[i], y, 0], [0, 0, 0], [0, 0, 0], cb, ca);
      plQuad(m4, [x0 + D[i], y, 0], [x0 + D[i + 1], y, 0], [x0 + D[i + 1], y, Wd[i + 1]], [x0 + D[i], y, Wd[i]], ca, cb, [0, 0, 0], [0, 0, 0]);
    }
  }
  function poolEnd() {
    const T3 = window.THREE; if (!T3 || !SC) return;
    if (!PL.mesh) {
      const ge = new T3.BufferGeometry(); ge.setAttribute('position', new T3.BufferAttribute(PL.p, 3).setUsage(T3.DynamicDrawUsage)); ge.setAttribute('color', new T3.BufferAttribute(PL.c, 3).setUsage(T3.DynamicDrawUsage));
      const ix = new Uint32Array(PL.max * 6); for (let q = 0; q < PL.max; q++) { const v = q * 4, o = q * 6; ix[o] = v; ix[o + 1] = v + 1; ix[o + 2] = v + 2; ix[o + 3] = v; ix[o + 4] = v + 2; ix[o + 5] = v + 3; }
      ge.setIndex(new T3.BufferAttribute(ix, 1));
      PL.mesh = new T3.Mesh(ge, new T3.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T3.AdditiveBlending, side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      PL.mesh.frustumCulled = false; PL.mesh.renderOrder = 2; PL.mesh.material.userData.noUg = true;
    }
    if (PL.mesh.parent !== SC) SC.add(PL.mesh);
    PL.mesh.geometry.setDrawRange(0, PL.n * 6); PL.mesh.geometry.attributes.position.needsUpdate = true; PL.mesh.geometry.attributes.color.needsUpdate = true;
    PL.mesh.visible = PL.n > 0;
  }
  let M4 = null, C0 = null, C1 = null, MT = null, V3 = null, CH1, CH0, CT1, CT0;
  const NIGHT = new Set(); let NW = 0;   // 夜の度合い（map3d の m3Sun → night）
  function night(w) { NW = w; for (const m of NIGHT) m.emissiveIntensity = (m.userData.n0 || 0) + m.userData.nt * w; }
  // 前照灯の 光（足していく 丸い光。夜ほど 明るい）
  const GL = { max: 256, n: 0, s: 0, p: new Float32Array(256 * 3), c: new Float32Array(256 * 3), pts: null };
  function glowEnd() {
    const T3 = window.THREE; if (!T3 || !SC) return;
    if (!GL.pts) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,245,1)'); gr.addColorStop(0.25, 'rgba(255,245,215,.55)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const ge = new T3.BufferGeometry(); ge.setAttribute('position', new T3.BufferAttribute(GL.p, 3)); ge.setAttribute('color', new T3.BufferAttribute(GL.c, 3));
      GL.pts = new T3.Points(ge, new T3.PointsMaterial({ map: new T3.CanvasTexture(cv), size: 1, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T3.AdditiveBlending, vertexColors: true }));
      GL.pts.frustumCulled = false; GL.pts.renderOrder = 3;
    }
    if (GL.pts.parent !== SC) SC.add(GL.pts);
    GL.pts.geometry.setDrawRange(0, GL.n); GL.pts.geometry.attributes.position.needsUpdate = true; GL.pts.geometry.attributes.color.needsUpdate = true;
    GL.pts.material.size = 0.95 * (GL.s || 0.02); GL.pts.visible = GL.n > 0;   // 灯の まわりの 小さな 光の輪
  }
  function end() {
    glowEnd(); poolEnd();
    for (const k in ST) {
      const s = ST[k]; if (s.st !== 'ok') continue;
      for (const c in s.m) for (const lv in s.m[c]) for (const g of s.m[c][lv]) {
        if (!g.mesh) continue;
        g.mesh.count = g.n; g.mesh.visible = g.n > 0; if (g.n) { g.mesh.instanceMatrix.needsUpdate = true; if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true; if (g.led) g.g.getAttribute('aSlot').needsUpdate = true; }
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
  // ドアの位置（車両の x。m）：{ L: [...], R: [...] }（t70。歩く人が 乗りおりする）
  function doors(md, car) { const s = ST[md.key], m = s && s.m[car]; const L = m && (m.mid || m.far); return L && L.doors ? L.doors : null; }
  window.M3CAR = { ver: 3, fail: false, MODELS, of: s => BY.get(s) || null, need, comp, begin, put, end, night, doors, get state() { return ST; } };
})();
