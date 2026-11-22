import { createServer as httpServer } from 'node:http';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createRoom, apply, view } from './engine.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'application/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);
const hash = token => createHash('sha256').update(token).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw fail(413, '请求内容太大。');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* Respond uniformly to malformed bodies. */ }
  throw fail(400, '请求格式有误。');
}

function checked(operation) {
  try { return operation(); }
  catch (error) { throw fail(400, error.message); }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function snapshot(room, id) {
  return { ...view(room, id), me: id, version: room.version };
}

export function createServer({ dataDir = join(root, 'data') } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const rooms = new Map();
  function load(code) {
    if (!rooms.has(code)) {
      try { rooms.set(code, JSON.parse(readFileSync(join(dataDir, code + '.json'), 'utf8'))); }
      catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    }
    return rooms.get(code);
  }
  function save(code, record) {
    // Persist and publish the new version in one synchronous critical section.
    const target = join(dataDir, code + '.json');
    const temporary = target + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flush: true });
    renameSync(temporary, target);
    rooms.set(code, record);
  }
  return httpServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      const asset = assets.get(path);
      if (asset && ['GET', 'HEAD'].includes(request.method)) {
        const data = readFileSync(join(root, 'public', asset[0]));
        response.writeHead(200, { 'content-type': asset[1] + '; charset=utf-8', 'cache-control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : data);
        return;
      }
      const route = /^\/api\/rooms(?:\/([A-Z2-9]{6})(?:\/(join|action))?)?$/i.exec(path);
      if (!route) throw fail(404, '找不到此页面。');
      let code = route[1]?.toUpperCase();
      const operation = route[2]?.toLowerCase();
      const method = code && !operation ? 'GET' : 'POST';
      if (request.method !== method) throw fail(405, '请求方式有误。');
      const body = method === 'POST' ? await readBody(request) : null;
      const previous = code && load(code);
      if (code && !previous) throw fail(404, '房间不存在，请核对房间号。');
      if (!code || operation === 'join') {
        if (typeof body.name !== 'string' || !body.name.trim()) throw fail(400, '请输入昵称。');
        const id = randomUUID();
        const token = randomBytes(32).toString('base64url');
        let record;
        if (code) {
          record = structuredClone(previous);
          checked(() => apply(record.room, id, { type: 'join', name: body.name }));
          record.room.version++;
        } else {
          do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (load(code));
          record = { room: checked(() => createRoom(id, body.name)), sessions: {} };
          record.room.version = 1;
        }
        record.sessions[hash(token)] = id;
        save(code, record);
        json(response, 201, { code, token, state: snapshot(record.room, id) });
        return;
      }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || '')?.[1];
      const id = token && previous.sessions[hash(token)];
      if (!id) throw fail(401, '此设备还未加入房间。');
      if (method === 'GET') {
        json(response, 200, snapshot(previous.room, id));
        return;
      }
      if (body.version !== previous.room.version) throw fail(409, '牌桌已有更新，请确认当前状态再行动。');
      if (!body.cmd || typeof body.cmd !== 'object' || typeof body.cmd.type !== 'string' || body.cmd.type === 'join') {
        throw fail(400, '无效操作。');
      }
      const updated = structuredClone(previous);
      checked(() => apply(updated.room, id, body.cmd));
      updated.room.version++;
      save(code, updated);
      json(response, 200, snapshot(updated.room, id));
    } catch (error) {
      if (!error.status) console.error(error);
      json(response, error.status || 500, { error: error.status ? error.message : '服务暂时无法处理请求。' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4174);
  const server = createServer({ dataDir: process.env.CHIP_ROOM_DATA_DIR });
  server.listen(port, '0.0.0.0', () => {
    const addresses = Object.values(networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal);
    for (const address of ['localhost', ...addresses.map(item => item.address)]) {
      console.log('http://' + address + ':' + server.address().port);
    }
  });
}

