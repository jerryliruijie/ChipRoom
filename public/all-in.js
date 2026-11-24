import { num, reducedMotion } from './ui.js';

const verbs = {sb:'小盲全下', bb:'大盲全下', call:'跟注全下', bet:'下注全下', raise:'加注全下'};
const soundPreference = 'chip-room-all-in-sound';

export function committedAllIn(state, player) {
  return (state.phase === 'betting' || state.phase === 'showdown') &&
    player.inHand && !player.folded && player.total > 0 && player.stack === 0;
}

// The server records payments before any uncalled amount is returned. Never infer an
// announcement from a zero balance: a player can also finish a hand with zero.
export function createAllInCursor() {
  let hand, hostId, revision = -1, interrupted = true;
  let seen = new Set();
  return {
    seed(state) {
      hand = state.hand;
      hostId = state.hostId;
      revision = state.version;
      seen = new Set((state.allIns || []).map(event => event.id));
      interrupted = false;
    },
    interrupt() { interrupted = true; },
    accept(state, baseline = false) {
      const sameRoom = state.hostId === hostId;
      if (sameRoom && state.version < revision) return [];
      const fresh = !baseline && !interrupted && sameRoom && state.version > revision &&
        (state.hand === hand || state.hand === hand + 1);
      if (!sameRoom || state.hand !== hand) seen = new Set();
      const incoming = [];
      for (const event of state.allIns || []) {
        if (!seen.has(event.id)) {
          if (fresh) incoming.push(event);
          seen.add(event.id);
        }
      }
      hand = state.hand;
      hostId = state.hostId;
      revision = state.version;
      interrupted = false;
      return incoming;
    }
  };
}

function createChipSound(button) {
  const WebAudio = window.AudioContext || window.webkitAudioContext;
  let enabled = false;
  try { enabled = localStorage.getItem(soundPreference) === 'on'; } catch {}
  let context, bufferPromise, disposed = false, generation = 0;
  const sources = new Set();
  button.hidden = !WebAudio;

  function display() {
    button.setAttribute('aria-pressed',String(enabled));
    const title = enabled ? '关闭全下音效' : '开启全下音效';
    button.setAttribute('aria-label',title);
    button.title = title;
  }
  function unlock() {
    if (!enabled || !WebAudio || disposed || document.hidden) return;
    try {
      context ||= new WebAudio();
      if (context.state !== 'running') void context.resume().catch(() => {});
      if (!bufferPromise) {
        const bytes = Uint8Array.from(atob(recording), character => character.charCodeAt(0));
        bufferPromise = context.decodeAudioData(bytes.buffer).catch(() => null);
      }
    } catch { /* Visual feedback remains available on devices that deny audio. */ }
  }
  function stop() {
    generation++;
    for (const source of sources) {
      try { source.stop(); } catch {}
    }
    sources.clear();
  }
  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(soundPreference,enabled ? 'on' : 'off'); } catch {}
    display();
    if (enabled) unlock();
    else stop();
  }
  function play(count) {
    if (!enabled || document.hidden || !bufferPromise || context?.state !== 'running') return;
    const started = performance.now(), captured = generation;
    void bufferPromise.then(buffer => {
      if (!buffer || disposed || captured !== generation || !enabled || document.hidden ||
          context.state !== 'running' || performance.now() - started > 350) return;
      for (let i = 0; i < count; i++) {
        const source = context.createBufferSource(), level = context.createGain();
        source.buffer = buffer;
        level.gain.value = .40;
        source.connect(level).connect(context.destination);
        sources.add(source);
        source.onended = () => { sources.delete(source); source.disconnect(); level.disconnect(); };
        source.start(context.currentTime + i * .13);
      }
    }).catch(() => {});
  }
  display();
  button.addEventListener('click',toggle);
  document.addEventListener('pointerdown',unlock,{passive:true});
  document.addEventListener('keydown',unlock);
  if (enabled && navigator.userActivation?.hasBeenActive) unlock();
  return {
    play, stop,
    destroy() {
      disposed = true;
      stop();
      document.removeEventListener('pointerdown',unlock);
      document.removeEventListener('keydown',unlock);
      button.removeEventListener('click',toggle);
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    }
  };
}

