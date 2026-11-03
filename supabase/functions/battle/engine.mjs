// 自動生成：battle/index.html（BUILD 2026-10-20T13:00）から build_engine.mjs で切り出したルールエンジン。手で書きかえないこと。
// makeEngine(DATA, SPECDATA, SISDATA, FXDATA, rnd)：盤ごとに1つ作る（盤の変数をこの中に閉じこめる）。rnd は乱数（0以上1未満）
export function makeEngine(DATA, SPECDATA, SISDATA, FXDATA, rnd) {
'use strict';
const Math = Object.create(globalThis.Math, { random: { value: rnd || globalThis.Math.random } });   // 乱数（Math.random 12か所）はサーバーの乱数に
const L = (s, v) => v ? String(s).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m) : s;
const LS = k => ({ dot: '・', comma: '、', and: 'と', sep: '。', gap: '　' }[k]);
const abName = ab => ab ? ab.name : '';
const abLabel = (e, k) => k;
function localizeCities() {}
const LOG = [];

// ===== 定数・巡数・最初の町の数 =====
const MAXP=16, PER={2:7,3:6,4:5,5:5,6:4,7:4,8:4,9:3,10:3,11:3,12:3,13:3,14:3,15:3,16:3};
// 人数が多いと1巡が長くなるので、10人以上は巡数を少し減らす
function maxRounds(np){return np<=9?40:Math.max(24,Math.floor(360/np));}
// 巡数の設定：0=おまかせ（人数で決まる） / -1=上限なし / 1〜999=その巡数
function roundLimit(np,rs){return rs===-1?Infinity:rs>0?rs:maxRounds(np);}
function roundText(mr){return isFinite(mr)?L('{n}巡',{n:mr}):L('上限なし');}
// 最初の町の数：-1=少なめ 0=ふつう 1=多め
function perCount(np,ps){const b=PER[np]; return ps<0?Math.max(2,Math.round(b*0.6)):ps>0?Math.round(b*1.6):b;}
const PNAME_JA=['赤','青','緑','黄','紫','橙','水','桃','茶','紺','黄緑','黒','青緑','赤紫','オリーブ','藤'], TNAME_JA=['紅','白'];
const PNAME=PNAME_JA.slice(), TNAME=TNAME_JA.slice(); // ことばを変えると中身を入れかえる
const DRAW=99, TEAMW=100;   // 勝者：0〜15=プレイヤー、99=引き分け、100/101=紅組/白組

// ===== 都道府県・盤のキー =====
const PREF=DATA.prefs, PKEYS=DATA.prefOrder;
const REGIONS={all:{name:'全国',jn:'全国',prefs:PKEYS.slice()}};
for(const [k,n] of DATA.regions) REGIONS[k]={name:n,jn:n,prefs:PKEYS.filter(p=>PREF[p].reg===k)};
for(const k of PKEYS) PREF[k].jn=PREF[k].n; // n はことばで入れかわる。jn は日本語のまま
const PRESETS=['all',...DATA.regions.map(r=>r[0])];
const PHEX=Math.ceil(PKEYS.length/4);
function encPrefs(list){const set=new Set(list); let h=''; for(let i=0;i<PKEYS.length;i+=4){let v=0; for(let j=0;j<4;j++) if(set.has(PKEYS[i+j])) v|=1<<j; h+=v.toString(16);} return h;}
function decPrefs(h){
  if(typeof h!=='string'||h.length!==PHEX||!/^[0-9a-f]+$/.test(h)) return [];
  const out=[]; for(let i=0;i<PKEYS.length;i++){ if(parseInt(h[i>>2],16)&(1<<(i&3))) out.push(PKEYS[i]); } return out;
}
function presetOf(list){const h=encPrefs(list); for(const k of PRESETS) if(encPrefs(REGIONS[k].prefs)===h) return k; return 'custom';}
function boardName(list){const k=presetOf(list); if(k!=='custom') return REGIONS[k].name; if(list.length<=3) return list.map(p=>PREF[p].n).join(LS('dot')); return L('{n}都道府県',{n:list.length});}
function boardEd(list){const k=presetOf(list); return k!=='custom'?L('{b}編',{b:REGIONS[k].name}):L('えらんだ{b}',{b:boardName(list)});}
const TCOUNT={};
function countTowns(list){const h=encPrefs(list); if(TCOUNT[h]==null){const set=new Set(list); let n=0; for(const t of DATA.towns) if(set.has(t.pref)) n++; TCOUNT[h]=n;} return TCOUNT[h];}
function countStarts(list){const set=new Set(list); let n=0; for(const t of DATA.towns) if(set.has(t.pref)&&!t.isl) n++; return n;}
function townStar(t){const sp=SPECDATA.SPEC[t.pref]&&SPECDATA.SPEC[t.pref][t.name]; const s=sp?sp.reduce((a,x)=>a+x[1],0):0; return Math.max(1,s,t.bs||0);}
function countStar4(list){const set=new Set(list); let n=0; for(const t of DATA.towns) if(set.has(t.pref)&&!t.isl&&townStar(t)>=4) n++; return n;}
function matchKey(list){const k=presetOf(list); return k==='custom'?'c'+encPrefs(list):k;}

// ===== 特産品・能力・姉妹都市・海外の町 =====
const SPEC=SPECDATA.SPEC, ABIL=SPECDATA.ABIL;
/* 姉妹都市・友好都市（国内）。市町村コードの組 */
const GIDX=new Map(); DATA.towns.forEach((t,i)=>GIDX.set(t.code,i));
const SISG=new Map(); // 市町村コード → 相手のコードの一覧（盤の外も含む）
for(const [a,b] of SISDATA){ if(!GIDX.has(a)||!GIDX.has(b)||a===b) continue; (SISG.get(a)||SISG.set(a,[]).get(a)).push(b); (SISG.get(b)||SISG.set(b,[]).get(b)).push(a); }
/* 海外の町（海外の姉妹都市・友好都市と、世界の貿易港町）。自分の駒を犠牲にして呼び出すと、持ち駒としてやってくる。
   FX の行：[名前, 駒の字, 国, ★, 人口, 日本の姉妹都市のコード, 貿易港町, en, de, es, ru, ko, zh, よみつきの名前, 駒のよみ, ローマ字, 駒のローマ字] */
const FXD=typeof FXDATA==='object'&&FXDATA?FXDATA:{rows:[],cn:{}}, FX=FXD.rows||[], FXCN=FXD.cn||{};
const FXBY=new Map(); // 市町村コード → 海外の姉妹都市（FX の行の番号）
FX.forEach((r,i)=>{ for(const c of r[5]) (FXBY.get(c)||FXBY.set(c,[]).get(c)).push(i); });
const SUMMON_NEED=4, SUMMON_MAX=3, SUMMON_P=0.5, SUM_WAIT=-1, SUM_FAIL=-2;

// ===== 駒の大きさ（読み込みで使う） =====
const QSZ=[11,13,15.5,18.5,22,26,31,37,44];
function qsz(s){let b=QSZ[0],bd=1e9; for(const q of QSZ){const d=Math.abs(Math.log(q/s)); if(d<bd){bd=d;b=q;}} return b;}

