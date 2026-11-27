import { createRoom, apply, view } from './engine.mjs';
import { roomRoute, formatCode, randomRoomNumber, noRoomCodes } from './room-codes.mjs';

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function checked(fn) {
  try { return fn(); } catch (e) { throw new RequestError(400,e.message); }
}
const reply = (value,status=200) => Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function digest(token) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('');
}
function state(room,id,version) { return {...view(room,id),me:id,version}; }
function stale() { return new RequestError(409,'牌桌已有更新，请确认后重试。'); }

export default {
  async fetch(request,env) {
    const origin = 'https://jerryliruijie.github.io';
    const external = request.headers.get('Origin') === origin;
    const cors = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'};
    if (external && request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    const response = await handleRequest(request,env);
    if (external) for (const [key,value] of Object.entries(cors)) response.headers.set(key,value);
    return response;
  }
};
async function handleRequest(request,env) {
    try {
      const path = new URL(request.url).pathname;
      const route = roomRoute.exec(path);
      if (!route) {
        const assetPath = path === '/' ? '/index.html' : path;
        const asset = typeof assets !== 'undefined' && Object.hasOwn(assets,assetPath) && assets[assetPath];
        if (!asset) throw new RequestError(404,'找不到此页面。');
        if (!['GET','HEAD'].includes(request.method)) throw new RequestError(405,'请求方式有误。');
        return new Response(request.method==='HEAD'?null:asset[1],{headers:{'content-type':asset[0]+'; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin'}});
      }
      const code = route[1]?.toUpperCase();
      const op = route[2]?.toLowerCase();
      if (!code && request.method === 'GET') {
        const query = `SELECT code,
          (SELECT json_extract(value,'$.name') FROM json_each(room,'$.players')
           WHERE json_extract(value,'$.id')=json_extract(room,'$.hostId')) AS host,
          json_array_length(room,'$.players') AS players, json_extract(room,'$.settings.sb') AS sb,
          json_extract(room,'$.settings.bb') AS bb
          FROM rooms WHERE json_extract(room,'$.phase')='lobby' AND json_array_length(room,'$.players')<10
          AND json_extract(room,'$.listedAt')>? ORDER BY json_extract(room,'$.listedAt') DESC`;
        const {results} = await env.DB.prepare(query).bind(Date.now()-86400000).all();
        return reply({rooms:results.map(({code,host,players,sb,bb})=>({code,host,players,sb,bb}))});
      }
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
          room.listedAt=Date.now();
          const first = formatCode(randomRoomNumber());
          const payload = JSON.stringify(room), sessions = JSON.stringify({[key]:id});
          const insert = await db.prepare('INSERT INTO rooms(code,version,room,sessions) VALUES (?,1,?,?) ON CONFLICT(code) DO NOTHING')
            .bind(first,payload,sessions).run();
          let assigned = first;
          if (!insert.meta.changes) {
            // Every free range begins at 0000 or immediately after an occupied code.
            // Find and claim its first slot within a single SQLite write statement.
            const row = await db.prepare(`WITH candidates(candidate) AS (
              SELECT '0000'
              UNION ALL
              SELECT printf('%04d', CAST(code AS INTEGER)+1) FROM rooms
              WHERE code GLOB '[0-9][0-9][0-9][0-9]' AND code < '9999'
            )
            INSERT INTO rooms(code,version,room,sessions)
            SELECT candidate,1,?,? FROM candidates
            WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE code=candidate)
            ORDER BY candidate < ?, candidate LIMIT 1
            RETURNING code`).bind(payload,sessions,first).first();
            if (!row) throw new RequestError(503,noRoomCodes);
            assigned = row.code;
          }
          return reply({code:assigned,token,state:state(room,id,1)},201);
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

