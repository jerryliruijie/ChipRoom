const prefix = 'chip-room-session-';
const memory = new Map();
export const validRoomCode = code => /^(?:[0-9]{4}|[A-Z0-9]{6})$/.test(code);

// A tab's own seat takes priority on devices with more than one identity.
function stores() {
  const available = [];
  for (const name of ['sessionStorage','localStorage']) {
    try { available.push(window[name]); } catch { /* Storage may be unavailable. */ }
  }
  return available;
}
function read(store,code) {
  try {
    const entry = JSON.parse(store.getItem(prefix+code));
    if (entry?.code === code && typeof entry.token === 'string' && entry.token) return entry;
  } catch { /* Skip individual malformed records left on the device. */ }
}
export function savedSession(code) {
  if (!validRoomCode(code)) return;
  if (memory.has(code)) return memory.get(code);
  for (const store of stores()) {
    const seat = read(store,code);
    if (seat) return seat;
  }
}
export function rememberSeat(identity,state) {
  const seat = {
    code:identity.code, token:identity.token, host:state.players.find(p=>p.id===state.hostId)?.name,
    name:state.players.find(p=>p.id===state.me)?.name, isHost:state.hostId===state.me, visited:Date.now()
  };
  memory.set(seat.code,seat);
  for (const store of stores()) {
    try { store.setItem(prefix+seat.code,JSON.stringify(seat)); } catch { /* Keep it in this tab. */ }
  }
}
export function forgetSeat({code,token}) {
  if (memory.get(code)?.token === token) memory.delete(code);
  for (const store of stores()) {
    try { if (read(store,code)?.token === token) store.removeItem(prefix+code); } catch {}
  }
}
export function savedSeats() {
  const codes = new Set(memory.keys());
  for (const store of stores()) {
    try {
      for (let i=0;i<store.length;i++) {
        const key = store.key(i);
        if (key?.startsWith(prefix)) codes.add(key.slice(prefix.length));
      }
    } catch {}
  }
  return Array.from(codes,savedSession).filter(Boolean)
    .sort((a,b)=>(b.visited||0)-(a.visited||0) || a.code.localeCompare(b.code));
}
