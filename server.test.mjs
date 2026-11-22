import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

