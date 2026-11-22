import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import handler from './worker.mjs';

test('云端房间独立身份、并发入桌和重复扣注保护', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./drizzle/0000_rooms.sql',import.meta.url),'utf8'));
  const env = {DB:{prepare(sql) {
    const statement = db.prepare(sql);
    return {bind(...args) { return {
      async first() { return statement.get(...args); },
      async all() { return {results:statement.all(...args)}; },
      async run() { return {meta:statement.run(...args)}; }
    }; }};
  }}};
  function api(path,body,token) {
    return handler.fetch(new Request('https://example.test/api/rooms'+path,{
      method:body?'POST':'GET', headers:token?{authorization:'Bearer '+token}:{},
      body:body?JSON.stringify(body):undefined
    }),env);
  }
  const host=await (await api('',{name:'甲'})).json();
  const path='/'+host.code;
  const origin='https://jerryliruijie.github.io';
  const list=()=>handler.fetch(new Request('https://example.test/api/rooms',{headers:{Origin:origin}}),env);
  const lobby=await list();
  assert.equal(lobby.headers.get('access-control-allow-origin'),origin);
  assert.deepEqual((await lobby.json()).rooms,[{code:host.code,host:'甲',players:1,sb:5,bb:10}]);
  const guests=await Promise.all(['乙','丙'].map(async name=> (await api(path+'/join',{name})).json()));
  assert.ok(guests.every(p=>p.token));
  const state=await (await api(path,null,host.token)).json();
  assert.equal(state.players.length,3);
  const body={version:state.version,cmd:{type:'start'}};
  const responses=await Promise.all([api(path+'/action',body,host.token),api(path+'/action',body,host.token)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const synced=await (await api(path,null,guests[0].token)).json();
  assert.equal(synced.pot,15);
  assert.deepEqual((await (await list()).json()).rooms,[]);
  assert.equal(synced.me,guests[0].state.me);
  assert.equal((await api(path,null)).status,401);
  db.close();
});

