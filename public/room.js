import { seatPoint, chipPoints } from './seat-layout.js';
import { presetAmountLabel, wagerPresets } from './wager-presets.js';
import { committedAllIn, markAllInSeat, mountAllInFeedback } from './all-in.js';
import { num, reconcile, reducedMotion, template, text } from './ui.js';
import { mountStageNotice } from './stage-notice.js';

function amount(node, value, animate) {
  const label = num(value);
  if (node.textContent === label) return;
  text(node,label);
  node.classList.toggle('long-number',label.length > 8);
  if (animate && !reducedMotion()) node.animate([{color:'#9cf2ce'},{color:getComputedStyle(node).color}],{duration:210});
}
function syncLog(list, latest, old) {
  // Retain DOM nodes when the engine trims the beginning of its bounded log.
  let overlap = Math.min(old.length, latest.length);
  while (overlap && !old.slice(-overlap).every((line,i)=>line===latest[i])) overlap--;
  const beforeHeight = list.scrollHeight, beforeTop = list.scrollTop;
  for (let i=overlap; i<old.length; i++) list.lastElementChild?.remove();
  for (const line of latest.slice(overlap)) {
    const li=document.createElement('li');
    li.textContent=line;
    list.prepend(li);
  }
  if (beforeTop > 0) list.scrollTop = beforeTop + list.scrollHeight - beforeHeight;
}
export function mountTable(main,code,act,notify) {
  const root = template('table-template');
  main.replaceChildren(root);
  const $ = selector => root.querySelector(selector);
  const seatList = $('#seats'), roster = $('#roster'), arena = $('.arena');
  const allInFeedback = mountAllInFeedback(arena,seatList);
  const stageNotice = mountStageNotice(root);
  const dock = $('#console'), settings = $('#settings'), raise = $('#raise'), award = $('#award');
  const amountInput = $('#raise-to'), slider = $('.raise-slider'), confirm = $('#raise-confirm');
  const compact = matchMedia('(max-width:780px)');
  let state, pending = false, raiseKey = '';
  let presets = [], selectedPreset = '';
  let scene = null, destroyed = false;
  const layer = $('#scene-layer'), props = $('.fallback-props'), wagers = $('#wager-labels');
  root.dataset.scene = 'loading';

  function sceneMode(value) {
    root.dataset.scene = value;
    $('#match').disabled = pending || Boolean(state?.practice && value === 'loading');
  }
  function releaseScene() {
    scene?.destroy();
    scene = null;
    sceneMode('fallback');
  }
  const watchScene = new MutationObserver(() => {
    if (scene && !destroyed) sceneMode(layer.dataset.scene === 'ready' ? 'webgl' : 'fallback');
  });
  watchScene.observe(layer,{attributes:true,attributeFilter:['data-scene']});
  // A slow or unavailable GPU must never hold a player's turn open.
  const loadDeadline = setTimeout(() => sceneMode('fallback'),2800);
  import('./table-scene.js').then(({createTableScene}) => {
    if (destroyed) return;
    scene = createTableScene(layer);
    if (!scene) throw new Error('Scene unavailable');
    if (state) scene.update(state);
    sceneMode(layer.dataset.scene === 'lost' ? 'fallback' : 'webgl');
  }).catch(() => { if (!destroyed) releaseScene(); }).finally(() => clearTimeout(loadDeadline));

  function fallbackChips(previous, animate) {
    // These chip silhouettes preserve placement on devices without GPU support.
    const mine = state.players.findIndex(p => p.id === state.me);
    const count = state.players.length;
    reconcile(props,state.players,p=>p.id,()=>{
      const group = document.createElement('div');
      group.innerHTML = '<i class="bank-chip"></i><i class="wager-chip"></i>';
      return group;
    },(node,p,i)=>{
      const {bank:[bx,by],wager:[wx,wy]} = chipPoints((i-mine+count)%count,count,
        arena.clientWidth,arena.clientHeight,compact.matches);
      const bank = node.firstElementChild, wager = node.lastElementChild;
      bank.style.left = bx+'%'; bank.style.top = by+'%'; bank.hidden = !p.stack;
      wager.style.left = wx+'%'; wager.style.top = wy+'%'; wager.hidden = !p.bet;
      const old = previous?.players.find(player => player.id === p.id);
      if (animate && root.dataset.scene !== 'webgl' && old && p.bet > old.bet && !reducedMotion()) {
        const dx = (bx-wx)*props.clientWidth/100, dy = (by-wy)*props.clientHeight/100;
        wager.animate([{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'none'}],
          {duration:500,easing:'cubic-bezier(.26,.64,.26,1)'});
      }
    });
  }
  text($('#table-code'),code);
  $('#config-section').open = true;
  $('#roster-section').open = window.matchMedia('(min-width: 781px)').matches;

  function measure() {
    const view = window.visualViewport;
    const keyboard = view && Math.abs(view.scale - 1) < .05
      ? Math.max(0,window.innerHeight-view.height-view.offsetTop) : 0;
    root.style.setProperty('--ime', Math.round(keyboard)+'px');
  }
  // Resizing the canvas reprojects the 3D piles; keep DOM seats and silhouettes aligned.
  const observer = new ResizeObserver(() => {
    if (!state || destroyed) return;
    players(state,false);
    fallbackChips(null,false);
  });
  observer.observe(arena);
  window.visualViewport?.addEventListener('resize',measure);
  window.visualViewport?.addEventListener('scroll',measure);

  function players(previous,animate) {
    const lobby = state.phase === 'lobby';
    const mine = state.players.findIndex(p=>p.id===state.me);
    const count = state.players.length;
    const old = new Map(previous?.players.map(p=>[p.id,p]) || []);
    root.style.setProperty('--flank-rows',Math.floor((count-1)/2));
    root.dataset.dense = String(count >= 7);
    root.dataset.count = String(count);
    reconcile(seatList,state.players,p=>p.id,()=>template('seat-template'),(node,p,index)=>{
      const [x,y] = seatPoint((index-mine+count)%count,count,compact.matches);
      node.style.setProperty('--x',x+'%');
      node.style.setProperty('--y',y+'%');
      const current = p.id === state.turn;
      node.classList.toggle('is-current',current);
      node.classList.toggle('is-mine',p.id===state.me);
      node.classList.toggle('is-out',!lobby && (p.folded || !p.inHand));
      node.querySelector('.turn-tag').hidden = !current;
      node.querySelector('.dealer').hidden = state.dealer!==p.id;
      const name = node.querySelector('.player-name');
      text(name,p.name); name.title = p.name;
      amount(node.querySelector('.stack'),p.stack,animate && old.has(p.id));
      markAllInSeat(node,committedAllIn(state,p));
      const bet = node.querySelector('.bet');
      text(bet.querySelector('.bet-label'),lobby ? '座' : '已下');
      text(bet.querySelector('.bet-value'),lobby ? index+1 : num(p.bet));
      bet.classList.toggle('long-number',p.bet >= 1000000);
      const blind = p.id === state.sbId ? 'SB' : p.id === state.bbId ? 'BB' : '';
      const condition = p.folded && !lobby ? '弃牌' : !p.inHand && !lobby ? '休息' : blind;
      text(node.querySelector('.role'),[p.id===state.me && p.name!=='你'?'我':'',condition].filter(Boolean).join('·'));
    });
    reconcile(wagers,state.players,p=>p.id,()=>document.createElement('span'),(label,p,index)=>{
      const [sx,sy] = seatPoint((index-mine+count)%count,count,compact.matches);
      label.style.left = (50+(sx-50)*.50)+'%';
      label.style.top = (50+(sy-50)*.52)+'%';
      label.dataset.side = sx<45 ? 'left' : sx>55 ? 'right' : 'middle';
      label.hidden = !p.bet || lobby || count>=7;
      text(label,num(p.bet));
      label.setAttribute('aria-label',p.name+'本轮已下 '+num(p.bet));
    });
    reconcile(roster,state.players,p=>p.id,()=>{
      const li = document.createElement('li');
      li.innerHTML = '<span class="order digits"></span><b></b><small></small>';
      return li;
    },(li,p,i)=>{
      text(li.querySelector('.order'),String(i+1).padStart(2,'0'));
      text(li.querySelector('b'),p.name);
      text(li.querySelector('small'),[p.id===state.me?'我':'',p.id===state.hostId?'房主':''].filter(Boolean).join(' · '));
    });
    text($('#seat-count'),count);
    $('#seat-picker').hidden = !lobby;
    if (lobby) {
      const select=$('#seat');
      reconcile(select,state.players,(_,i)=>i,()=>document.createElement('option'),(option,_,i)=>{
        option.value = i; text(option,(i+1)+' 号座');
      });
      if (select.value !== String(mine)) select.value = String(mine);
    }
  }
  function configure() {
    const host = state.hostId===state.me;
    const editable = host && state.phase==='lobby';
    settings.hidden = !editable;
    const read = $('#read-settings');
    read.hidden = editable;
    text(read,'初始筹码　'+num(state.settings.stack));
    for (const [key,value] of Object.entries(state.settings)) {
      const field = settings.elements[key];
      const clean = field.value === field.defaultValue;
      field.defaultValue = String(value);
      if (clean && field.value!==String(value)) field.value=String(value);
    }
  }
  function changeRaise(open) {
    raise.hidden = !open;
    $('#bet-buttons').hidden = open;
    $('#raise-open').setAttribute('aria-expanded',String(open));
    dock.classList.toggle('editing',open);
    if (open) {
      amountInput.value = slider.value = slider.min;
      selectedPreset = '';
      paint();
    }
  }
  function paint() {
    const min = Number(slider.min), max = Number(slider.max);
    const progress = max===min ? 100 : (Number(slider.value)-min)*100/(max-min);
    slider.style.setProperty('--progress',progress+'%');
    const a = state.actions;
    const value = amountInput.valueAsNumber;
    const valid = a?.raise && Number.isSafeInteger(value) && amountInput.validity.valid &&
      value >= a.minRaiseTo && value <= a.maxRaiseTo;
    confirm.disabled = pending || !valid;
    amountInput.disabled = slider.disabled = pending;
    for (const step of raise.querySelectorAll('[data-step]')) {
      step.disabled = pending || (step.dataset.step === 'down' ? value <= min : value >= max);
    }
    const opening = state.actions?.wagerKind === 'bet';
    const allIn = valid && amountInput.valueAsNumber === max;
    text(confirm,valid ? (allIn ? '确认全下 ' : opening ? '下注 ' : '加注到 ')+num(amountInput.valueAsNumber)
      : opening ? '确认下注' : '确认加注');
    confirm.dataset.allin = String(allIn);
    // Natural coincidences (e.g. half-pot = 3 BB) still represent one draft.
    // Prefer the button the player chose, or a single match for manual entry.
    const matchedPreset = selectedPreset || (allIn ? 'max' : presets.find(p=>p.enabled && p.to===value)?.id);
    for (const button of raise.querySelectorAll('[data-preset]')) {
      const preset = presets.find(item => item.id === button.dataset.preset);
      button.disabled = pending || !preset.enabled;
      button.setAttribute('aria-pressed',String(valid && preset.enabled && preset.to===value && matchedPreset===preset.id));
    }
  }
  function actions(previous) {
    const {phase,actions:a} = state;
    const host=state.me===state.hostId;
    const preparation = phase==='lobby' || phase==='complete';
    $('#preparation').hidden = !preparation;
    $('#betting').hidden = !a;
    $('#practice-again').hidden = !(state.practice && state.practiceDone);
    if ($('#practice-alternates')) {
      $('#practice-alternates').hidden = !state.practiceDone;
      for (const button of root.querySelectorAll('[data-scenario]')) button.hidden = state.scenario === button.dataset.scenario;
    }
    award.hidden = phase!=='showdown' || !host;
    const key = a ? [state.hand,state.street,state.turn,state.pot,a.toCall ?? a.call,a.minRaiseTo,a.maxRaiseTo].join('/') : '';
    if (raiseKey !== key || !a?.raise) changeRaise(false);
    if (a) {
      const match=$('#match');
      match.dataset.act = a.check ? 'check' : 'call';
      const own = state.players.find(p => p.id === state.me);
      const callAllIn = a.call > 0 && own.stack === a.call;
      text(match,a.check ? '过牌' : (callAllIn ? '全下跟注 ' : '跟注 ')+num(a.call));
      match.dataset.allin = String(callAllIn);
      match.hidden = !a.check && !a.call;
      $('[data-act="fold"]').hidden = !a.fold || a.check;
      $('#raise-open').hidden = !a.raise;
      const opening = a.wagerKind === 'bet' || (a.wagerKind == null && state.street !== 'preflop' && state.players.every(p => !p.bet));
      const onlyAllIn = a.raise && a.minRaiseTo === a.maxRaiseTo;
      text($('#raise-open'),onlyAllIn ? '全下' : opening ? '下注' : '加注');
      $('#raise-open').dataset.allin = String(onlyAllIn);
      slider.setAttribute('aria-label',opening ? '调整下注金额' : '调整本轮加注总额');
      if ($('[data-wager-label]')) text($('[data-wager-label]'),opening ? '下注' : '加注到');
      if (a.raise && key !== raiseKey) {
        presets = wagerPresets(state);
        selectedPreset = '';
        reconcile($('.wager-presets'),presets,item=>item.id,()=>{
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'outline wager-key';
          button.append(document.createElement('span'),document.createElement('small'));
          return button;
        },(button,preset)=>{
          button.dataset.preset = preset.id;
          if (preset.id==='max') button.id = 'raise-max';
          text(button.firstElementChild,preset.label);
          text(button.lastElementChild,presetAmountLabel(preset.to));
          let hint = preset.label+' · 本轮总额 '+num(preset.to);
          if (!preset.enabled) hint += preset.to<a.minRaiseTo ? '，低于最低下注总额' : '，超过可用筹码';
          button.setAttribute('aria-label',hint);
          button.title = hint;
        });
        for (const field of [amountInput,slider]) {
          field.min = a.minRaiseTo;
          field.max = a.maxRaiseTo;
          field.value = a.minRaiseTo;
        }
        const limits = $('.limits').children;
        text(limits[0],'最低 '+num(a.minRaiseTo)); text(limits[1],'最高 '+num(a.maxRaiseTo));
        paint();
      }
    }
    raiseKey = key;
    let title, info='';
    if (preparation) {
      const start = $('#start');
      const funded = state.players.filter(p=>p.stack>0).length;
      title = phase==='lobby' ? '准备开桌' : '本手结束';
      let note;
      if (phase==='lobby') note = funded<2 ? '等待另一位玩家入座' : host ? '确认座位顺序后即可开局' : '等待房主开局';
      else note = state.log.at(-1) || '';
      text($('#ready-note'),note);
      text(start,phase==='lobby' ? '开始第一手' : '开始下一手');
      start.hidden = !host || funded<2;
    } else if (phase==='betting') {
      title = a ? '轮到你行动' : '等待 '+(state.players.find(p=>p.id===state.turn)?.name || '')+' 行动';
      if (a) info = a.call ? '待跟 '+num(a.toCall ?? a.call) : '可过牌';
    } else {
      title = host ? '分配底池' : '等待房主确认赢家';
      info = '摊牌结算';
      if (host && previous?.phase !== 'showdown') buildPots();
    }
    if (state.practice && state.practiceDone) {
      title = state.practiceCaption;
      info = '底池 '+num(state.pot);
    }
    text($('#action-title'),title); text($('#action-info'),info);
  }
  function buildPots() {
    const group = $('#award-pots');
    group.replaceChildren();
    state.pots.forEach((pot,i)=>{
      const set=document.createElement('fieldset'), legend=document.createElement('legend');
      text(legend,(i?'边池 '+i:'主池')+'　'+num(pot.amount));
      set.append(legend);
      for (const id of pot.eligible) {
        const label=document.createElement('label'), input=document.createElement('input');
        label.className='winner';
        input.type='checkbox'; input.name='pot'+i; input.value=id;
        input.checked=input.disabled=pot.eligible.length===1;
        label.append(input,document.createTextNode(state.players.find(p=>p.id===id).name));
        set.append(label);
      }
      group.append(set);
    });
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if (!button || pending) return;
    if (button.id==='raise-open') {
      changeRaise(true);
      slider.focus({preventScroll:true});
    } else if (button.dataset.preset && !raise.hidden) {
      const preset = presets.find(item=>item.id===button.dataset.preset);
      if (!preset?.enabled || button.disabled) return;
      selectedPreset = preset.id;
      amountInput.value = slider.value = String(preset.to);
      paint();
    } else if (button.id==='raise-cancel') {
      changeRaise(false);
      $('#raise-open').focus({preventScroll:true});
    } else if (button.dataset.act) {
      if (button.dataset.act==='start' && state.phase==='lobby' &&
          Array.from(settings.querySelectorAll('input')).some(input=>input.value!==input.defaultValue)) {
        $('#config-section').open=true;
        notify('请先保存牌桌设置');
        return;
      }
      void act({type:button.dataset.act});
    }
  });
  $('#seat').addEventListener('change',event=>void act({type:'seat',index:Number(event.target.value)}));
  settings.addEventListener('submit',event=>{
    event.preventDefault();
    const {stack,sb,bb}=settings.elements;
    void act({type:'settings',stack:stack.valueAsNumber,sb:sb.valueAsNumber,bb:bb.valueAsNumber});
  });
  award.addEventListener('submit',event=>{
    event.preventDefault();
    const winners=state.pots.map((_,i)=>Array.from(award.querySelectorAll('[name="pot'+i+'"]:checked'),el=>el.value));
    if (winners.some(ids=>!ids.length)) { notify('请为每个底池选择赢家，可多选'); return; }
    void act({type:'award',winners});
  });
  slider.addEventListener('input',()=>{ selectedPreset=''; amountInput.value=slider.value; paint(); });
  amountInput.addEventListener('input',()=>{
    selectedPreset='';
    if (amountInput.validity.valid) slider.value=amountInput.value;
    paint();
  });
  amountInput.addEventListener('keydown',event=>{
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!confirm.disabled) confirm.focus({preventScroll:true});
    }
  });
  raise.addEventListener('submit',event=>{
    event.preventDefault();
    if (event.submitter===confirm && !pending && !confirm.disabled && !raise.hidden &&
        state.actions?.raise && amountInput.reportValidity()) void act({type:'raise',to:amountInput.valueAsNumber});
  });

  return {
    update(next,previous) {
      state=next;
      const lobby=state.phase==='lobby', successive=previous?.version+1===next.version;
      root.dataset.phase=state.phase;
      root.dataset.practice=String(!!state.practice);
      text($('#table-title'),lobby ? '房间准备' : '第 '+state.hand+' 手');
      stageNotice.update(next,!previous);
      text($('#blind-amount'),num(state.settings.sb)+' / '+num(state.settings.bb));
      text($('#pot-label'),lobby ? '已入座' : '总底池');
      $('.fallback-pot').hidden = lobby || !state.pot;
      amount($('#pot-value'),lobby ? state.players.length : state.pot,successive && !lobby);
      players(previous,successive && !lobby);
      allInFeedback.update(next,previous);
      configure();
      actions(previous);
      fallbackChips(previous,successive && !lobby);
      if (scene) {
        try { scene.update(next,previous); }
        catch { releaseScene(); }
      }
      sceneMode(root.dataset.scene);
      const logList = $('#logs');
      if (!previous) logList.replaceChildren();
      syncLog(logList,state.log,previous?.log || []);
      measure();
    },
    interruptFeedback: allInFeedback.interrupt,
    confirmFeedbackSnapshot: allInFeedback.confirm,
    setBusy(value) {
      pending=value;
      for (const button of root.querySelectorAll('button,#seat')) button.disabled=value;
      sceneMode(root.dataset.scene);
      if (!raise.hidden) paint();
      if (!value && state?.phase==='lobby') $('#seat').value=String(state.players.findIndex(p=>p.id===state.me));
    },
    destroy() {
      destroyed=true;
      allInFeedback.destroy();
      stageNotice.destroy();
      clearTimeout(loadDeadline);
      watchScene.disconnect();
      releaseScene();
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize',measure);
      window.visualViewport?.removeEventListener('scroll',measure);
    }
  };
}