export function markAllInSeat(node, active) {
  node.classList.toggle('is-all-in',active);
  let stamp = node.querySelector('.all-in-stamp');
  if (!stamp && active) {
    stamp = document.createElement('span');
    stamp.className = 'all-in-stamp';
    stamp.innerHTML = '<i aria-hidden="true" lang="en">ALL IN</i><strong>全下</strong>';
    node.querySelector('.stack').after(stamp);
  }
  if (stamp) stamp.hidden = !active;
}

export function mountAllInFeedback(arena, seats) {
  const notice = document.createElement('div');
  notice.className = 'all-in-notice';
  notice.setAttribute('role','status');
  notice.setAttribute('aria-atomic','true');
  notice.hidden = true;
  notice.innerHTML = '<i aria-hidden="true"></i><span></span>';
  const message = notice.lastElementChild;

  const soundButton = document.createElement('button');
  soundButton.type = 'button';
  soundButton.id = 'all-in-sound';
  soundButton.className = 'all-in-sound';
  soundButton.innerHTML = '<span class="speaker" aria-hidden="true"></span>';
  arena.append(notice,soundButton);
  const sound = createChipSound(soundButton);
  const cursor = createAllInCursor();
  const animations = new Set();
  let timer = 0, lastHand;
  function hideNotice() {
    clearTimeout(timer);
    notice.hidden = true;
    notice.removeAttribute('title');
    message.textContent = '';
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function interrupt() {
    cursor.interrupt();
    sound.stop();
    hideNotice();
  }
  function visibility() { if (document.hidden) interrupt(); }
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('offline',interrupt);
  window.addEventListener('pagehide',interrupt);

  return {
    update(next, previous) {
      if (!previous) {
        interrupt();
        notice.removeAttribute('data-event-ids');
        cursor.seed(next);
        if (document.hidden) cursor.interrupt();
        lastHand = next.hand;
        return;
      }
      if (document.hidden) { interrupt(); return; }
      if (lastHand !== next.hand) hideNotice();
      lastHand = next.hand;
      const events = cursor.accept(next);
      if (!events.length) return;
      const names = new Map(next.players.map(player => [player.id,player.name]));
      notice.hidden = false;
      notice.dataset.eventIds = events.map(event => event.id).join(' ');
      message.textContent = events.map(event =>
        (names.get(event.playerId) || '玩家') + ' · ' + (verbs[event.kind] || '全下') + ' ' + num(event.amount)
      ).join(' ／ ');
      notice.title = message.textContent;
      if (!reducedMotion()) {
        const actors = new Set(events.map(event => event.playerId));
        for (const seat of seats.children) {
          if (!actors.has(seat.dataset.key) || !seat.animate) continue;
          const pulse = seat.animate([
            {boxShadow:'inset 3px 0 #ffe0ab, -9px 0 20px #edaa7b5c'},
            {boxShadow:'inset 1px 0 #ca92a5, -2px 0 7px #e8a78024',offset:.55},
            {boxShadow:'inset 0 0 transparent, 0 0 transparent'}
          ],{duration:650,easing:'ease-out'});
          animations.add(pulse);
          pulse.onfinish = pulse.oncancel = () => animations.delete(pulse);
        }
      }
      sound.play(events.length);
      clearTimeout(timer);
      timer = setTimeout(hideNotice,1900);
    },
    confirm(next) { if (!document.hidden) cursor.accept(next,true); },
    interrupt,
    destroy() {
      interrupt();
      sound.destroy();
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('offline',interrupt);
      window.removeEventListener('pagehide',interrupt);
      notice.remove();
      soundButton.remove();
    }
  };
}

// “poker_chips6.wav”, fartheststar, CC0 1.0. A 0.21-second clay/ceramic clack.
// https://freesound.org/people/fartheststar/sounds/201808/
// Embedded MP3 preview keeps playback local to the table's origin.
const recording = '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';
