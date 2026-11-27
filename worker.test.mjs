import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import handler from './worker.mjs';

function databaseFixture() {
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
  return {db, env, api};
}

test('云端房间独立身份、并发入桌和重复扣注保护', async () => {
  const {db, env, api}=databaseFixture();
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

test('云端四位码碰撞、并发、旧身份及最后一个空位', async t => {
  const {db,api}=databaseFixture();
  t.after(()=>db.close());
  const random=crypto.getRandomValues.bind(crypto);
  t.mock.method(crypto,'getRandomValues',buffer=>buffer instanceof Uint32Array ? buffer.fill(0) : random(buffer));
  const create=async name=>{
    const response=await api('',{name});
    assert.equal(response.status,201);
    return response.json();
  };
  const host=await create('原房主');
  assert.equal(host.code,'0000');
  const others=await Promise.all(['甲','乙','丙'].map(create));
  assert.deepEqual(others.map(room=>room.code).sort(),['0001','0002','0003']);
  assert.equal((await api('/0000',null,others[0].token)).status,401);
  assert.equal((await api('/0000',null,'0000')).status,401);
  const data=await (await api('/0000',null,host.token)).json();
  assert.equal(data.me,host.state.me);

  for (const old of ['A2BC9Q','002301']) {
    db.prepare('INSERT INTO rooms SELECT ?,version,room,sessions FROM rooms WHERE code=?').run(old,'0000');
    const linked=await (await api('/'+old.toLowerCase(),null,host.token)).json();
    assert.deepEqual(linked,data);
    assert.equal((await api('/'+old+'/join',{name:'老桌来客'})).status,201);
    assert.equal((await api('/'+old+'/action',{version:2,cmd:{type:'start'}},host.token)).status,200);
  }
  assert.equal((await api('/00000')).status,404);
  // Hold 9,999 of the 10,000 slots, including old/inactive rooms.
  db.exec(`WITH RECURSIVE ids(i) AS (VALUES (0) UNION ALL SELECT i+1 FROM ids WHERE i<9998)
    INSERT OR IGNORE INTO rooms SELECT printf('%04d',i),1,'{}','{}' FROM ids`);
  const [last, full]= (await Promise.all([api('',{name:'最后甲'}),api('',{name:'最后乙'})])).sort((a,b)=>a.status-b.status);
  assert.equal(last.status,201);
  assert.equal((await last.json()).code,'9999');
  assert.equal(full.status,503);
  assert.match((await full.json()).error,/房间码已全部使用/);
  assert.deepEqual(await (await api('/0000',null,host.token)).json(),data);
});

