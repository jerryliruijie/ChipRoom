import test from 'node:test';
import assert from 'node:assert/strict';
import { savedSeats, savedSession, rememberSeat, forgetSeat } from './public/saved-seats.js';

class BrowserStore extends Map {
  get length() { return this.size; }
  key(i) { return Array.from(this.keys())[i]; }
  getItem(key) { return this.get(key) ?? null; }
  setItem(key,value) { this.set(key,value); }
  removeItem(key) { this.delete(key); }
}
const room = {me:'h',hostId:'h',players:[{id:'h',name:'小林'}]};

test('lobby finds old seats, preserves leading zeros and respects tab-specific credentials', () => {
  const sessionStorage = new BrowserStore(), localStorage = new BrowserStore();
  globalThis.window = {sessionStorage,localStorage};
  const key='chip-room-session-ABC234', old={code:'ABC234',token:'original-tab'};
  localStorage.setItem(key,JSON.stringify({...old,token:'second-tab'}));
  sessionStorage.setItem(key,JSON.stringify(old));
  localStorage.setItem('chip-room-session-BROKEN','{');
  assert.deepEqual(savedSeats(),[old]);
  rememberSeat({code:'0042',token:'fresh'},room);
  const [newest,older]=savedSeats();
  assert.deepEqual([newest.code,newest.name,newest.isHost,newest.host],['0042','小林',true,'小林']);
  assert.deepEqual(older,old);
  forgetSeat(old);
  assert.equal(savedSession('ABC234').token,'second-tab');
  forgetSeat(savedSession('ABC234'));
  assert.deepEqual(savedSeats().map(s=>s.code),['0042']);
  forgetSeat(newest);
  delete globalThis.window;
});

test('a seat survives a trip to the lobby even when persistent storage is unavailable', () => {
  globalThis.window = {get sessionStorage(){throw Error('unavailable')},get localStorage(){throw Error('unavailable')}};
  rememberSeat({code:'0000',token:'this-page'},room);
  assert.equal(savedSeats()[0].token,'this-page');
  forgetSeat(savedSession('0000'));
  assert.deepEqual(savedSeats(),[]);
  delete globalThis.window;
});
