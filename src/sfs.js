// SFS2X binary codec + session handlers (JS port of local sfs_mock.py).
// No Workers dependencies here — pure logic, also unit-testable in node.
const T = { NULL:0,BOOL:1,BYTE:2,SHORT:3,INT:4,LONG:5,FLOAT:6,DOUBLE:7,UTF:8,
  BOOL_A:9,BYTE_A:10,SHORT_A:11,INT_A:12,LONG_A:13,FLOAT_A:14,DOUBLE_A:15,
  UTF_A:16,ARR:17,OBJ:18 };

class R {
  constructor(b){ this.b=b; this.o=0; }
  u8(){ return this.b[this.o++]; }
  i16(){ const v=new DataView(this.b.buffer,this.b.byteOffset+this.o,2).getInt16(0); this.o+=2; return v; }
  i32(){ const v=new DataView(this.b.buffer,this.b.byteOffset+this.o,4).getInt32(0); this.o+=4; return v; }
  i64(){ const v=new DataView(this.b.buffer,this.b.byteOffset+this.o,8).getBigInt64(0); this.o+=8; return Number(v); }
  f32(){ const v=new DataView(this.b.buffer,this.b.byteOffset+this.o,4).getFloat32(0); this.o+=4; return v; }
  f64(){ const v=new DataView(this.b.buffer,this.b.byteOffset+this.o,8).getFloat64(0); this.o+=8; return v; }
  utf(){ const n=new DataView(this.b.buffer,this.b.byteOffset+this.o,2).getUint16(0); this.o+=2;
    const s=new TextDecoder().decode(this.b.subarray(this.o,this.o+n)); this.o+=n; return s; }
  raw(n){ const v=this.b.subarray(this.o,this.o+n); this.o+=n; return v; }
}

function decodeValue(r){
  const t=r.u8();
  switch(t){
    case T.NULL: return ['null',null];
    case T.BOOL: return ['bool',r.u8()===1];
    case T.BYTE: return ['byte',r.u8()];
    case T.SHORT: return ['short',r.i16()];
    case T.INT: return ['int',r.i32()];
    case T.LONG: return ['long',r.i64()];
    case T.FLOAT: return ['float',r.f32()];
    case T.DOUBLE: return ['double',r.f64()];
    case T.UTF: return ['utf',r.utf()];
    case T.BYTE_A: { const n=r.i32(); return ['bytes',r.raw(n)]; }
    case T.BOOL_A: case T.SHORT_A: case T.INT_A: case T.LONG_A:
    case T.FLOAT_A: case T.DOUBLE_A: case T.UTF_A: {
      const n=r.i16(), a=[];
      for(let i=0;i<n;i++){
        if(t===T.BOOL_A)a.push(r.u8()===1); else if(t===T.SHORT_A)a.push(r.i16());
        else if(t===T.INT_A)a.push(r.i32()); else if(t===T.LONG_A)a.push(r.i64());
        else if(t===T.FLOAT_A)a.push(r.f32()); else if(t===T.DOUBLE_A)a.push(r.f64());
        else a.push(r.utf());
      }
      return ['arr'+t,a];
    }
    case T.ARR: r.o-=1; return ['sfsarray',decodeArray(r)];
    case T.OBJ: r.o-=1; return ['sfsobject',decodeObj(r)];
    default: return ['unknown'+t,null];
  }
}
function decodeArray(r){
  if(r.u8()!==T.ARR) throw new Error('array marker');
  const n=r.i16(), a=[];
  for(let i=0;i<n;i++) a.push(decodeValue(r));
  return a;
}
export function decodeObj(r){
  if(r.u8()!==T.OBJ) throw new Error('object marker');
  const n=r.i16(), a=[];
  for(let i=0;i<n;i++) a.push([r.utf(),decodeValue(r)]);
  return a;
}
const objGet=(o,k)=>{ const e=o.find(e=>e[0]===k); return e?e[1]:[null,null]; };

