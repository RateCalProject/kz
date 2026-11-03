/* 百人一首：オンライン対戦の部屋（風の芽経済組のサイトで使うとき・2026-10-31）
   ゲームは claude.ai の「room」（join・presence・peers・onPeers・leave）で作ってあるので、同じ形の部屋をここでつくる（ゲームの本体はそのまま）。
   - 全員が、自分の presence（名前・ホストの設定・対戦の状態・タップ）を部屋に流し、全員がみんなのものを受けとる
   - 4秒ごとに流しなおす（生きている合図）。15秒とどかない人は「いなくなった」。ぬけるときは bye
   - 道は3つ同時：同じ端末（BroadcastChannel）・近くの中継（Supabase Realtime の broadcast。../config.js）・公開MQTTサーバー（市区町村バトルと同じ）。
     どの道から届いても、新しいもの（送った人ごとの番号 q）だけ使う */
(function () {
'use strict';
if (window.claude && typeof window.claude.use === 'function') return;   // claude.ai の中では、もとの room を使う
const TP = 'aruri-karuta/r1/';
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const rid = () => Math.random().toString(36).slice(2, 12);
const sized = o => { try { return JSON.stringify(o).length <= 60000; } catch (e) { return false; } };

/* ---- 公開MQTTサーバーでの中継（市区町村バトルと同じしくみ） ---- */
const MQ=(()=>{
  const LIST=Array.isArray(window.__mqttBrokers)?window.__mqttBrokers:[
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://mqtt.eclipseprojects.io/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'];
  const OK=typeof TextEncoder==='function'&&typeof TextDecoder==='function';
  const te=OK?new TextEncoder():null, td=OK?new TextDecoder():null;
  const subs=new Map();          // 話題 -> 受け取る関数たち
  const unsubT=new Map();        // 話題 -> やめる予定のタイマー
  const watch=new Set();         // つながり具合が変わったら呼ぶ
  const bs=LIST.map(url=>({url,ws:null,ok:false,fails:0,t:0,buf:null,last:0,rx:0,tx:0}));
  const cid='hk'+Math.random().toString(36).slice(2,12);
  let on=false, pid=0, ka=0;
  function cat(ps){ let n=0; for(const p of ps) n+=p.length; const o=new Uint8Array(n); let i=0; for(const p of ps){ o.set(p,i); i+=p.length; } return o; }
  function s16(s){ const b=te.encode(s); return cat([[b.length>>8&255,b.length&255],b]); }
  function pkt(h,body){ const a=[h]; let n=body.length; do{ let d=n&127; n=Math.floor(n/128); if(n) d|=128; a.push(d); }while(n); return cat([a,body]); }
  const nid=()=>(pid=pid%65535+1);
  const pConnect=()=>pkt(0x10,cat([s16('MQTT'),[4,2,0,60],s16(cid)]));
  function pSub(ts){ const id=nid(); const ps=[[id>>8,id&255]]; for(const t of ts) ps.push(s16(t),[0]); return pkt(0x82,cat(ps)); }
  function pUnsub(ts){ const id=nid(); const ps=[[id>>8,id&255]]; for(const t of ts) ps.push(s16(t)); return pkt(0xA2,cat(ps)); }
  const pPub=(t,s)=>pkt(0x30,cat([s16(t),te.encode(s)]));
  function send(b,d){ if(b.ws&&b.ws.readyState===1){ try{ b.ws.send(d); b.tx++; return true; }catch(e){} } return false; }
  function changed(){ watch.forEach(f=>{ try{ f(); }catch(e){ console.error(e); } }); }
  function handle(b,h,body){
    const type=h>>4;
    if(type===2){ // CONNACK
      if(body.length>=2&&body[1]===0){ b.ok=true; b.fails=0; const ts=[...subs.keys()]; if(ts.length) send(b,pSub(ts)); changed(); }
      else if(b.kill) b.kill();
    }else if(type===3){ // PUBLISH
      if(body.length<2) return;
      const tl=body[0]<<8|body[1]; if(2+tl>body.length) return;
      const topic=td.decode(body.subarray(2,2+tl)); let k=2+tl;
      const qos=(h>>1)&3; if(qos){ if(qos===1&&k+2<=body.length) send(b,pkt(0x40,[body[k],body[k+1]])); k+=2; }
      b.rx++;
      const hs=subs.get(topic); if(!hs||!hs.size) return;
      let m; try{ m=JSON.parse(td.decode(body.subarray(k))); }catch(e){ return; }
      [...hs].forEach(f=>{ try{ f(m,topic); }catch(e){ console.error(e); } });
    }
  }
  function feed(b,data){
    const buf=b.buf?cat([b.buf,data]):data;
    let i=0;
    for(;;){
      if(buf.length-i<2) break;
      let len=0, mul=1, j=i+1, done=false;
      while(j<buf.length){ const d=buf[j++]; len+=(d&127)*mul; if(!(d&128)){ done=true; break; } mul*=128; if(mul>2097152){ b.buf=null; if(b.kill) b.kill(); return; } }
      if(!done||buf.length-j<len) break;
      handle(b,buf[i],buf.subarray(j,j+len)); i=j+len;
    }
    b.buf=i<buf.length?buf.slice(i):null;
  }
  function open(b){
    if(!on||b.ws) return;
    let ws; try{ ws=new WebSocket(b.url,['mqtt']); }catch(e){ b.fails++; later(b); return; }
    ws.binaryType='arraybuffer'; b.ws=ws; b.ok=false; b.buf=null; b.last=Date.now();
    // 切れたとき（error と close のどちらが来ても1回だけ）
    const dead=()=>{ clearTimeout(to); if(b.ws!==ws) return; b.ws=null; const was=b.ok; b.ok=false; b.fails++; try{ ws.close(); }catch(e){} later(b); if(was) changed(); };
    const to=setTimeout(()=>{ if(b.ws===ws&&!b.ok) dead(); },10000);
    ws.onopen=()=>{ if(b.ws===ws) send(b,pConnect()); };
    ws.onmessage=e=>{ if(b.ws!==ws) return; b.last=Date.now(); if(e.data instanceof ArrayBuffer) feed(b,new Uint8Array(e.data)); };
    ws.onclose=dead; ws.onerror=dead; b.kill=dead;
  }
  function later(b){ clearTimeout(b.t); if(on) b.t=setTimeout(()=>open(b),Math.min(30000,800*Math.pow(2,Math.min(b.fails,6)))); }
  function keep(){ // 20秒ごとに生きているか確かめる。返事がなければつなぎ直す
    const now=Date.now();
    for(const b of bs){
      if(!b.ws) continue;
      if(b.ok&&now-b.last>70000){ if(b.kill) b.kill(); continue; }
      if(b.ok) send(b,new Uint8Array([0xC0,0]));
    }
  }
  function start(){ if(on||!OK||typeof WebSocket!=='function'||!bs.length) return; on=true; bs.forEach(open); ka=setInterval(keep,20000); }
  function count(){ let n=0; for(const b of bs) if(b.ok) n++; return n; }
  return {
    start, count,
    get all(){ return bs.length; },
    // 聞くのをやめるときは少し待ってからやめる（すぐ同じ話題を聞き直すときに、やめる・聞くの順番が入れかわらないように）
    sub(topic,f){
      start();
      let hs=subs.get(topic);
      if(!hs){ hs=new Set(); subs.set(topic,hs); bs.forEach(b=>{ if(b.ok) send(b,pSub([topic])); }); }
      clearTimeout(unsubT.get(topic)); unsubT.delete(topic);
      hs.add(f);
      return ()=>{
        const h2=subs.get(topic); if(!h2||!h2.delete(f)||h2.size||unsubT.has(topic)) return;
        unsubT.set(topic,setTimeout(()=>{ unsubT.delete(topic); const h3=subs.get(topic); if(h3&&!h3.size){ subs.delete(topic); bs.forEach(b=>{ if(b.ok) send(b,pUnsub([topic])); }); } },3000));
      };
    },
    pub(topic,obj){ start(); let s; try{ s=JSON.stringify(obj); }catch(e){ return 0; } const d=pPub(topic,s); let n=0; for(const b of bs) if(b.ok&&send(b,d)) n++; return n; },
    // どこかにつながるまで待つ。全部のサーバーが一度ずつ失敗したら（通信が止められているなど）待たずにあきらめる
    ready(ms){ start(); return new Promise(res=>{ if(count()) return res(true); if(!on) return res(false); const t0=Date.now(); const iv=setInterval(()=>{ if(count()){ clearInterval(iv); res(true); } else if(Date.now()-t0>=ms||bs.every(b=>b.fails>0)){ clearInterval(iv); res(false); } },100); }); },
    onChange(f){ watch.add(f); return ()=>watch.delete(f); },
    stat(){ return bs.map(b=>({url:b.url,ok:b.ok,fails:b.fails,rx:b.rx,tx:b.tx})); }
  };
})();

/* ---- 近くの中継（Supabase Realtime の broadcast。kz.js の supabase をつかう） ---- */
function rtOpen(name, recv, onState) {
  const sb = window.KZ_SB; if (!sb || typeof sb.channel !== 'function') return null;
  let ok = false, ch = null;
  try {
    ch = sb.channel('karuta-' + name, { config: { broadcast: { self: false, ack: false } } });
    ch.on('broadcast', { event: 'm' }, m => { if (m && isObj(m.payload)) recv(m.payload); });
    let fails = 0;
    ch.subscribe(st => {
      const was = ok; ok = st === 'SUBSCRIBED'; if (ok !== was) onState(ok);
      if ((st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') && ++fails >= 2) { ok = false; try { sb.removeChannel(ch); } catch (e) {} }   // サーバーに中継がないときは、あきらめる（公開MQTTで）
    });
  } catch (e) { return null; }
  return {
    get ok() { return ok; },
    send(msg) { if (!ok) return false; try { ch.send({ type: 'broadcast', event: 'm', payload: msg }); return true; } catch (e) { return false; } },
    close() { ok = false; try { sb.removeChannel(ch); } catch (e) {} }
  };
}

/* ---- 部屋 ---- */
async function join(name) {
  name = String(name || '').replace(/[^\w-]/g, '').slice(0, 40); if (!name) throw new Error('room');
  const me = 'k' + rid(), topic = TP + name;
  const others = new Map(), hs = new Set();   // 人 → { presence, q, last }
  let mine = {}, myQ = 0, left = false, prev = new Map(), fireT = 0;
  const nq = () => (myQ = Math.max(Date.now(), myQ + 1));
  const list = () => [{ peer: me, kind: 'viewer', isMe: true, sameTab: true, presence: mine },
    ...[...others].map(([p, o]) => ({ peer: p, kind: 'viewer', isMe: false, sameTab: false, presence: o.presence }))];
  // 変わったら知らせる（joined・left もつける）。続けて変わったときは1回に
  function fire() {
    if (fireT) return;
    fireT = setTimeout(() => {
      fireT = 0; if (left) return;
      const peers = list(), cur = new Map(peers.map(p => [p.peer, p]));
      const joined = peers.filter(p => !prev.has(p.peer)), gone = [...prev.values()].filter(p => !cur.has(p.peer));
      prev = cur;
      [...hs].forEach(h => { try { h({ peers, joined, left: gone }); } catch (e) { console.error(e); } });
    }, 0);
  }
  let bc = null, rt = null;
  const myMsg = () => ({ t: 'p', f: me, q: myQ, p: mine });
  function send(msg) {
    let n = 0;
    if (bc) { try { bc.postMessage(msg); n++; } catch (e) {} }
    if (rt && rt.send(msg)) n++;
    n += MQ.pub(topic, msg);
    return n;
  }
  function recv(d) {
    if (left || !isObj(d) || typeof d.f !== 'string' || d.f === me || d.f.length > 24) return;
    const q = typeof d.q === 'number' && isFinite(d.q) ? d.q : 0, o = others.get(d.f);
    if (d.t === 'bye') { if (o && q >= o.q) { others.delete(d.f); fire(); } return; }
    if (d.t !== 'p' || !isObj(d.p) || !sized(d.p)) return;
    if (o && q <= o.q) { o.last = Date.now(); return; }   // 古い（ほかの道から先にとどいた）
    const isNew = !o;
    others.set(d.f, { presence: d.p, q, last: Date.now() });
    fire();
    if (isNew && myQ) send(myMsg());   // あたらしい人に、すぐ自分のことを知らせる
  }
  try { if (typeof BroadcastChannel === 'function') { bc = new BroadcastChannel(topic); bc.onmessage = e => recv(e.data); } } catch (e) { bc = null; }
  const unsub = MQ.sub(topic, recv);
  rt = rtOpen(name, recv, ok => { if (ok && myQ && !left) send(myMsg()); });
  const unwatch = MQ.onChange(() => { if (!left && myQ && MQ.count()) MQ.pub(topic, myMsg()); });
  // ネットの道（中継か公開MQTT）がつながるまで、少し待つ（同じ端末どうしなら、つながらなくても遊べる）
  const net = () => MQ.count() > 0 || !!(rt && rt.ok);
  await new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => { if (net() || Date.now() - t0 > 6000) { clearInterval(iv); res(); } }, 100); });
  if (!net() && !bc) { left = true; unsub(); unwatch(); if (rt) rt.close(); throw new Error('つながりませんでした'); }
  const iv = setInterval(() => {
    if (left) { clearInterval(iv); return; }
    const now = Date.now(); let ch = false;
    for (const [p, o] of others) if (now - o.last > 15000) { others.delete(p); ch = true; }
    if (ch) fire();
    if (myQ) send(myMsg());   // 生きている合図（とりこぼしのうめあわせ）
  }, 4000);
  const bye = () => { if (!left) send({ t: 'bye', f: me, q: nq() }); };
  window.addEventListener('pagehide', bye);
  fire();
  return {
    name,
    presence(patch) {
      if (left) return Promise.resolve();
      if (isObj(patch)) for (const k in patch) { if (patch[k] === null || patch[k] === undefined) delete mine[k]; else mine[k] = patch[k]; }
      nq(); send(myMsg()); fire();
      return Promise.resolve();
    },
    peers: list,
    onPeers(h) { hs.add(h); return () => hs.delete(h); },
    leave() {
      if (left) return Promise.resolve();
      bye(); left = true; clearInterval(iv); unsub(); unwatch(); if (rt) rt.close(); if (bc) { try { bc.close(); } catch (e) {} }
      window.removeEventListener('pagehide', bye);
      return Promise.resolve();
    },
    diag() { return { mq: MQ.count(), rt: !!(rt && rt.ok), bc: !!bc, peers: others.size }; }
  };
}
// オンライン対戦の画面をひらいたときに、公開MQTTサーバーにつなぎはじめる（部屋に入るのが速くなる。ほかのときはつながない）
window.claude = { __site: true, use: n => { if (n !== 'room') return Promise.reject(new Error('not available: ' + n)); MQ.start(); return Promise.resolve({ join }); } };
})();