// ===== 盤の読み込み・ルール・CPU・サイコロ =====
let BKEY='', BPREFS=[], T=[], N=0, CITY=[], ADJ=[], PV=[], DIST=null, ROUTES=[], FULL={x:0,y:0,w:1,h:1}, COMP=null, SIS=[], NOSUR=[];
let NP=0, XL=[], XSIS=[]; // NP=駒の数（盤の町 N ＋ 海外の町）。駒 N+j は海外の町 FX[XL[j]]。XSIS[q]=町 q の海外の姉妹都市（駒の番号）
let SEEN=new Uint32Array(1), seenGen=0;
function loadBoard(prefs){
  const set=new Set(prefs);
  BPREFS=PKEYS.filter(k=>set.has(k)); BKEY=encPrefs(BPREFS);
  const G2L=new Int32Array(DATA.towns.length).fill(-1); T=[];
  DATA.towns.forEach((t,gi)=>{ if(set.has(t.pref)){ G2L[gi]=T.length; T.push(t); } });
  N=T.length;
  const cnt={}; T.forEach(t=>{cnt[t.name]=(cnt[t.name]||0)+1;});
  CITY=T.map((t,i)=>{
    const c={i,name:t.name,en:t.en,pref:t.pref,pop:t.pop,area:t.area,x:t.x,y:t.y,sz:t.sz,b:t.b,d:t.d,hist:!!t.hist};
    c.jshort=c.short=t.sh||t.name.replace(/[市区町村]$/,'');
    c.jdisp=c.disp=t.dn||(cnt[t.name]>1?`${t.name}（${PREF[t.pref].jn||PREF[t.pref].n}）`:t.name);
    c.dup=cnt[t.name]>1;
    c.specs=(SPEC[t.pref]&&SPEC[t.pref][t.name])||[];
    c.sum=c.specs.reduce((a,s)=>a+s[1],0);
    c.bs=t.bs||0; c.bk=t.bk||'';
    c.P=Math.max(1,c.sum,c.bs);
    c.ab=(ABIL[t.pref]&&ABIL[t.pref][t.name])||null;
    c.Mbase=1+(t.area>=150?1:0)+(t.area>=500?1:0);
    c.M=c.Mbase+((c.ab&&c.ab.move)||0);
    c.isl=!!t.isl;
    c.qs=qsz(t.sz);
    return c;
  });
  ADJ=T.map(t=>{const a=[]; for(const g of t.adj){const v=G2L[g]; if(v>=0) a.push(v);} return a;});
  // 盤にある姉妹都市どうし
  SIS=T.map(t=>{const l=SISG.get(t.code); if(!l) return null; const a=[]; for(const c of l){const v=G2L[GIDX.get(c)]; if(v>=0) a.push(v);} return a.length?a:null;});
  // 海外の町：盤の町の海外の姉妹都市・友好都市と、貿易港町。駒の番号は N から（盤が同じなら全員同じ並び）
  const codeL=new Map(); T.forEach((t,i)=>codeL.set(t.code,i));
  XL=[]; FX.forEach((r,i)=>{ if(r[6]||r[5].some(c=>codeL.has(c))) XL.push(i); });
  NP=N+XL.length; XSIS=new Array(N).fill(null);
  XL.forEach((fi,j)=>{
    const r=FX[fi], q=N+j, tw=[];
    for(const c of r[5]){ const v=codeL.get(c); if(v!=null){ tw.push(v); (XSIS[v]||(XSIS[v]=[])).push(q); (SIS[v]||(SIS[v]=[])).push(q); } }
    SIS[q]=tw.length?tw:null; // 日本の姉妹都市とも、きずな（入れ替え・能力の共有）がある
    CITY.push({i:q,fx:fi,name:r[0],cc:r[2],pop:r[4]||null,port:!!r[6],tw,P:r[3],sum:0,bs:0,bk:'',specs:[],ab:null,Mbase:2,M:2,isl:false,hist:false,qs:26,sz:20,
      jdisp:r[0],disp:r[0],jshort:r[1],short:r[1],title:r[0],sub:r[7],lab:null,rd:'',frd:''});
  });
  PV=CITY.map(c=>c.P*8+c.M*2+(c.ab?3:0)+4);
  NOSUR=CITY.map(c=>!!(c.ab&&c.ab.noSur)); // 要塞：囲まれても合併されない
  DIST=null; SEEN=new Uint32Array(N); seenGen=0;
  COMP=components();
  ROUTES=DATA.routes.filter(r=>G2L[r.a]>=0&&G2L[r.b]>=0);
  /* 地図の外わく（画面だけ）はサーバーでは使わない */
  localizeCities();
}
function components(){
  const comp=new Int32Array(N).fill(-1), sizes=[]; let k=0;
  for(let s=0;s<N;s++){
    if(comp[s]>=0) continue;
    let sz=0; const st=[s]; comp[s]=k;
    while(st.length){const u=st.pop(); sz++; for(const v of ADJ[u]) if(comp[v]<0){comp[v]=k; st.push(v);}}
    sizes.push(sz); k++;
  }
  let main=0; sizes.forEach((z,i)=>{if(z>sizes[main]) main=i;});
  return {comp,main,sizes};
}
// 何マス離れているか（必要になったときに一度だけ計算する）
function ensureDist(){
  if(DIST) return;
  DIST=new Array(N); const q=new Int32Array(N);
  for(let s=0;s<N;s++){
    const d=new Int16Array(N).fill(999); d[s]=0; let h=0,t=0; q[t++]=s;
    while(h<t){const u=q[h++], du=d[u]+1; for(const v of ADJ[u]) if(d[v]===999){d[v]=du; q[t++]=v;}}
    DIST[s]=d;
  }
}

/* ---------- ルールエンジン ----------
   駒 i は市区町村 i。own: -1=無所属 / 0..15=プレイヤー。at: いるマス（-1=持ち駒）。fl: 1=本拠地 2=だるま 4=空港
   sd: プレイヤーごとの陣営（個人戦は自分の番号、紅白戦は 0=紅 1=白）。ord: 手番の順。 */
