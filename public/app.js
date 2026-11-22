'use strict';

const main = document.querySelector('#main');
const connection = document.querySelector('#connection');
const endpoint = location.origin === 'https://jerryliruijie.github.io'
  ? 'https://chiproom-table-jrl.jl10124.chatgpt.site/api/rooms' : '/api/rooms';
const labels = {preflop:'翻牌前', flop:'翻牌圈', turn:'转牌圈', river:'河牌圈'};
const phases = {lobby:'准备中',betting:'下注中',showdown:'摊牌结算',complete:'本手结束'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number(value || 0).toLocaleString('zh-CN');
const cleanCode = value => String(value || '').trim().toUpperCase();
const roomUrl = code => {
  const url = new URL(location.href);
  url.search = ''; url.hash = '';
  if (code) url.searchParams.set('room', code);
  return url;
};
let session = null;
let state = null;
let mode = 'create';
let busy = false;
let getting = false;
let noteTimer;
const getName = id => state.players.find(p => p.id === id)?.name || '—';
const isHost = () => state.me === state.hostId;
const savedKey = code => 'chip-room-session-' + code;
function readSaved(code) {
  try { return JSON.parse((sessionStorage.getItem(savedKey(code)) || localStorage.getItem(savedKey(code)) || 'null')); }
  catch { return null; }
}
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function recall(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function notify(message) {
  clearTimeout(noteTimer);
  document.querySelector('#toast').textContent = message;
  noteTimer = setTimeout(() => { document.querySelector('#toast').textContent = ''; }, 3600);
}
function status(online, message) {
  connection.hidden = !session;
  connection.dataset.online = String(online);
  connection.textContent = message;
}
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const headers = options.body ? {'Content-Type':'application/json'} : {};
    if (options.auth) headers.Authorization = 'Bearer ' + options.auth;
    const response = await fetch(path, {method:options.body ? 'POST' : 'GET', headers, cache:'no-store',
      body: options.body ? JSON.stringify(options.body) : undefined, signal:controller.signal});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || '请求失败，请重试');
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('连接暂时中断，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); }
}
function showEntrance(code = '', message = '') {
  session = null; state = null; connection.hidden = true;
  main.replaceChildren(document.querySelector('#home').content.cloneNode(true));
  [...main.querySelectorAll('.stack')].forEach((stack, i) => {
    for (let j=0; j<[6,8,4,2][i]; j++) {
      const disc = document.createElement('i'); disc.className='disc'; disc.style.setProperty('--i',j); stack.append(disc);
    }
  });
  main.querySelector('[name=name]').value = recall('chip-room-nickname');
  main.querySelector('[name=code]').value = code;
  const directory = document.createElement('section');
  directory.className = 'panel directory';
  directory.innerHTML = '<h2>房间大厅</h2><p class="muted" id="room-list">正在查找可加入的牌桌…</p>';
  main.append(directory);
  void refreshDirectory();
  changeMode(code ? 'join' : 'create');
  main.querySelector('#entry-error').textContent = message;
}
let listing = false;
async function refreshDirectory() {
  const list = document.querySelector('#room-list');
  if (!list || listing || session || document.hidden) return;
  listing = true;
  try {
    const {rooms} = await request(endpoint);
    list.innerHTML = rooms.length ? rooms.map(r => '<button type="button" class="secondary lobby-room" data-room="'+escape(r.code)+'"><strong>'+escape(r.host)+' 的桌</strong><span>'+escape(r.code)+' · '+num(r.players)+'/10 人 · 盲注 '+num(r.sb)+'/'+num(r.bb)+'</span></button>').join('') : '暂时没有可加入的牌桌，你可以创建第一桌。';
  } catch { list.textContent = '暂时无法加载房间，稍后会自动重试。'; }
  finally { listing = false; }
}
setInterval(refreshDirectory, 4000);
function changeMode(newMode) {
  mode = newMode;
  const join = mode === 'join';
  main.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mode === mode)));
  main.querySelector('#code-field').hidden = !join;
  main.querySelector('[name=code]').required = join;
  main.querySelector('#entry-note').textContent = join ? '进入后，按现实中的座位顺序入座。' : '新桌会显示在公开大厅，朋友可以直接选择加入。';
  main.querySelector('#enter').textContent = join ? '加入牌桌' : '创建房间';
  main.querySelector('#entry-error').textContent = '';
}
function saveIdentity(code, token) {
  session = {code,token};
  const value = JSON.stringify(session);
  try { sessionStorage.setItem(savedKey(code),value); } catch {}
  remember(savedKey(code),value);
  history.replaceState(null,'',roomUrl(code));
}
async function enter(form) {
  const name = form.elements.name.value.trim();
  const code = cleanCode(form.elements.code.value);
  const errorLine = form.querySelector('#entry-error');
  if (!name) { errorLine.textContent='请输入昵称'; return; }
  if (busy) return;
  busy=true;
  const selectedMode=mode;
  form.querySelector('button').disabled=true;
  main.querySelectorAll('[data-mode]').forEach(button => button.disabled=true);
  try {
    const saved = selectedMode === 'join' && readSaved(code);
    if (saved?.code === code && saved.token) {
      try {
        const restored = await request(endpoint + '/' + encodeURIComponent(code),{auth:saved.token});
        saveIdentity(code,saved.token); update(restored); return;
      } catch (e) { if (![401,403,404].includes(e.status)) throw e; }
    }
    const url = selectedMode === 'create' ? endpoint : endpoint + '/' + encodeURIComponent(code) + '/join';
    const data = await request(url,{body:{name}});
    saveIdentity(data.code,data.token); remember('chip-room-nickname',name); update(data.state);
  } catch(error) { errorLine.textContent=error.message; }
  finally { busy=false; if (!session) { form.querySelector('button').disabled=false;main.querySelectorAll('[data-mode]').forEach(button=>button.disabled=false); } }
}
function update(next) {
  status(true,'已同步');
  if (state && state.version >= next.version) return;
  const previous = state;
  state = next;
  renderRoom(previous);
}
async function sync() {
  if (!session || getting || busy) return;
  getting = true;
  const current = session;
  try {
    const latest=await request(endpoint+'/'+encodeURIComponent(current.code),{auth:current.token});
    if (current===session) update(latest);
  } catch (error) {
    if (current !== session) return;
    if ([401,403,404].includes(error.status)) {showEntrance(current.code,error.message);return;}
    status(false,'正在重新连接');
  } finally {getting=false;}
}
async function act(cmd) {
  if (busy || !state || !session) return;
  busy=true;
  const current=session;
  main.querySelectorAll('button[data-act], form button, #seat').forEach(el => el.disabled=true);
  try {
    const next=await request(endpoint+'/'+encodeURIComponent(current.code)+'/action',{auth:current.token,body:{version:state.version,cmd}});
    if (current === session) update(next);
  } catch(error) {
    if (current===session) notify(error.message);
  } finally {
    busy=false;
    if (current === session) {renderRoom(state);void sync();}
  }
}
function seatPosition(i,n,mobile) {
  if(n===1) return [50,15];
  if(n===2) return [50,i===0?15:85];
  if(!mobile) {
    const angle=i*2*Math.PI/n-Math.PI/2;
    return [50+39*Math.cos(angle),50+39*Math.sin(angle)];
  }
  if(i===0) return [50,10];
  const right=Math.floor((n-2)/2);
  if(i<=right) return [81,12+(i/(right+1))*76];
  if(i===right+1) return [50,89];
  const left=n-2-right;
  return [19,88-((i-right-1)/(left+1))*76];
}
function playerTags(p) {
  return [p.id===state.dealer?'D':'',p.id===state.sbId?'SB':'',p.id===state.bbId?'BB':''].filter(Boolean).join('/');
}
function table() {
  const n=state.players.length, lobby=state.phase==='lobby';
  const seats=state.players.map((p,i)=>{
    const [x,y]=seatPosition(i,n,false), [mx,my]=seatPosition(i,n,true);
    const folded=!lobby && (p.folded || !p.inHand);
    const tag=folded ? (p.folded?'已弃牌':'未入局') : !lobby && p.stack===0 ? '全下' : playerTags(p);
    return '<div class="seat '+(p.id===state.me?'mine ':'')+(p.id===state.turn?'current ':'')+(folded?'dim':'')+'" style="--x:'+x+'%;--y:'+y+'%;--mx:'+mx+'%;--my:'+my+'%"><b>'+escape(p.name)+'</b><strong>'+num(lobby?state.settings.stack:p.stack)+'</strong><small>'+escape([i+1+'号',tag].filter(Boolean).join(' · '))+'</small></div>';
  }).join('');
  const center=lobby?'<small>已入座</small><strong>'+n+' 人</strong>':'<small>底池</small><strong>'+num(state.pot)+'</strong>';
  return '<section class="felt" aria-label="座位与筹码"><div class="seats" style="--h:'+Math.max(268,n*36)+'px;--mh:'+Math.max(240,n*45)+'px"><div class="pot">'+center+'</div>'+seats+'</div><div class="meta"><span>'+escape(lobby?'等待开局':labels[state.street]||'本手结束')+'</span><span>小盲 / 大盲　'+num(state.settings.sb)+' / '+num(state.settings.bb)+'</span></div></section>';
}
function playerList() {
  const lobby=state.phase==='lobby';
  const rows=state.players.map((p,i)=>{
    const tags=[p.id===state.me?'我':'',p.id===state.hostId?'房主':''].filter(Boolean).join(' · ');
    const right=lobby?tags:[p.folded?'弃牌':p.bet?'本轮已下 '+num(p.bet):'',tags].filter(Boolean).join(' · ');
    return '<li><span class="n">'+(i+1)+'</span><b>'+escape(p.name)+'</b><small>'+escape(right)+'</small></li>';
  }).join('');
  let seatSelect='';
  if(lobby) {
    const options=state.players.map((p,i)=>'<option value="'+i+'" '+(p.id===state.me?'selected':'')+'>'+(i+1)+' 号座</option>').join('');
    seatSelect='<label>我的座位<select id="seat">'+options+'</select></label>';
  }
  return '<section class="panel"><h2>座位顺序</h2>'+seatSelect+'<ol class="list">'+rows+'</ol></section>';
}
function settings() {
  const cfg=state.settings;
  if (!isHost()) return '<section class="panel"><h2>牌桌设置</h2><p>初始筹码　<strong>'+num(cfg.stack)+'</strong></p><p class="muted">房主设置盲注与初始筹码，所有人入座后开局。</p></section>';
  const fields=[['stack','初始筹码'],['sb','小盲'],['bb','大盲']].map(([key,label])=>'<label>'+label+'<input name="'+key+'" type="number" min="1" step="1" required value="'+escape(cfg[key])+'"></label>').join('');
  return '<section class="panel"><h2>牌桌设置</h2><form id="settings"><div class="fields">'+fields+'</div><button class="secondary">保存设置</button></form></section>';
}
function turnPanel() {
  const actions=state.actions;
  if(!actions) return '<section class="panel"><h2>等待行动</h2><p>轮到 <strong>'+escape(getName(state.turn))+'</strong>。</p></section>';
  const btn=(cmd,text,cls)=>'<button type="button" class="'+cls+'" data-act="'+cmd+'">'+text+'</button>';
  let raise='';
  if(actions.raise) {
    const min=actions.minRaiseTo,max=actions.maxRaiseTo;
    raise='<form class="raise" id="raise"><label for="raise-to">加注到（本轮总额）</label><div class="row"><input type="number" inputmode="numeric" step="1" id="raise-to" name="to" required min="'+min+'" max="'+max+'" value="'+min+'"><button class="secondary">确认加注</button></div><p class="muted">可选 '+num(min)+' 至 '+num(max)+'</p></form>';
  }
  const choices=[actions.fold?btn('fold','弃牌','danger'):'',actions.check?btn('check','过牌','primary'):'',actions.call>0?btn('call','跟注 '+num(actions.call),'primary'):''].join('');
  return '<section class="panel"><h2>轮到你行动</h2><div class="actions">'+choices+'</div>'+raise+'</section>';
}
function settlement() {
  if(!isHost())return '<section class="panel"><h2>摊牌结算</h2><p>请在线下比较牌型，由房主确认各底池赢家。</p></section>';
  const pots=state.pots.map((pot,i)=>{
    const choices=pot.eligible.map(id=>'<label class="choice"><input type="checkbox" name="pot'+i+'" value="'+escape(id)+'" '+(pot.eligible.length===1?'checked disabled':'')+'>'+escape(getName(id))+'</label>').join('');
    return '<fieldset><legend>'+(i?'边池 '+i:'主池')+' · '+num(pot.amount)+'</legend>'+choices+'</fieldset>';
  }).join('');
  return '<section class="panel"><h2>分配底池</h2><p class="muted">按线下牌面勾选每个底池的赢家。平局时可勾选多人。</p><form id="award">'+pots+'<button class="primary">确认分配筹码</button></form></section>';
}
function controls() {
  if(state.phase==='betting') return turnPanel();
  if(state.phase==='showdown') return settlement();
  const lobby=state.phase==='lobby';
  const count=lobby?state.players.length:state.players.filter(p=>p.stack>0).length;
  const title=lobby?'准备开局':'本手结束';
  const hint=lobby?'按现实座位顺时针排列；至少两人入座即可开始。':count<2?'仅剩一位玩家持有筹码，本桌已结束。':'下一手将轮换庄位并自动下盲注。';
  const start=isHost()&&count>=2?'<button class="primary" data-act="start">'+(lobby?'开始第一手':'开始下一手')+'</button>':'';
  return '<section class="panel"><h2>'+title+'</h2><p class="muted">'+hint+'</p>'+start+'</section>';
}
function renderRoom(previous) {
  const draft=new Map();
  const keep=previous?.phase===state.phase && previous.hand===state.hand;
  if(keep) main.querySelectorAll('#settings input,#raise input,#award input').forEach(el=>{
    const key=el.name+(el.type==='checkbox'?el.value:'');
    if(el.type==='checkbox'?el.checked!==el.defaultChecked:el.value!==el.defaultValue) draft.set(key,el.type==='checkbox'?el.checked:el.value);
  });
  const opened=main.querySelector('details')?.open;
  const focus=main.contains(document.activeElement)?document.activeElement?.name:null;
  const title=state.phase==='lobby'?'房间准备':'第 '+state.hand+' 手';
  const logs=(state.log||[]).slice().reverse().map(line=>'<li>'+escape(line)+'</li>').join('');
  main.innerHTML='<div class="heading"><div><h1>'+title+'</h1><p class="muted">房间 <b>'+escape(session.code)+'</b> · '+escape(phases[state.phase])+'</p></div><div class="row"><button class="secondary" data-share>复制邀请链接</button><button class="back" data-home>返回首页</button></div></div><div class="room"><div class="column">'+table()+controls()+'</div><div class="column">'+(state.phase==='lobby'?settings():'')+playerList()+'<details class="panel" '+(opened?'open':'')+'><summary>牌桌记录</summary><ol class="logs">'+(logs||'<li>等待开局</li>')+'</ol></details></div></div>';
  main.querySelectorAll('#settings input,#raise input,#award input').forEach(el=>{
    const key=el.name+(el.type==='checkbox'?el.value:'');
    if(draft.has(key)) {
      if(el.type==='checkbox')el.checked=draft.get(key);else el.value=draft.get(key);
    }
    if(focus && el.name===focus && el.type!=='checkbox') el.focus({preventScroll:true});
  });
}
main.addEventListener('click',async event=>{
  const b=event.target.closest('button');
  if(!b) return;
  if(b.dataset.room && !busy) {
    changeMode('join');
    const form=document.querySelector('#entry-form');
    form.elements.code.value=b.dataset.room;
    if (form.elements.name.value.trim()) form.requestSubmit();
    else form.elements.name.focus();
  }
  if(b.dataset.mode) changeMode(b.dataset.mode);
  if(b.dataset.act) {
    if(b.dataset.act==='start' && state.phase==='lobby'){
      const form=document.querySelector('#settings');
      if(form && [...form.querySelectorAll('input')].some(el=>el.value!==el.defaultValue)) {notify('请先保存牌桌设置');return;}
    }
    void act({type:b.dataset.act});
  }
  if(b.hasAttribute('data-share')) {
    const url=String(roomUrl(session.code));
    try {await navigator.clipboard.writeText(url); notify('邀请链接已复制');}
    catch {window.prompt('复制邀请链接',url);}
  }
  if(b.hasAttribute('data-home')&&!busy) {history.replaceState(null,'',roomUrl(''));showEntrance();}
});
main.addEventListener('change',event=>{if(event.target.id==='seat') void act({type:'seat',index:Number(event.target.value)});});
main.addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.target;
  if(form.id==='entry-form') {void enter(form);return;}
  if(form.id==='settings') {void act({type:'settings',stack:+form.elements.stack.value,sb:+form.elements.sb.value,bb:+form.elements.bb.value});return;}
  if(form.id==='raise') {void act({type:'raise',to:+form.elements.to.value});return;}
  if(form.id==='award') {
    const winners=state.pots.map((p,i)=>[...form.querySelectorAll('[name=pot'+i+']:checked')].map(el=>el.value));
    if(winners.some(list=>!list.length)) {notify('请为每个底池选择至少一名赢家');return;}
    void act({type:'award',winners});
  }
});
const initialCode=cleanCode(new URL(location.href).searchParams.get('room'));
showEntrance(initialCode);
const saved=initialCode && readSaved(initialCode);
if(saved?.code===initialCode && saved.token) {
  session=saved;
  main.innerHTML='<section class="panel"><h2>正在连接牌桌</h2><p class="muted">房间 '+escape(initialCode)+'</p><button class="secondary" data-home>返回首页</button></section>';
  status(false,'连接中');void sync();
}
setInterval(sync,1000);
window.addEventListener('online',sync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});