// ---- encoder ---------------------------------------------------------------
const te=new TextEncoder();
function u16(n){ const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,n); return b; }
function xe16(n){ const b=new Uint8Array(2); new DataView(b.buffer).setInt16(0,n); return b; }
function xe32(n){ const b=new Uint8Array(4); new DataView(b.buffer).setInt32(0,n); return b; }
function xe64(n){ const b=new Uint8Array(8); new DataView(b.buffer).setBigInt64(0,BigInt(n)); return b; }
function eutf(s){ const b=te.encode(s); return concat(u16(b.length),b); }
function concat(...arrs){ const n=arrs.reduce((s,a)=>s+a.length,0); const o=new Uint8Array(n); let p=0;
  for(const a of arrs){ o.set(a,p); p+=a.length; } return o; }

export function encVal(t,v){
  switch(t){
    case T.NULL: return new Uint8Array([0]);
    case T.BOOL: return new Uint8Array([1,v?1:0]);
    case T.BYTE: return new Uint8Array([2,v]);
    case T.SHORT: return concat(new Uint8Array([3]),xe16(v));
    case T.INT: return concat(new Uint8Array([4]),xe32(v));
    case T.LONG: return concat(new Uint8Array([5]),xe64(v));
    case T.UTF: return concat(new Uint8Array([8]),eutf(v));
    case T.BYTE_A: return concat(new Uint8Array([10]),xe32(v.length),v);
    case T.ARR: return concat(new Uint8Array([17]),u16(v.length),...v.map(([t2,v2])=>encVal(t2,v2)));
    case T.OBJ: {
      const parts=[new Uint8Array([18]),u16(v.length)];
      for(const [k,[t2,v2]] of v) parts.push(eutf(k),encVal(t2,v2));
      return concat(...parts);
    }
    default: throw new Error('enc type '+t);
  }
}
function frame(payloadObj){
  const body=encVal(T.OBJ,payloadObj);
  return concat(new Uint8Array([0x80]),u16(body.length),body);
}
function pkt(c,a,params){
  return frame([['c',[T.BYTE,c]],['a',[T.SHORT,a]],['p',[T.OBJ,params]]]);
}
function extResponse(cmd,code,msg,b,reqId){
  const inner=[['c',[T.INT,code]],['m',[T.UTF,msg]],['b',[T.BYTE_A,b]]];
  if(reqId!==undefined&&reqId!==null) inner.push(['id',[T.INT,reqId]]);
  return pkt(1,13,[['c',[T.UTF,cmd]],['p',[T.OBJ,inner]]]);
}

// ---- tiny protobuf encoder ---------------------------------------------------
function varint(n){ n=Number(n); const o=[]; while(true){ const b=n&0x7F; n=Math.floor(n/128);
  if(n){o.push(b|0x80);} else {o.push(b); break;} } return new Uint8Array(o); }
function dfBOOL(){ return null; }
const vtag=(f,w)=>varint((f<<3)|w);
const vf=(f,n)=>concat(vtag(f,0),varint(n));
const mf=(f,b)=>concat(vtag(f,2),varint(b.length),b);
const sf=(f,s)=>mf(f,typeof s==='string'?te.encode(s):s);
const dff=(f,v)=>{ const b=new Uint8Array(8); new DataView(b.buffer).setFloat64(0,v); return concat(vtag(f,1),b); };
const tsProto=ms=>concat(vtag(1,0),varint(ms));
const itemMsg=(id,sl=0,eq=false,perks=[])=>{
  let b=vf(1,id);
  if(sl) b=concat(b,dff(2,sl));
  if(eq) b=concat(b,vf(3,1));
  for(const [s,p] of perks) b=concat(b,mf(4,concat(vf(1,s),vf(2,p))));
  return b;
};
const STARTER_GEAR=(()=> {
  const items=[itemMsg(1000000),itemMsg(1000002),itemMsg(1000003),
    itemMsg(214,20,true),itemMsg(27,20,true,[[0,3003]]),itemMsg(400,20,true)];
  return concat(...items.map(m=>mf(1,m)));
})();