function makeBase(np,opt){
  opt=opt||{};
  const s={np,board:new Int16Array(N),own:new Int8Array(NP).fill(-1),at:new Int16Array(NP).fill(-1),fl:new Uint8Array(NP),
    hand:Array.from({length:np},()=>[]),alive:new Array(np).fill(true),home:new Array(np).fill(-1),
    turn:0,ply:0,round:1,winner:-1,endBy:'',last:null,lm:new Array(np).fill(null),
    tm:!!opt.tm, sd:opt.tm&&opt.sd?opt.sd.slice(0,np):[...Array(np).keys()], ord:opt.ord?opt.ord.slice():[...Array(np).keys()],
    mr:opt.mr>0?opt.mr:maxRounds(np),sm:new Map()};
  for(let i=0;i<N;i++){s.board[i]=i; s.at[i]=i; const ab=CITY[i].ab||{}; s.fl[i]=(ab.daruma?2:0)|(ab.airport?4:0);}
  return s;
}
function clone(s){
  return {np:s.np,board:s.board.slice(),own:s.own.slice(),at:s.at.slice(),fl:s.fl.slice(),hand:s.hand.map(h=>h.slice()),
    alive:s.alive.slice(),home:s.home.slice(),turn:s.turn,ply:s.ply,round:s.round,winner:s.winner,endBy:s.endBy,last:s.last,lm:s.lm.slice(),
    tm:s.tm,sd:s.sd,ord:s.ord,mr:s.mr,sm:s.sm};
}
/* 同じ人が持っている姉妹都市どうしは能力を分け合う（同じ種類は重ならない。だるま・空港は分けない） */
const NOAB={}, SHARE_NUM=['atk','def','move','auraAtk','auraDef','auraDebuff','auraSlow','cap'];
function computeEab(s,q){
  const base=CITY[q].ab, sis=SIS[q]; if(!sis) return base||NOAB;
  const o=s.own[q]; if(o<0||s.at[q]<0) return base||NOAB;
  let e=null;
  for(const r of sis){
    if((s.own[r]!==o&&s.own[r]>=0)||s.at[r]<0) continue; // 同じ持ち主か無所属で、盤の上にいる
    const ab=CITY[r].ab; if(!ab) continue;
    if(!e){e=Object.assign({},base||{}); e.from={};}
    for(const k of SHARE_NUM) if(ab[k]&&(e[k]||0)<ab[k]){e[k]=ab[k]; e.from[k]=r;}
    if(ab.handAtk&&!e.handAtk){e.handAtk=1; e.from.handAtk=r;}
    if(ab.pass&&!e.pass){e.pass=1; e.from.pass=r;}
    if(ab.ninja&&!e.ninja){e.ninja=1; e.from.ninja=r;}
  }
  return e||base||NOAB;
}
function eab(s,q){let c=s._ea; if(!c) c=s._ea=new Array(NP); let v=c[q]; if(v===undefined) v=c[q]=computeEab(s,q); return v;}
/* abLabel（画面だけ）はサーバーではスタブ */
function moveOf(s,q){return CITY[q].Mbase+(eab(s,q).move||0);}
// 姉妹都市のきずな：同じ人が持っているか無所属で、どちらも盤の上にある相手
function bonds(s,q){const sis=SIS[q]; if(!sis) return null; const o=s.own[q]; if(o<0||s.at[q]<0) return null; let a=null; for(const r of sis){const or=s.own[r]; if((or===o||or<0)&&s.at[r]>=0) (a||(a=[])).push(r);} return a;}
function wins(s,w,p){return w===p||(s.tm&&w>=TEAMW&&s.sd[p]===w-TEAMW);}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t;} return a;}
// 本拠地になれる町。h4=★4以上の町だけ（足りないときは★の多い町から足す）
function startCands(h4,need){
  if(h4){
    let c=[]; for(let i=0;i<N;i++) if(CITY[i].P>=4&&!CITY[i].isl&&COMP.comp[i]===COMP.main) c.push(i);
    if(c.length<need){ c=[]; for(let i=0;i<N;i++) if(CITY[i].P>=4&&!CITY[i].isl) c.push(i); }
    if(c.length<need){ const rest=[...Array(N).keys()].filter(i=>!c.includes(i)&&!CITY[i].isl&&COMP.comp[i]===COMP.main).sort((a,b)=>CITY[b].P-CITY[a].P); c=c.concat(rest.slice(0,need-c.length)); }
    return c;
  }
  let c=[]; for(let i=0;i<N;i++) if(!CITY[i].isl&&COMP.comp[i]===COMP.main) c.push(i);
  if(c.length<4){c=[]; for(let i=0;i<N;i++) if(COMP.comp[i]===COMP.main) c.push(i);}
  return c;
}
/* 本拠地と最初の町を決める。
   mode='some'（ある程度ランダム）：ほどよく離す。紅白戦では同じ組が近くに集まり、ときどき2人が同じ本拠地になる
   mode='rand'（完全ランダム）：本拠地になれる町から、ばらばらに選ぶだけ */
function planStarts(np,sd,tm,per,h4,mode){
  per=per||PER[np];
  ensureDist();
  sd=tm&&sd?sd:[...Array(np).keys()];
  if(mode==='rand'){
    const cand=shuffle(startCands(!!h4,np).slice());
    if(cand.length>=np) return growStarts(np,sd,per,cand.slice(0,np),new Array(np).fill(-1));
  }
  // 大人数でも、全国の盤で散らばりすぎないように上限をつける
  const [lo,hi]=np<=4?{2:[6,9],3:[5,8],4:[5,8]}[np]:np<=6?[4,11]:np<=8?[3,13]:[3,22];
  const share=new Array(np).fill(-1);
  if(tm) for(const team of [0,1]){
    const mem=shuffle([...Array(np).keys()].filter(i=>sd[i]===team));
    for(let k=0;k+1<mem.length;k+=2) if(Math.random()<0.35) share[mem[k+1]]=mem[k];
  }
  const prim=[...Array(np).keys()].filter(i=>share[i]<0);
  const cand=startCands(!!h4,prim.length);
  let starts=null;
  for(let r=0;r<10&&!starts;r++){
    const a=Math.max(2,lo-Math.floor(r/2)), b=hi+r*2, tb=Math.max(3,a)+r;
    for(let t=0;t<40&&!starts;t++){
      const pick=new Array(np).fill(-1), left=shuffle(prim.slice());
      for(const v of shuffle(cand.slice())){
        if(!left.length) break;
        for(let k=0;k<(tm?left.length:1);k++){
          const p=left[k]; let ok=true, near=false, mates=false;
          for(const q of prim){
            const u=pick[q]; if(u<0) continue; if(u===v){ok=false;break;}
            const d=DIST[u][v];
            if(tm&&sd[q]===sd[p]){ if(d<2){ok=false;break;} mates=true; if(d<=tb) near=true; }
            else if(d<a||d>b){ok=false;break;}
          }
          if(ok&&(!mates||near)){pick[p]=v; left.splice(k,1); break;}
        }
      }
      if(!left.length) starts=pick;
    }
  }
  if(!starts){ // 最後の手段：なるべく離して配る
    starts=new Array(np).fill(-1); const used=[];
    for(const p of prim){
      let best=cand[Math.floor(Math.random()*cand.length)],bd=-1;
      if(used.length) for(const v of cand){ if(used.includes(v)) continue; let d=999; for(const u of used) d=Math.min(d,DIST[u][v]); if(d>bd){bd=d;best=v;} }
      starts[p]=best; used.push(best);
    }
  }
  return growStarts(np,sd,per,starts,share);
}
// 本拠地のまわりに最初の町を配る（近い順。相手の町にふれる町は少し後回し）
function growStarts(np,sd,per,starts,share){
  const prim=[...Array(np).keys()].filter(i=>share[i]<0);
  for(let p=0;p<np;p++) if(share[p]>=0) starts[p]=starts[share[p]];
  const own=new Int8Array(N).fill(-1), clusters=starts.map(v=>[v]);
  for(const p of prim) own[starts[p]]=p;
  const grow=list=>{
    for(const i of shuffle(list.slice())){
      let best=-1,bk=1e9;
      for(let v=0;v<N;v++){
        if(own[v]>=0) continue;
        const d=DIST[starts[i]][v]; if(d>=999) continue;
        const touch=ADJ[v].some(u=>own[u]>=0&&sd[own[u]]!==sd[i])?1.5:0;
        const k=d+touch+Math.random()*0.4;
        if(k<bk){bk=k;best=v;}
      }
      if(best>=0){own[best]=i; clusters[i].push(best);}
    }
  };
  const all=[...Array(np).keys()];
  for(let r=1;r<per;r++) grow(all);
  grow(all.filter(i=>share[i]>=0)); // 本拠地を分け合う人は町を1つ多く
  return {starts,clusters,share};
}
/* 選択制：順番に本拠地をえらぶ。最初の町は、えらんだ町から近い順に決める
   （オンラインでも全員が同じ結果になるように、ここでは乱数を使わない） */
