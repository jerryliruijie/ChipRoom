import { createRoom, apply, view } from './engine.mjs';

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function checked(fn) {
  try { return fn(); } catch (e) { throw new RequestError(400,e.message); }
}
const reply = (value,status=200) => Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
}
async function digest(token) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('');
}
function state(room,id,version) { return {...view(room,id),me:id,version}; }
function stale() { return new RequestError(409,'牌桌已有更新，请确认后重试。'); }

export default {
  async fetch(request,env) {
    try {
      const path = new URL(request.url).pathname;
      const route = /^\/api\/rooms(?:\/([A-Z2-9]{6})(?:\/(join|action))?)?$/i.exec(path);
      if (!route) {
        const asset = Object.hasOwn(assets,path === '/' ? '/index.html' : path) && assets[path === '/' ? '/index.html' : path];
        if (!asset) throw new RequestError(404,'找不到此页面。');
        if (!['GET','HEAD'].includes(request.method)) throw new RequestError(405,'请求方式有误。');
        return new Response(request.method==='HEAD'?null:asset[1],{headers:{'content-type':asset[0]+'; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin'}});
      }
      const code = route[1]?.toUpperCase();
      const op = route[2]?.toLowerCase();
      const method = code && !op ? 'GET' : 'POST';
      if (request.method!==method) throw new RequestError(405,'请求方式有误。');
      let body;
      if (method==='POST') {
        const reader=request.body?.getReader();
        if (!reader) throw new RequestError(400,'请求格式有误。');
        const bytes=new Uint8Array(8192);
        let size=0;
        while(true) {
          const {done,value}=await reader.read();
          if(done) break;
          if(size+value.length>bytes.length) throw new RequestError(413,'请求内容太大。');
          bytes.set(value,size); size+=value.length;
        }
        try { body=JSON.parse(new TextDecoder().decode(bytes.subarray(0,size))); }
        catch { throw new RequestError(400,'请求格式有误。'); }
        if (!body || typeof body!=='object' || Array.isArray(body)) throw new RequestError(400,'请求格式有误。');
      }
      const db = env.DB;
      if (!code || op==='join') {
        const id=crypto.randomUUID();
        const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
        const key=await digest(token);
        if (!code) {
          const room=checked(()=>createRoom(id,body.name));
          for(let i=0;i<5;i++) {
            const candidate=makeCode();
            const r=await db.prepare('INSERT OR IGNORE INTO rooms(code,version,room,sessions) VALUES (?,1,?,?)').bind(candidate,JSON.stringify(room),JSON.stringify({[key]:id})).run();
            if(r.meta.changes) return reply({code:candidate,token,state:state(room,id,1)},201);
          }
          throw new RequestError(503,'请重试创建房间。');
        }
        for(let i=0;i<8;i++) {
          const row=await db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();
          if(!row) throw new RequestError(404,'房间不存在，请核对房间号。');
          const room=JSON.parse(row.room);
          checked(()=>apply(room,id,{type:'join',name:body.name}));
          const sessions=JSON.parse(row.sessions);
          sessions[key]=id;
          const r=await db.prepare('UPDATE rooms SET version=version+1,room=?,sessions=? WHERE code=? AND version=?').bind(JSON.stringify(room),JSON.stringify(sessions),code,row.version).run();
          if(r.meta.changes) return reply({code,token,state:state(room,id,row.version+1)},201);
        }
        throw stale();
      }
      const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1];
      if (!token) throw new RequestError(401,'请先加入房间。');
      const row=await db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();
      if(!row) throw new RequestError(404,'房间不存在。');
      const id=JSON.parse(row.sessions)[await digest(token)];
      if(!id) throw new RequestError(401,'请先加入房间。');
      const room=JSON.parse(row.room);
      if(method==='GET') return reply(state(room,id,row.version));
      if(body.version!==row.version) throw stale();
      if(!body.cmd || typeof body.cmd.type!=='string' || body.cmd.type==='join') throw new RequestError(400,'无效操作。');
      checked(()=>apply(room,id,body.cmd));
      const r=await db.prepare('UPDATE rooms SET version=version+1,room=? WHERE code=? AND version=?').bind(JSON.stringify(room),code,row.version).run();
      if(!r.meta.changes) throw stale();
      return reply(state(room,id,row.version+1));
    } catch(e) {
      if(!(e instanceof RequestError)) console.error(e);
      return reply({error:e instanceof RequestError?e.message:'服务暂时无法处理请求。'},e instanceof RequestError?e.status:500);
    }
  }
};