// ---- battle content ----------------------------------------------------------
// Enemy + fight catalog. Warriors mirror gamedata/User/battles.txt gear;
// custom 900x battles match local battles.js lab_* entries (Bamboo/Gorge/Temple).
function wItem(id) { return vf(1, id); }  // WarriorItemId fields (outer mf(6,.) frames them)
function warrior(alias, gender, appearance, ai, power, gear = []) {
  return concat(sf(1, alias), vf(2, gender), vf(3, appearance), vf(4, ai), dff(5, power),
    ...gear.map(g => mf(6, wItem(g))));
}
function genRound(w) { return mf(2, w); }                          // GeneratedRound{warrior}
function loot(exp, coins) {
  return mf(2, concat(
    mf(1, concat(vf(1, 1), vf(2, coins))),                         // Currency{COIN, value}
    vf(2, exp)));                                                  // Experience
}
function genFight(rounds, rewards) {
  return concat(...rounds.map(r => mf(1, r)), ...rewards.map(l => mf(2, l)));
}
function genBattle(modelId, fights) {
  return concat(vf(1, modelId), ...fights.map(f => mf(2, f)));
}
function battleWrap(g, counter) {
  const now = tsProto(Date.now());
  return concat(mf(1, g), vf(2, counter), vf(3, 0), mf(4, now), mf(5, now));
}
const HAMMERHEAD = () => warrior('CHAR_HAMMERHEAD', 1, 13, 1, 20, [412, 214, 22]);
const OUTCAST = () => warrior('CHAR_OUTCAST', 1, 14, 1, 20, [417, 217, 1000000]);
const SPADE = () => warrior('CHAR_SPADE', 2, 1, 1, 20, [401, 203, 47]);
const MAUL = () => warrior('CHAR_MAUL', 1, 14, 1, 20, [416, 216, 52]);
const AVALANCHE = () => warrior('CHAR_AVALANCHE', 2, 3, 1, 20, [406, 202, 55]);
const RASCAL = () => warrior('CHAR_RASCAL', 1, 15, 1, 20, [411, 201, 44]);
const BOULDER = () => warrior('CHAR_BOULDER', 1, 14, 1, 20, [408, 218, 29]);
const GRETA = () => warrior('CHAR_GRETA', 2, 1, 1, 20, [407, 200, 6]);
const GIZMO = () => warrior('CHAR_GIZMO', 1, 7, 2, 17.5, [409, 200, 4]);
const JUNE = () => warrior('CHAR_JUNE', 2, 10, 2, 17.5, [4013, 215, 35]);
function oneRound(w) { return genFight([genRound(w)], []); }
function story40() {
  return genBattle(40, [oneRound(HAMMERHEAD()), oneRound(OUTCAST()), oneRound(SPADE()),
    oneRound(MAUL()), oneRound(AVALANCHE()), oneRound(BOULDER()), oneRound(RASCAL()), oneRound(GRETA())]);
}
function story1() {
  return genBattle(1, [oneRound(GIZMO()), oneRound(JUNE())]);
}
function custom900x() {
  // NOTE: rounds carry gearless warriors on purpose (see warrior()). The client
  // merge NREs on server-supplied equipment lists; enemies use default gear.
  // Counts/shapes here only need to exist so GetRound() is non-null.
  return [genBattle(9001, [oneRound(HAMMERHEAD())]),
    genBattle(9002, [oneRound(OUTCAST())]), genBattle(9003, [oneRound(JUNE())])];
}
function battleData() {
  const all = [story40(), story1(), ...custom900x()];
  // counter MUST be 0 for fresh battles: MergeWith marks counter>=count as completed+hidden.
  return concat(...all.map(g => mf(1, battleWrap(g, 0))));
}
function playerCurrencies() {
  const c = (t, v) => mf(4, concat(vf(1, t), vf(2, v)));
  return concat(c(1, 5000), c(2, 200), c(3, 50));
}