function pickOwnOf(picks,ord){ const own=new Int8Array(N).fill(-1); picks.forEach((nodes,i)=>{ for(const v of nodes) own[v]=ord[i]; }); return own; }
function growPick(own,home,p,per,sd){
  const nodes=[home]; own[home]=p;
  while(nodes.length<per){
    let best=-1,bk=1e9;
    for(let v=0;v<N;v++){
      if(own[v]>=0) continue; const d=DIST[home][v]; if(d>=999) continue;
      let k=d; for(const u of ADJ[v]){ const o=own[u]; if(o>=0&&sd[o]!==sd[p]){ k+=1.5; break; } }
      if(k<bk){bk=k;best=v;}
    }
    if(best<0) break;
    own[best]=p; nodes.push(best);
  }
  return nodes;
}
// CPUがえらぶ本拠地：相手からほどよく離れ、紅白戦なら味方の近く
function cpuPickNode(pool,own,picks,ord,p,sd){
  const free=pool.filter(v=>own[v]<0); if(!free.length) return -1;
  const homes=picks.map((nodes,i)=>({o:ord[i],v:nodes[0]}));
  if(!homes.length) return free[Math.floor(Math.random()*free.length)];
  let best=free[0],bv=-1e9;
  for(const v of free){
    let enemy=99, mate=99;
    for(const h of homes){ const d=DIST[h.v][v]; if(sd[h.o]===sd[p]) mate=Math.min(mate,d); else enemy=Math.min(enemy,d); }
    let sc=Math.min(enemy,10);
    if(mate<99) sc+=6-Math.abs(mate-3)*1.5;
    for(const u of ADJ[v]){ const o=own[u]; if(o>=0&&sd[o]!==sd[p]){ sc-=4; break; } }
    sc+=Math.random()*2.5;
    if(sc>bv){bv=sc;best=v;}
  }
  return best;
}
function claimCluster(s,player,nodes){
  s._ea=null;
  nodes.forEach((v,j)=>{
    const q=s.board[v];
    if(j===0){ if(s.own[q]<0) s.own[q]=player; s.fl[q]|=1; }
    else s.own[q]=player;
  });
  s.home[player]=s.board[nodes[0]];
}
function kingNode(s,p){const q=s.home[p]; return q>=0&&(s.fl[q]&1)&&s.at[q]>=0?s.at[q]:-1;}
function sharedWith(s,p){const q=s.home[p]; const out=[]; if(q<0) return out; for(let i=0;i<s.np;i++) if(i!==p&&s.home[i]===q) out.push(i); return out;}
function reach(s,pi){
  const e=eab(s,pi), me=s.own[pi], sm=s.sd[me], pass=s.tm||!!e.pass, ninja=!!e.ninja;
  let M=CITY[pi].Mbase+(e.move||0);
  // となりに「足止め」の能力をもつ相手の駒がいると移動力-1（1より下にはならない）
  if(M>1) for(const u of ADJ[s.at[pi]]){const q=s.board[u]; if(q>=0){const o=s.own[q]; if(o>=0&&s.sd[o]!==sm&&eab(s,q).auraSlow){M--; break;}}}
  const moves=[], atks=[], g=++seenGen; SEEN[s.at[pi]]=g;
  let fr=[s.at[pi]];
  for(let d=1;d<=M&&fr.length;d++){
    const nx=[];
    for(const u of fr) for(const v of ADJ[u]){
      if(SEEN[v]===g) continue; SEEN[v]=g;
      const q=s.board[v];
      if(q<0){moves.push(v);nx.push(v);}
      else{const o=s.own[q]; if(o>=0&&s.sd[o]===sm){if(pass) nx.push(v);} else{atks.push(v); if(ninja) nx.push(v);}} // 忍び：相手の駒も飛びこえる
    }
    fr=nx;
  }
  return {moves,atks};
}
function atkVal(s,pi,t,parts){
  const c=CITY[pi], ab=eab(s,pi), me=s.own[pi], sm=s.sd[me];
  let v=c.P; if(parts) parts.push([L('戦力'),c.P]);
  if(ab.atk){v+=ab.atk; if(parts) parts.push([abLabel(ab,'atk'),ab.atk]);}
  let sup=0; for(const u of ADJ[t]){const q=s.board[u]; if(q>=0&&q!==pi){const o=s.own[q]; if(o>=0&&s.sd[o]===sm) sup++;}}
  sup=Math.min(sup,ab.cap||2); if(sup){v+=sup; if(parts) parts.push([L('援軍'),sup]);}
  let au=0; for(const u of ADJ[s.at[pi]]){const q=s.board[u]; if(q>=0&&q!==pi){const o=s.own[q]; if(o>=0&&s.sd[o]===sm&&eab(s,q).auraAtk) au++;}}
  au=Math.min(au,2); if(au){v+=au; if(parts) parts.push([L('後押し'),au]);}
  if(ab.handAtk&&me>=0){const h=Math.min(2,s.hand[me].length); if(h){v+=h; if(parts) parts.push([abLabel(ab,'handAtk'),h]);}}
  return v;
}
function defVal(s,di,t,parts){
  const c=CITY[di], ab=eab(s,di), me=s.own[di], sm=me>=0?s.sd[me]:-9;
  let v=c.P; if(parts) parts.push([L('戦力'),c.P]);
  if(ab.def){v+=ab.def; if(parts) parts.push([abLabel(ab,'def'),ab.def]);}
  if(s.fl[di]&1){v+=1; if(parts) parts.push([L('本拠地'),1]);}
  let sup=0,au=0,db=0;
  for(const u of ADJ[t]){
    const q=s.board[u]; if(q<0||q===di) continue;
    const o=s.own[q]; if(o<0) continue;
    const a=eab(s,q);
    if(s.sd[o]===sm){sup++; if(a.auraDef) au++;}
    else if(a.auraDebuff) db++;
  }
  sup=Math.min(sup,ab.cap||2); au=Math.min(au,2); db=Math.min(db,2);
  if(sup){v+=sup; if(parts) parts.push([L('援軍'),sup]);}
  if(au){v+=au; if(parts) parts.push([L('守り'),au]);}
  if(db){v-=db; if(parts) parts.push([L('弱体'),-db]);}
  return v;
}
// となりが全部「相手の陣営」の駒 → 合併（無所属の駒は囲む側にならない）
function surrounded(s,q){
  const n=s.at[q]; if(n<0||!ADJ[n].length||NOSUR[q]) return false; const me=s.own[q], sm=me>=0?s.sd[me]:-9;
  for(const u of ADJ[n]){const w=s.board[u]; if(w<0) return false; const o=s.own[w]; if(o<0||s.sd[o]===sm) return false;}
  return true;
}
function inDanger(s,q){
  const n=s.at[q]; if(n<0||NOSUR[q]) return false; const me=s.own[q]; if(me<0) return false; const sm=s.sd[me]; let e=0;
  for(const u of ADJ[n]){const w=s.board[u]; if(w<0) e++; else{const o=s.own[w]; if(o<0||s.sd[o]===sm) return false;}}
  return e===1;
}
function dropBase(s,side){
  const out=[];
  for(let v=0;v<N;v++){
    if(s.board[v]>=0) continue;
    for(const u of ADJ[v]){const q=s.board[u]; if(q>=0&&s.own[q]===side){out.push(v);break;}}
  }
  return out;
}
function dropTargets(s,side,pi){const out=dropBase(s,side); if(pi<N&&s.board[pi]<0&&!out.includes(pi)) out.push(pi); return out;}
function legal(s,m){
  if(m.t==='c') return summonLegal(s,s.turn,m.ps);
  if(m.t==='s') return !apply(s,m).bad;
  const v=m.to, o=m.t==='d'?-1:s.at[m.p], sm=s.sd[s.turn];
  for(const u of ADJ[v]){ if(u===o) return true; const w=s.board[u]; if(w<0) return true; const ow=s.own[w]; if(ow<0||s.sd[ow]===sm) return true; }
  return !apply(s,m).bad;
}
function genMoves(s,side,ai){
  const out=[]; let front=null; const sm=s.sd[side];
  if(ai){
    front=new Uint8Array(N);
    for(let v=0;v<N;v++){ if(s.board[v]>=0) continue; for(const u of ADJ[v]){const q=s.board[u]; if(q>=0){const o=s.own[q]; if(o<0||s.sd[o]!==sm){front[v]=1;break;}}} }
    const mk=kingNode(s,side); if(mk>=0) for(const u of ADJ[mk]) front[u]=1;
  }
  const ek=[]; if(ai) for(let o=0;o<s.np;o++) if(s.alive[o]&&s.sd[o]!==sm){const k=kingNode(s,o); if(k>=0) ek.push(k);}
  for(let pi=0;pi<NP;pi++){
    if(s.own[pi]!==side||s.at[pi]<0) continue;
    const r=reach(s,pi);
    for(const v of r.moves) out.push({t:'m',p:pi,to:v});
    for(const v of r.atks){const q=s.board[v]; if(atkVal(s,pi,v)>=defVal(s,q,v)) out.push({t:'m',p:pi,to:v,cap:q});}
    if(s.fl[pi]&4) for(let v=0;v<N;v++){ if(s.board[v]>=0) continue; if(ai&&!(front[v]&&ek.some(k=>DIST[v][k]<=4))) continue; out.push({t:'air',p:pi,to:v}); }
    const sis=SIS[pi]; // 姉妹都市と入れ替え
    if(sis) for(const r of sis){ const or=s.own[r]; if((or!==side&&or>=0)||s.at[r]<0||(ai&&or===side&&r<pi)) continue; out.push({t:'s',p:pi,to:s.at[r]}); }
  }
  const hand=s.hand[side];
  if(hand.length){
    const base=dropBase(s,side);
    if(ai){
      const best=hand.slice().sort((a,b)=>PV[b]-PV[a])[0];
      const used=new Set();
      for(const v of base){ if(!front[v]) continue; out.push({t:'d',p:best,to:v}); used.add(v); }
      for(const pi of hand) if(pi<N&&s.board[pi]<0&&!used.has(pi)&&front[pi]) out.push({t:'d',p:pi,to:pi});
    }else{
      for(const pi of hand){ const list=base.slice(); if(pi<N&&s.board[pi]<0&&!base.includes(pi)) list.push(pi); for(const v of list) out.push({t:'d',p:pi,to:v}); }
    }
  }
  const res=out.filter(m=>legal(s,m));
  if(ai&&!res.length) return genMoves(s,side,false);
  return res;
}
function takePiece(n,q,side,info,how){
  if(n.fl[q]&2){n.fl[q]&=~2; info.daruma.push({q,how}); return false;}
  const loser=n.own[q], wasKing=!!(n.fl[q]&1);
  n.board[n.at[q]]=-1; n.at[q]=-1; n.own[q]=side; n.fl[q]&=~1; n.hand[side].push(q);
  info.caps.push({q,how,loser,king:wasKing});
  // 本拠地を合併されたら、その町を本拠地にしている人は全員脱落
  if(wasKing) for(let p=0;p<n.np;p++) if(n.alive[p]&&n.home[p]===q) eliminate(n,p,side,info);
  return true;
}
function eliminate(n,loser,side,info){
  n.alive[loser]=false; info.elim.push(loser);
  for(let i=0;i<NP;i++) if(n.own[i]===loser) n.own[i]=side;
  n.hand[side].push(...n.hand[loser]); n.hand[loser]=[];
  let first=-1, multi=false;
  for(let i=0;i<n.np;i++) if(n.alive[i]){ if(first<0) first=i; else if(n.sd[i]!==n.sd[first]){multi=true;break;} }
  if(!multi&&first>=0){ n.winner=n.tm?TEAMW+n.sd[first]:first; n.endBy='king'; }
}
function advance(n,side){
  n.ply++;
  if(n.winner>=0) return;
  const ord=n.ord, ln=ord.length; let k=ord.indexOf(side), t=side;
  for(let i=0;i<ln;i++){ k=(k+1)%ln; if(k===0) n.round++; t=ord[k]; if(n.alive[t]) break; }
  n.turn=t;
}
function apply(s,m){
  if(m.t==='c') return applySummon(s,m);
  const n=clone(s), side=n.turn, p=m.p, from=n.at[p];
  const info={t:m.t,p,from,to:m.to,side,caps:[],daruma:[],elim:[],auto:!!m.auto};
  if(m.t==='d'){
    const h=n.hand[side]; h.splice(h.indexOf(p),1);
    n.at[p]=m.to; n.board[m.to]=p;
  }else if(m.t==='s'){
    const q=n.board[m.to];
    n.board[from]=q; n.at[q]=from; n.board[m.to]=p; n.at[p]=m.to; info.swap=q;
    if(n.own[q]===side&&surrounded(n,q)) n.bad=true;
  }else{
    const q=n.board[m.to];
    if(q>=0){
      info.atk=q;
      if(takePiece(n,q,side,info,'atk')){n.board[from]=-1; n.board[m.to]=p; n.at[p]=m.to;}
    }else{
      n.board[from]=-1; n.board[m.to]=p; n.at[p]=m.to;
      if(m.t==='air') n.fl[p]&=~4;
    }
  }
  if(n.at[p]>=0&&n.winner<0){
    const sm=n.sd[side];
    for(const u of ADJ[n.at[p]]){
      const w=n.board[u];
      if(w>=0){const o=n.own[w]; if(!(o>=0&&n.sd[o]===sm)&&surrounded(n,w)) takePiece(n,w,side,info,'sur');}
      if(n.winner>=0) break;
    }
    if(m.t==='s'&&n.winner<0){const q=info.swap; if(n.own[q]<0&&n.at[q]>=0&&surrounded(n,q)) takePiece(n,q,side,info,'sur');}
    if(n.own[p]===side&&surrounded(n,p)) n.bad=true;
  }
  n.lm[side]={p,from,to:m.to,t:m.t};
  n.last=info;
  advance(n,side);
  return n;
}
/* ---------- 海外の町を呼ぶ ----------
   自分の番に、本拠地でない自分の駒（盤の上か持ち駒）を★の合計が4以上になるように3つまで犠牲にすると、
   50%で海外の町が持ち駒としてやってくる。犠牲にした駒は、どちらでもなくなる（own=-1・at=-1。もう出てこない）。
   結果（m.r）は手を決める前に決めておく：ひとりで遊ぶときはこの端末、オンラインではホストが決めて、記録にのせて全員に配る。 */
