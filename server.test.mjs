import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from './server.mjs';

test('independent devices share seats and actions, reject stale writes, and reconnect after restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'chip-room-test-'));
  let server;
  let base;
  async function start() {
    server = createServer({ dataDir });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  function stop() {
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => {
    if (server?.listening) await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  async function request(path, body, token) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  await start();
  const { data: host, status: created } = await request('/api/rooms', { name: '房主' });
  assert.equal(created, 201);
  assert.match(host.code,/^\d{4}$/);
  const path = '/api/rooms/' + host.code;
  const { data: guest, status: joined } = await request(path + '/join', { name: '朋友' });
  assert.equal(joined, 201);
  assert.notEqual(host.state.me, guest.state.me);
  assert.equal((await request(path)).status, 401);
  const snapshot = await request(path, undefined, host.token);
  assert.equal(snapshot.data.version, 2);
  assert.equal(snapshot.data.players.length, 2);
  assert.ok(!JSON.stringify(snapshot.data).includes(guest.token));
  const act = (token, version, cmd) => request(path + '/action', { version, cmd }, token);
  assert.equal((await act(guest.token, 2, { type: 'start' })).status, 400);
  const starts = await Promise.all([act(host.token, 2, { type: 'start' }), act(host.token, 2, { type: 'start' })]);
  assert.deepEqual(starts.map(s => s.status).sort(), [200, 409]);
  const beforeRestart = await request(path, undefined, guest.token);
  assert.equal(beforeRestart.data.version, 3);
  assert.equal(beforeRestart.data.phase, 'betting');
  assert.equal(beforeRestart.data.turn, host.state.me);
  assert.ok(!(await readFile(join(dataDir, host.code + '.json'), 'utf8')).includes(host.token));
  await stop();
  await start();
  assert.deepEqual((await request(path, undefined, guest.token)).data, beforeRestart.data);
  assert.equal((await act(host.token, 3, { type: 'fold' })).status, 200);
  assert.equal((await request(path, undefined, guest.token)).data.version, 4);
});

test('本地前导零、同时撞号、已有六位邀请和凭证', async t => {
  const dataDir=await mkdtemp(join(tmpdir(),'chip-room-codes-'));
  const server=createServer({dataDir});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await rm(dataDir,{recursive:true,force:true});
  });
  const random=crypto.getRandomValues.bind(crypto);
  t.mock.method(crypto,'getRandomValues',buffer=>buffer instanceof Uint32Array ? buffer.fill(0) : random(buffer));
  async function api(path='',body,token) {
    return fetch('http://127.0.0.1:'+server.address().port+'/api/rooms'+path,{
      method:body?'POST':'GET',headers:token?{authorization:'Bearer '+token}:{},body:body?JSON.stringify(body):undefined
    });
  }
  const host=await (await api('',{name:'保留原桌'})).json();
  assert.equal(host.code,'0000');
  const created=await Promise.all(['甲','乙','丙'].map(async name=>(await api('',{name})).json()));
  assert.deepEqual(created.map(r=>r.code).sort(),['0001','0002','0003']);
  assert.equal((await api('/0000',null,'0000')).status,401);
  assert.equal((await api('/0000',null,created[0].token)).status,401);
  for (const old of ['A2BC9Q','002301']) {
    await copyFile(join(dataDir,'0000.json'),join(dataDir,old+'.json'));
    assert.deepEqual(await (await api('/'+old.toLowerCase(),null,host.token)).json(),host.state);
    const listed=await (await api()).json();
    assert.ok(listed.rooms.some(room=>room.code===old));
    assert.equal((await api('/'+old+'/join',{name:'重聚'})).status,201);
    assert.equal((await api('/'+old+'/action',{version:2,cmd:{type:'start'}},host.token)).status,200);
  }
  assert.deepEqual(await (await api('/0000',null,host.token)).json(),host.state);
  assert.equal((await api('/00000')).status,404);
});