// ---- session -----------------------------------------------------------------
export function createSession(){
  return { sid:1000000, outbox:[] };
}
function trackIds(st, batchBytes){
  try{
    for(const [f,w,v] of decodeProto(batchBytes)){
      if(w!==2) continue;
      for(const [ff,ww,vv] of decodeProto(v)){
        if(ff===1&&ww===2)
          for(const [g,gw,gv] of decodeProto(vv))
            if(g===1&&gw===0&&gv>st.sid) st.sid=gv;
      }
    }
  }catch(e){}
  return st.sid;
}
export function decodeProto(buf){
  const out=[]; let pos=0;
  const vu=()=>{ let n=0,s=0; for(;;){ const b=buf[pos++]; n|=(b&0x7F)<<s; s+=7; if(!(b&0x80))break; } return n; };
  while(pos<buf.length){
    const k=vu(), f=k>>3, w=k&7;
    if(w===0) out.push([f,w,vu()]);
    else if(w===2){ const n=vu(); out.push([f,w,buf.slice(pos,pos+n)]); pos+=n; }
    else if(w===1){ out.push([f,w,buf.slice(pos,pos+8)]); pos+=8; }
    else if(w===5){ out.push([f,w,buf.slice(pos,pos+4)]); pos+=4; }
    else break;
  }
  return out;
}

// handleSfs(st, payloadBytes) -> responses are queued into st.outbox (Uint8Array packets)
export function handleSfs(st, payload){
  const obj=decodeObj(new R(payload));
  const c=objGet(obj,'c')[1], a=objGet(obj,'a')[1], p=objGet(obj,'p')[1];
  const send=d=>st.outbox.push(d);
  if(c===0&&a===0){
    send(pkt(0,0,[['tk',[T.UTF,'bb-tk-'+Date.now()]],['ct',[T.INT,1000000]],['ms',[T.INT,50000000]]]));
  } else if(c===0&&a===1){
    const pd=Object.fromEntries(p.map(([k,v])=>[k,v]));
    const un=(pd['un']||['utf','guest'])[1];
    send(pkt(0,1,[['rl',[T.ARR,[]]],['id',[T.INT,1]],['un',[T.UTF,String(un)]],
      ['pi',[T.SHORT,1]],['rs',[T.SHORT,0]],['zn',[T.UTF,'sf3']],['p',[T.OBJ,[]]]]));
    const jz=concat(vtag(1,0),new Uint8Array([1]));  // JoinZoneEvent{player_exists=true}
    send(extResponse('join_zone',0,'',jz));
  } else if(c===1&&a===13){
    const pd=Object.fromEntries(p.map(([k,v])=>[k,v]));
    const cmd=pd['c'][1];
    const inner=Object.fromEntries(pd['p'][1].map(([k,v])=>[k,v]));
    const reqId=inner['id']?inner['id'][1]:null;
    const b=inner['b']?inner['b'][1]:new Uint8Array(0);
    if(cmd==='get_player'){
      const sid=trackIds(st,b);
      const shortp=concat(vf(1,7),sf(2,'LocalHero'),sf(3,'LocalHero'),vf(4,1));
      const player=concat(mf(1,mf(1,shortp)),vf(3,50),playerCurrencies(),
        mf(5,new Uint8Array(0)),
        mf(6,mf(2,tsProto(Date.now()))),mf(7,STARTER_GEAR),mf(8,battleData()),
        vf(9,100),vf(10,sid),mf(12,vf(2,424242)));
      send(extResponse('get_player',0,'',mf(1,player),reqId));
    } else if(cmd==='ping'){
      send(extResponse('ping',0,'',concat(mf(1,b),mf(2,tsProto(Date.now()))),reqId));
    } else if(cmd==='refresh_battles'){
      send(extResponse('refresh_battles',0,'',concat(vf(1,st.sid),sf(2,battleData())),reqId));
    } else if(cmd==='log'){
      send(extResponse('log',0,'',new Uint8Array(0),reqId));
    } else if(cmd==='process_offline_batch'){
      const sid=trackIds(st,b);
      send(extResponse('process_offline_batch',0,'',concat(vf(1,sid),sf(2,new Uint8Array(0))),reqId));
    }
    // unknown cmds: logged by caller, no reply (client times out visibly)
  }
  return {c,a};
}
export { T };