function sacOK(s,side,q){ return q>=0&&q<NP&&s.own[q]===side&&!(s.fl[q]&1); }
function canSummon(s,side){
  if(!XL.length||s.winner>=0||!s.alive[side]) return false;
  const a=[]; for(let q=0;q<NP;q++) if(sacOK(s,side,q)) a.push(CITY[q].P);
  if(!a.length) return false;
  a.sort((x,y)=>y-x); return a.slice(0,SUMMON_MAX).reduce((t,x)=>t+x,0)>=SUMMON_NEED;
}
function summonLegal(s,side,ps){
  if(!Array.isArray(ps)||ps.length<1||ps.length>SUMMON_MAX||new Set(ps).size!==ps.length||!XL.length||s.winner>=0) return false;
  let t=0; for(const q of ps){ if(!sacOK(s,side,q)) return false; t+=CITY[q].P; }
  return t>=SUMMON_NEED;
}
// 呼ばれるかもしれない町：犠牲にする町の海外の姉妹都市 → （なければ）自分の町の海外の姉妹都市 → （なければ）貿易港町。場に出ている町はのぞく
function summonPool(s,side,ps){
  const seen=new Set(), out=[];
  const add=q=>{ if(s.own[q]<0&&!seen.has(q)){ seen.add(q); out.push(q); } };
  for(const p of ps) if(p<N&&XSIS[p]) XSIS[p].forEach(add);
  if(out.length) return {list:out,k:'s'};
  const sp=new Set(ps);
  for(let q=0;q<N;q++) if(s.own[q]===side&&!sp.has(q)&&XSIS[q]) XSIS[q].forEach(add);
  if(out.length) return {list:out,k:'o'};
  for(let q=N;q<NP;q++) if(CITY[q].port) add(q);
  return {list:out,k:'p'};
}
// 結果を決める（成功なら来る町の駒の番号、失敗なら SUM_FAIL）
let ROLLFIX=null; // テスト用：結果を決めておく（true=成功・false=失敗・数=来る町）
function rollSummon(s,m){
  if(m.t!=='c'||m.r!==SUM_WAIT) return m;
  if(typeof ROLLFIX==='number'&&ROLLFIX>=N&&ROLLFIX<NP&&s.own[ROLLFIX]<0){ m.r=ROLLFIX; return m; }
  // 「待った」でやり直しても、同じ場面・同じ犠牲なら結果は同じ（ふり直しはできない）
  let h=s.ply*31+s.turn; for(let q=0;q<NP;q++) h=(h*33+s.own[q]*7+s.at[q])|0;
  const key=h+':'+m.ps.slice().sort((a,b)=>a-b).join(',');
  if(ROLLFIX==null&&s.sm&&s.sm.has(key)){ m.r=s.sm.get(key); return m; }
  if(ROLLFIX!=null?!!ROLLFIX:Math.random()<SUMMON_P){ const l=summonPool(s,s.turn,m.ps).list; m.r=l.length?l[Math.floor(Math.random()*l.length)]:SUM_FAIL; }
  else m.r=SUM_FAIL;
  if(s.sm) s.sm.set(key,m.r);
  return m;
}
// 来た町のつながり（どの町の姉妹都市か・貿易港町か）
function summonWhy(prev,side,ps,r){
  if(r<N) return null;
  const c=CITY[r];
  for(const p of ps) if(p<N&&c.tw.includes(p)) return {k:'s',q:p};
  for(const q of c.tw) if(prev.own[q]===side) return {k:'o',q};
  return {k:c.port?'p':'x',q:-1};
}
function applySummon(s,m){
  const n=clone(s), side=n.turn, h=n.hand[side];
  const info={t:'c',p:m.ps[0],from:-1,to:-1,side,caps:[],daruma:[],elim:[],auto:!!m.auto,ps:m.ps.slice(),r:m.r,at:m.ps.map(q=>s.at[q])};
  for(const q of m.ps){
    const a=n.at[q];
    if(a>=0){ n.board[a]=-1; n.at[q]=-1; }
    else{ const k=h.indexOf(q); if(k>=0) h.splice(k,1); }
    n.own[q]=-1;
  }
  if(m.r>=N&&m.r<NP&&n.own[m.r]<0){ n.own[m.r]=side; n.at[m.r]=-1; n.fl[m.r]=0; h.push(m.r); info.why=summonWhy(s,side,m.ps,m.r); }
  else info.r=SUM_FAIL;
  n.lm[side]={p:m.ps[0],from:-1,to:-1,t:'c'};
  n.last=info;
  advance(n,side);
  return n;
}
function score(s,i){if(!s.alive[i]) return 0; let t=0; for(let q=0;q<NP;q++) if(s.own[q]===i) t+=CITY[q].P; return t;}
function count(s,i){let b=0; for(let q=0;q<NP;q++) if(s.own[q]===i&&s.at[q]>=0) b++; return b;}
function teamScore(s,t){let v=0; for(let i=0;i<s.np;i++) if(s.sd[i]===t) v+=score(s,i); return v;}
function teamCount(s,t){let v=0; for(let i=0;i<s.np;i++) if(s.sd[i]===t&&s.alive[i]) v+=count(s,i); return v;}
function scoreWinner(s){
  if(s.tm){
    const a=teamScore(s,0)*1000+teamCount(s,0), b=teamScore(s,1)*1000+teamCount(s,1);
    return a===b?DRAW:(a>b?TEAMW:TEAMW+1);
  }
  let best=-1,bi=DRAW,tie=false;
  for(let i=0;i<s.np;i++){ if(!s.alive[i]) continue; const v=score(s,i)*1000+count(s,i); if(v>best){best=v;bi=i;tie=false;} else if(v===best) tie=true; }
  return tie?DRAW:bi;
}

