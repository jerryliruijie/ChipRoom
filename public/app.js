import { mountLobbyArt, num, reconcile, reducedMotion, template, text } from './ui.js';
import { mountTable } from './room.js';
import { createPractice, scenarios } from './practice.js';

const main = document.getElementById('main');
const connection = document.getElementById('connection');
const navAction = document.getElementById('nav-action');
const homeLink = document.getElementById('lobby-link');
const dialog = document.getElementById('entry-dialog');
const entryForm = document.getElementById('entry-form');
const endpoint = location.origin === 'https://jerryliruijie.github.io'
  ? 'https://chiproom-table-jrl.jl10124.chatgpt.site/api/rooms' : '/api/rooms';

let session, state, table, entry, transitionOrigin, noticeTimer, practice;
let busy = false, syncing = false, listing = false;
let directory = new Map();
const cleanCode = value => value.trim().toUpperCase();
const savedKey = code => 'chip-room-session-' + code;
function remembered(storage, key) {
  try { return window[storage].getItem(key); } catch { return null; }
}
function remember(storage, key, value) {
  try { window[storage].setItem(key, value); } catch { /* Device storage is optional. */ }
}
function savedSession(code) {
  try {
    const key = savedKey(code);
    const saved = JSON.parse(remembered('sessionStorage', key) || remembered('localStorage', key));
    return saved?.code === code && saved.token ? saved : null;
  } catch { return null; }
}
function locationFor(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (code) url.searchParams.set('room', code);
  return url;
}
function notify(message) {
  const toast = document.getElementById('toast');
  clearTimeout(noticeTimer);
  text(toast, message);
  noticeTimer = setTimeout(() => text(toast, ''), 3200);
}
async function request(path, {auth, body} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = body ? {'Content-Type':'application/json'} : {};
    if (auth) headers.Authorization = 'Bearer ' + auth;
    const response = await fetch(path, {
      method:body ? 'POST' : 'GET', headers, body:JSON.stringify(body), cache:'no-store', signal:controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || '请求失败，请重试'), {status:response.status});
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('暂时无法连接，请重试');
    throw error;
  } finally { clearTimeout(timer); }
}
function showLobby() {
  if (dialog.open) dialog.close();
  table?.destroy();
  table = state = session = transitionOrigin = practice = null;
  directory = new Map();
  connection.hidden = homeLink.hidden = true;
  navAction.hidden = false;
  text(navAction, '凭码加入');
  main.replaceChildren(template('lobby-template'));
  mountLobbyArt(main.querySelector('.mast-art'));
  document.title = '牌桌大厅 · 同桌';
  void refreshDirectory();
}
async function refreshDirectory() {
  const list = document.getElementById('room-list');
  if (!list || listing || session || document.hidden) return;
  const button = document.getElementById('refresh');
  const message = document.getElementById('list-message');
  listing = true;
  button.setAttribute('aria-busy','true');
  try {
    const {rooms} = await request(endpoint);
    if (!list.isConnected) return;
    directory = new Map(rooms.map(room => [room.code, room]));
    reconcile(list, rooms, room => room.code, () => template('room-row-template'), (row, room) => {
      row.dataset.room = room.code;
      text(row.querySelector('strong'), room.host);
      text(row.querySelector('.room-code'), room.code);
      text(row.querySelector('.occupancy span'), room.players + ' / 10');
      row.querySelector('.occupancy').style.setProperty('--filled', room.players * 10 + '%');
      text(row.querySelector('.blinds'), num(room.sb) + ' / ' + num(room.bb));
      row.setAttribute('aria-label','加入' + room.host + '的桌，' + room.players + '人，房间 ' + room.code);
    });
    text(document.getElementById('room-count'), rooms.length);
    message.hidden = rooms.length > 0;
    if (!message.hidden) text(message, '暂无开放牌桌');
  } catch (error) {
    message.hidden = false;
    text(message, error.message);
  } finally {
    listing = false;
    button.removeAttribute('aria-busy');
    if (!list.isConnected && document.getElementById('room-list')) void refreshDirectory();
  }
}
function openEntry(kind, code = '', message = '', origin = null) {
  if (busy || dialog.open) return;
  entry = {kind, code};
  transitionOrigin = origin?.querySelector('.room-code')?.getBoundingClientRect() || origin?.getBoundingClientRect();
  const creating = kind === 'create';
  const room = directory.get(code);
  text(document.getElementById('entry-title'), creating ? '创建房间' : '加入牌桌');
  const context = document.getElementById('entry-context');
  context.hidden = !code;
  text(context, [room && (room.host + ' 的桌'), code].filter(Boolean).join('　/　'));
  document.getElementById('code-field').hidden = creating || !!code;
  entryForm.elements.code.required = !creating && !code;
  entryForm.elements.code.value = code;
  entryForm.elements.name.value = remembered('localStorage','chip-room-nickname') || '';
  text(document.getElementById('entry-error'),message);
  text(document.getElementById('enter'), creating ? '创建房间' : '加入牌桌');
  dialog.showModal();
  const input = !creating && !code && entryForm.elements.name.value ? entryForm.elements.code : entryForm.elements.name;
  input.focus({preventScroll:true});
}
function enterTable(identity, snapshot) {
  session = identity;
  const value = JSON.stringify(identity);
  remember('sessionStorage', savedKey(identity.code), value);
  remember('localStorage', savedKey(identity.code), value);
  if (dialog.open) dialog.close();
  history.replaceState(null,'',locationFor(identity.code));
  update(snapshot);
}
function enterPractice(scenario = 'call') {
  if (busy || session || !Object.hasOwn(scenarios,scenario)) return;
  practice = createPractice(scenario,(state?.version || 0)+1);
  const url = locationFor();
  url.searchParams.set('practice',scenario);
  history.replaceState(null,'',url);
  document.title = scenarios[scenario]+' · 同桌';
  if (table && state?.practice) {
    state = practice.state;
    table.update(state,null);
  } else update(practice.state);
}
async function submitEntry(event) {
  event.preventDefault();
  if (busy) return;
  const name = entryForm.elements.name.value.trim();
  const code = cleanCode(entry.code || entryForm.elements.code.value);
  const errorNode = document.getElementById('entry-error');
  if (!name) { text(errorNode,'请输入昵称'); return; }
  busy = true;
  const submit = document.getElementById('enter');
  submit.disabled = true;
  const originalLabel = submit.textContent;
  text(submit, entry.kind === 'create' ? '正在建桌…' : '正在入座…');
  try {
    const saved = entry.kind === 'join' && savedSession(code);
    if (saved) {
      try {
        const snapshot = await request(endpoint + '/' + encodeURIComponent(code), {auth:saved.token});
        enterTable(saved,snapshot);
        return;
      } catch (error) { if (![401,403,404].includes(error.status)) throw error; }
    }
    const url = entry.kind === 'create' ? endpoint : endpoint + '/' + encodeURIComponent(code) + '/join';
    const data = await request(url,{body:{name}});
    remember('localStorage','chip-room-nickname',name);
    enterTable({code:data.code,token:data.token},data.state);
  } catch (error) { text(errorNode,error.message); }
  finally { busy = false; submit.disabled = false; text(submit,originalLabel); }
}
function update(next) {
  connection.hidden = true;
  if (state && next.version <= state.version) {
    if (next.version === state.version) table?.confirmFeedbackSnapshot(next);
    return;
  }
  const previous = state;
  state = next;
  if (!table) {
    homeLink.hidden = navAction.hidden = false;
    const practice = next.practice === true;
    text(navAction,practice ? '创建房间' : '复制邀请');
    table = mountTable(main,practice ? '体验桌' : session.code,act,notify);
    document.title = (practice ? scenarios[next.scenario] : '房间 ' + session.code) + ' · 同桌';
    window.scrollTo(0,0);
    const plate = document.getElementById('table-code');
    if (transitionOrigin && !reducedMotion()) {
      const dest = plate.getBoundingClientRect();
      const clamp = v => Math.max(-100, Math.min(100,v));
      plate.animate([{transform:'translate('+clamp(transitionOrigin.x-dest.x)+'px,'+clamp(transitionOrigin.y-dest.y)+'px)',opacity:.25},{transform:'none',opacity:1}],{duration:205,easing:'ease-out'});
    }
    transitionOrigin = null;
  }
  table.update(next,previous);
}
async function sync() {
  if (!session || syncing || busy || document.hidden) return;
  syncing = true;
  const current = session;
  try {
    const next = await request(endpoint+'/'+current.code,{auth:current.token});
    if (session === current) update(next);
  } catch (error) {
    if (current !== session) return;
    if ([401,403,404].includes(error.status)) {
      showLobby();
      openEntry('join',current.code,error.message);
    } else {
      table?.interruptFeedback();
      text(connection,'正在重连');
      connection.hidden = false;
    }
  } finally { syncing = false; }
}
async function act(cmd) {
  if (state?.practice) {
    try { update(practice.play(cmd)); }
    catch (error) { notify(error.message); }
    return;
  }
  if (!session || !state || busy) return;
  busy = true;
  table.setBusy(true);
  const current = session;
  try {
    const next = await request(endpoint+'/'+current.code+'/action',{
      auth:current.token, body:{version:state.version,cmd}
    });
    if (session === current) {
      update(next);
      if (cmd.type === 'settings') notify('已保存设置');
    }
  } catch (error) { notify(error.message); }
  finally {
    busy = false;
    if (session === current) { table.setBusy(false); void sync(); }
  }
}
homeLink.addEventListener('click',()=>{
  if (busy) return;
  history.replaceState(null,'',locationFor());
  showLobby();
  window.scrollTo(0,0);
});
navAction.addEventListener('click',async ()=>{
  if (state?.practice) {
    history.replaceState(null,'',locationFor());
    showLobby();
    openEntry('create');
    return;
  }
  if (!session) { openEntry('join','', '',navAction); return; }
  const url = String(locationFor(session.code));
  try { await navigator.clipboard.writeText(url); notify('邀请链接已复制'); }
  catch { window.prompt('复制邀请链接',url); }
});
main.addEventListener('click',event=>{
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.room) openEntry('join',button.dataset.room,'',button);
  if (button.dataset.open === 'create') openEntry('create','','',button);
  if (button.dataset.open === 'practice') enterPractice();
  if (button.id === 'practice-again' && state?.practiceDone) enterPractice(state.scenario);
  if (button.dataset.scenario && state?.practiceDone) enterPractice(button.dataset.scenario);
  if (button.id === 'refresh') void refreshDirectory();
});
entryForm.addEventListener('submit',submitEntry);
document.getElementById('close-entry').addEventListener('click',()=>{ if (!busy) dialog.close(); });
dialog.addEventListener('cancel',event=>{ if (busy) event.preventDefault(); });

const initialCode = cleanCode(new URL(location.href).searchParams.get('room') || '');
const initialScenario = new URL(location.href).searchParams.get('practice');
const saved = initialCode && savedSession(initialCode);
if (saved) {
  session = saved;
  main.textContent = '正在连接牌桌…';
  homeLink.hidden = false;
  navAction.hidden = true;
  void sync();
} else if (!initialCode && Object.hasOwn(scenarios,initialScenario)) {
  enterPractice(initialScenario);
} else {
  showLobby();
  if (initialCode) openEntry('join',initialCode);
}
setInterval(sync,1000);
setInterval(refreshDirectory,4000);
function reconnect() { if (session) void sync(); else void refreshDirectory(); }
window.addEventListener('offline',()=>table?.interruptFeedback());
window.addEventListener('online',reconnect);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden) table?.interruptFeedback();
  else reconnect();
});