/* ---------- CPU ---------- */
function reachAll(s){const R=new Array(NP); for(let i=0;i<NP;i++) if(s.own[i]>=0&&s.at[i]>=0) R[i]=reach(s,i); return R;}
// 空きマスごとに「次の手でそこへ駒を入れられるプレイヤー」をビットで持つ（16人まで）
function fillMap(s,R){
  const fill=new Uint16Array(N);
  for(let i=0;i<NP;i++){
    const o=s.own[i]; if(o<0||s.at[i]<0) continue; const bit=1<<o;
    const r=R[i]; if(r) for(const v of r.moves) fill[v]|=bit;
    if(s.hand[o].length) for(const u of ADJ[s.at[i]]) if(s.board[u]<0) fill[u]|=bit;
  }
  for(let o=0;o<s.np;o++){const bit=1<<o; for(const pi of s.hand[o]) if(pi<N&&s.board[pi]<0) fill[pi]|=bit;}
  return fill;
}
// 1回の走査で「自分の陣営がねらわれる度合い（相手ごと）」と「自分がねらえる一番いい駒」を出す
function capScan(s,R,fill,me){
  const sm=s.sd[me];
  const vs=new Float64Array(s.np), vsK=new Uint8Array(s.np); let my=0, myK=false;
  for(let i=0;i<NP;i++){
    const r=R[i]; if(!r||!r.atks.length) continue; const o=s.own[i], ao=s.sd[o]===sm;
    if(ao&&o!==me) continue;
    for(const v of r.atks){
      const q=s.board[v], oq=s.own[q], aq=oq>=0&&s.sd[oq]===sm;
      if(ao?aq:!aq) continue;
      if(atkVal(s,i,v)<defVal(s,q,v)) continue;
      const dar=s.fl[q]&2, king=!dar&&(s.fl[q]&1), x=dar?5:PV[q];
      if(ao){ if(king) myK=true; if(x>my) my=x; } else { if(king) vsK[o]=1; if(x>vs[o]) vs[o]=x; }
    }
  }
  let enemy=0; for(let o=0;o<s.np;o++) if(s.sd[o]!==sm) enemy|=1<<o;
  const myBit=1<<me;
  for(let q=0;q<NP;q++){
    const n=s.at[q]; if(n<0||NOSUR[q]) continue; const oq=s.own[q], sq=oq>=0?s.sd[oq]:-9;
    let emp=-1,cnt=0,ok=true;
    for(const u of ADJ[n]){const w=s.board[u]; if(w<0){cnt++;emp=u;if(cnt>1){ok=false;break;}} else{const ow=s.own[w]; if(ow<0||s.sd[ow]===sq){ok=false;break;}}}
    if(!ok||cnt!==1) continue;
    const mask=fill[emp]; if(!mask) continue;
    const dar=s.fl[q]&2, king=!dar&&(s.fl[q]&1), x=dar?5:PV[q];
    if(sq===sm){ const m2=mask&enemy; if(m2) for(let o=0;o<s.np;o++){ if(!(m2&(1<<o))) continue; if(king) vsK[o]=1; if(x>vs[o]) vs[o]=x; } }
    else if(mask&myBit){ if(king) myK=true; if(x>my) my=x; }
  }
  return {vs,vsK,my,myK};
}
function evaluate(s,me){
  if(s.winner>=0) return wins(s,s.winner,me)?1e5:(s.winner===DRAW?0:-1e5);
  if(!s.alive[me]) return -1e5;
  const sm=s.sd[me], mat=new Float64Array(s.np);
  for(let i=0;i<NP;i++){const o=s.own[i]; if(o<0) continue; mat[o]+=s.at[i]<0?PV[i]*0.8:PV[i];}
  const opp=[], mates=[]; for(let i=0;i<s.np;i++) if(i!==me&&s.alive[i]) (s.sd[i]===sm?mates:opp).push(i);
  let sc=mat[me]+mates.reduce((a,i)=>a+mat[i]*0.6,0)-opp.reduce((a,i)=>a+mat[i],0)/Math.max(1,opp.length);
  const R=reachAll(s), TS=capScan(s,R,fillMap(s,R),me);
  for(const o of opp){const w=o===s.turn?1:0.45; if(TS.vsK[o]) sc-=3000*w; sc-=TS.vs[o]*0.9*w;}
  sc+=(TS.myK?200:TS.my)*(s.turn===me?0.75:0.25);
  // 相手や無所属の町を囲みにいく（同じ組の駒も囲む側に数える）
  for(let q=0;q<NP;q++){
    const n=s.at[q]; if(n<0||NOSUR[q]) continue; const oq=s.own[q]; if(oq>=0&&s.sd[oq]===sm) continue;
    const sq=oq>=0?s.sd[oq]:-9, deg=ADJ[n].length; if(!deg) continue;
    let fill=0, mn=0, bad=false;
    for(const u of ADJ[n]){const w=s.board[u]; if(w<0) continue; const o=s.own[w]; if(o<0||s.sd[o]===sq){bad=true;break;} fill++; if(s.sd[o]===sm) mn++;}
    if(bad||!mn) continue;
    const f=fill/deg, base=(s.fl[q]&1)?40:PV[q]*(oq<0?0.25:0.35);
    sc+=base*f*f+mn*((s.fl[q]&1)?4:0.8);
  }
  const ek=[]; for(const o of opp){const k=kingNode(s,o); if(k>=0) ek.push(k);}
  const mk=kingNode(s,me);
  if(mk>=0){let g=0; for(const u of ADJ[mk]){const w=s.board[u]; if(w>=0){const o=s.own[w]; if(o>=0&&s.sd[o]===sm) g++;}} sc+=Math.min(g,3)*2.5;}
  for(let i=0;i<NP;i++){
    if(s.own[i]!==me||s.at[i]<0) continue; const n=s.at[i];
    if(n===mk) continue;
    if(ek.length){let d=999; for(const k of ek) d=Math.min(d,DIST[n][k]); sc+=(14-Math.min(14,d))*0.6;}
    if(mk>=0&&DIST[n][mk]<=1) sc+=1;
  }
  return sc;
}
function bestReply(s,K,me){
  const t=s.turn, ms=genMoves(s,t,true); if(!ms.length) return null;
  const arr=ms.map(m=>{const ns=apply(s,m); let g=Math.random(); for(const c of ns.last.caps) g+=c.king?1e4:PV[c.q]*(c.loser<0?0.6:1); return {ns,g};});
  arr.sort((a,b)=>b.g-a.g);
  const friend=me!==undefined&&s.sd[t]===s.sd[me];
  let best=null,bv=-Infinity;
  for(const o of arr.slice(0,K)){
    let v;
    if(me===undefined) v=wins(o.ns,o.ns.winner,t)?1e6:evaluate(o.ns,t);
    else if(friend) v=evaluate(o.ns,me);
    else v=-evaluate(o.ns,me);
    if(v>bv){bv=v;best=o.ns;}
  }
  return best;
}
const LV=[{noise:12,deep:0,sum:[0.2,40]},{noise:2,deep:20,reply:8,sum:[0.12,25]},{noise:0.6,deep:32,reply:14,paranoid:true,sum:[0.06,12]}];
// CPUが海外の町を呼ぶときの犠牲：★の合計が4以上になる、いちばん安い組み合わせ（持ち駒から、価値の低い駒から）
function cpuSummonMove(s,side,handOnly){
  const val=q=>s.at[q]<0?PV[q]*0.8:PV[q]+6;
  const byP=new Map(); // ★の数ごとに、安い駒を3つまで（いちばん安い組み合わせは、この中にかならずある）
  for(let q=0;q<NP;q++) if(sacOK(s,side,q)&&(!handOnly||s.at[q]<0)){ const P=CITY[q].P; (byP.get(P)||byP.set(P,[]).get(P)).push(q); }
  const c=[]; for(const l of byP.values()){ l.sort((a,b)=>val(a)-val(b)); c.push(...l.slice(0,SUMMON_MAX)); }
  if(!c.length) return null;
  c.sort((a,b)=>val(a)-val(b));
  const K=c.length; let best=null, bv=Infinity;
  for(let i=0;i<K;i++){
    const a=c[i], pa=CITY[a].P, va=val(a);
    if(pa>=SUMMON_NEED&&va<bv){bv=va; best=[a];}
    for(let j=i+1;j<K;j++){
      const b=c[j], pb=pa+CITY[b].P, vb=va+val(b); if(vb>=bv) continue;
      if(pb>=SUMMON_NEED){bv=vb; best=[a,b]; continue;}
      for(let k=j+1;k<K;k++){ const d=c[k], v=vb+val(d); if(v<bv&&pb+CITY[d].P>=SUMMON_NEED){bv=v; best=[a,b,d];} }
    }
  }
  return best?{t:'c',ps:best,r:SUM_WAIT}:null;
}
// 呼んだときの見込み（成功と失敗の半分ずつ。来る町は★が平均に近い町で見積もる）
function summonEV(s,m,me){
  const fail=evaluate(apply(s,Object.assign({},m,{r:SUM_FAIL})),me), pool=summonPool(s,me,m.ps).list;
  if(!pool.length) return fail;
  const avg=pool.reduce((t,q)=>t+CITY[q].P,0)/pool.length; let rep=pool[0], bd=99;
  for(const q of pool){ const d=Math.abs(CITY[q].P-avg); if(d<bd){bd=d; rep=q;} }
  return 0.5*evaluate(apply(s,Object.assign({},m,{r:rep})),me)+0.5*fail;
}
function cpuChoose(s,lv,opt){
  const cfg=LV[lv]||LV[1], me=s.turn;
  ensureDist();
  const moves=genMoves(s,me,true);
  if(!moves.length) return cpuSummonMove(s,me,false); // ほかに指せる手がないときは呼ぶ（呼べなければ null）
  let sc=moves.map(m=>{const ns=apply(s,m); return {m,ns,v:wins(ns,ns.winner,me)?1e6:evaluate(ns,me)};});
  if(cfg.deep){
    sc.sort((a,b)=>b.v-a.v); sc=sc.slice(0,cfg.deep);
    for(const o of sc){
      if(o.ns.winner>=0) continue;
      const r=bestReply(o.ns,cfg.reply,cfg.paranoid?me:undefined); if(!r) continue;
      o.v=evaluate(r,me)*0.8+o.v*0.2;
    }
  }
  const lm=s.lm[me];
  for(const o of sc){
    if(lm&&o.m.t==='m'&&o.m.cap===undefined&&o.m.p===lm.p&&o.m.to===lm.from) o.v-=3;
    if(lm&&lm.t==='s'&&o.m.t==='s') o.v-=5; // 入れ替えを続けない
    o.v+=(Math.random()*2-1)*cfg.noise;
  }
  sc.sort((a,b)=>b.v-a.v);
  // ときどき、あまっている持ち駒で海外の町を呼んでみる（時間切れの代打ちでは呼ばない）
  if(!(opt&&opt.auto)&&cfg.sum&&s.hand[me].length>=3&&Math.random()<cfg.sum[0]){
    const sm=cpuSummonMove(s,me,true);
    if(sm&&summonEV(s,sm,me)>=sc[0].v-cfg.sum[1]) return sm;
  }
  return sc[0].m;
}
/* 順番決めのサイコロ：大きい目から。同じ目の人どうしはふり直し */
function diceOrder(np){
  const rolls=Array.from({length:np},()=>[]), order=[];
  const last=i=>rolls[i][rolls[i].length-1];
  const solve=g=>{
    if(g.length===1){order.push(g[0]); return;}
    for(const i of g) rolls[i].push(1+Math.floor(Math.random()*6));
    const groups=[]; for(let v=6;v>=1;v--){const sub=g.filter(i=>last(i)===v); if(sub.length) groups.push(sub);}
    for(const sub of groups) solve(sub);
  };
  solve([...Array(np).keys()]);
  return {order,rolls};
}
function effOrder(list,np){return list.filter(i=>i<np);}


// ===== 手の文字列 =====
const B64='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const MV_RE=/c[0-9A-Za-z_-]{4}[xX][0-9A-Za-z_-]{4}|[mdasMDAS][0-9A-Za-z_-]{4}/g;
function e2(n){return B64[n>>6]+B64[n&63];}
function d2(s){const a=B64.indexOf(s[0]), b=B64.indexOf(s[1]); return a<0||b<0?-1:a*64+b;}
function encMove(m){
  if(m.t==='c'){ const ps=m.ps, X=4095, r=m.r>=0?m.r:m.r===SUM_FAIL?4094:4095; return 'c'+e2(ps[0])+e2(ps.length>1?ps[1]:X)+(m.auto?'X':'x')+e2(ps.length>2?ps[2]:X)+e2(r); }
  let t=m.t==='d'?'d':m.t==='air'?'a':m.t==='s'?'s':'m'; if(m.auto) t=t.toUpperCase(); return t+e2(m.p)+e2(m.to);
}
function decMove(s,st){
  if(typeof s==='string'&&s.length===10&&/^c[0-9A-Za-z_-]{4}[xX][0-9A-Za-z_-]{4}$/.test(s)){
    const a=d2(s.slice(1,3)), b=d2(s.slice(3,5)), c=d2(s.slice(6,8)), r=d2(s.slice(8,10));
    const ps=[a]; if(b!==4095) ps.push(b); if(c!==4095){ if(b===4095) return null; ps.push(c); }
    if(ps.some(q=>!(q>=0&&q<NP))) return null;
    const m={t:'c',ps,r:r===4095?SUM_WAIT:r===4094?SUM_FAIL:r};
    if(m.r>=0&&!(m.r>=N&&m.r<NP)) return null;
    if(s[5]==='X') m.auto=true;
    return m;
  }
  if(typeof s!=='string'||!/^[mdasMDAS][0-9A-Za-z_-]{4}$/.test(s)) return null;
  const p=d2(s.slice(1,3)), to=d2(s.slice(3,5));
  if(!(p>=0&&p<NP&&to>=0&&to<N)) return null;
  const k=s[0].toLowerCase(), t=k==='d'?'d':k==='a'?'air':k==='s'?'s':'m', m={t,p,to};
  if(s[0]!==k) m.auto=true;
  if(t==='m'&&st.board[to]>=0) m.cap=st.board[to];
  return m;
}
function sameMove(a,b){return a.t===b.t&&(a.t==='c'?a.r===b.r&&a.ps.length===b.ps.length&&a.ps.every((q,i)=>q===b.ps[i]):a.p===b.p&&a.to===b.to);}
function encOrder(o){return o.map(i=>i.toString(36)).join('');}
function decOrder(s,n){
  if(typeof s!=='string'||s.length!==n) return null;
  const o=[...s].map(ch=>parseInt(ch,36));
  if(o.some(x=>!(x>=0&&x<n))||new Set(o).size!==n) return null;
  return o;
}
function sideArr(cfg){return cfg.tm?[...cfg.tt].map(Number):[...Array(cfg.n).keys()];}
function teamsOK(sd){return sd.includes(0)&&sd.includes(1);}

// ===== パス・巡数の決着 =====
function hasMove(s,side){
  for(let pi=0;pi<NP;pi++){
    if(s.own[pi]!==side||s.at[pi]<0) continue;
    const r=reach(s,pi);
    for(const v of r.moves) if(legal(s,{t:'m',p:pi,to:v})) return true;
    for(const v of r.atks){const q=s.board[v]; if(atkVal(s,pi,v)>=defVal(s,q,v)&&legal(s,{t:'m',p:pi,to:v,cap:q})) return true;}
  }
  for(const pi of s.hand[side]) for(const v of dropTargets(s,side,pi)) if(legal(s,{t:'d',p:pi,to:v})) return true;
  for(let pi=0;pi<NP;pi++) if(s.own[pi]===side&&s.at[pi]>=0&&(s.fl[pi]&4)) for(let v=0;v<N;v++) if(s.board[v]<0&&legal(s,{t:'air',p:pi,to:v})) return true;
  for(let pi=0;pi<NP;pi++){ const b=s.own[pi]===side?bonds(s,pi):null; if(b) for(const r of b) if(legal(s,{t:'s',p:pi,to:s.at[r]})) return true; }
  return canSummon(s,side); // 動かせる駒がなくても、海外の町は呼べる
}
function settle(s,logit){
  for(let k=0;k<MAXP+2;k++){
    if(s.winner>=0) return s;
    if(s.round>s.mr){const n=clone(s); n.winner=scoreWinner(n); n.endBy='round'; return n;}
    if(hasMove(s,s.turn)) return s;
    if(logit) LOG.unshift({side:s.turn,f:()=>L('動かせる駒がないのでパス')});
    const n=clone(s); advance(n,s.turn); s=n;
  }
  return s;
}

// ===== 設定のチェック =====
function validCfg(c){
  if(!c||typeof c!=='object') return false;
  if(typeof c.p!=='string'||!decPrefs(c.p).length) return false;
  if(!(Number.isInteger(c.n)&&c.n>=2&&c.n<=MAXP)||![0,1,2].includes(c.l)||![0,1].includes(c.tm)) return false;
  if(c.tm&&!(typeof c.tt==='string'&&c.tt.length===c.n&&/^[01]+$/.test(c.tt))) return false;
  if(!['d','s'].includes(c.om)||!decOrder(c.os,c.n)) return false;
  if(typeof c.r!=='string'||c.r.length>20) return false;
  if(!(Number.isInteger(c.mr)&&c.mr>=-1&&c.mr<=999)) return false;
  if(c.hs!=null&&![0,1].includes(c.hs)) return false;
  if(c.sp!=null&&![0,1,2].includes(c.sp)) return false;
  if(![-1,0,1].includes(c.ps)||!(Number.isInteger(c.tb)&&c.tb>=0&&c.tb<=7200)||!(Number.isInteger(c.by)&&c.by>=0&&c.by<=600)) return false;
  return true;
}

return { get N() { return N; }, get NP() { return NP; }, get CITY() { return CITY; }, get BKEY() { return BKEY; }, LOG,
  PKEYS, REGIONS, MAXP, DRAW, TEAMW, SUM_WAIT, SUM_FAIL,
  maxRounds, roundLimit, perCount, encPrefs, decPrefs, countTowns, countStarts, countStar4, loadBoard, ensureDist,
  makeBase, clone, wins, startCands, planStarts, pickOwnOf, growPick, cpuPickNode, claimCluster, genMoves, apply, advance,
  summonLegal, rollSummon, score, teamScore, scoreWinner, cpuChoose, diceOrder, effOrder, encMove, decMove, sameMove,
  encOrder, decOrder, sideArr, teamsOK, hasMove, settle, validCfg };
}
