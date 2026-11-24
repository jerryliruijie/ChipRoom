// This replayable single decision is local to its tab. Live rooms use the server.
const buyIn = 1000;
const me = 'south';
const small = 'west';
const big = 'east';

export function openPractice(version = 1) {
  const seats = [[me, '你', 0], [small, '南枝', 10], [big, 'Mika', 20]];
  return {
    practice: true, practiceDone: false, version, me, hostId: me,
    phase: 'betting', street: 'preflop', hand: 1, dealer: me, sbId: small, bbId: big, turn: me,
    settings: {stack: buyIn, sb: 10, bb: 20}, pot: 30, pots: [],
    players: seats.map(([id,name,bet]) => ({id, name, bet, total: bet, stack: buyIn-bet, folded: false, inHand: true})),
    actions: {fold: false, check: false, call: 20, raise: false},
    log: ['南枝 · 小盲 10', 'Mika · 大盲 20']
  };
}

export function practiceCall(current) {
  if (!current.practice || current.practiceDone || current.turn !== me) return current;
  const amount = current.actions.call;
  return {
    ...current, practiceDone: true, version: current.version + 1, turn: small,
    players: current.players.map(p => p.id === me
      ? {...p, stack: p.stack - amount, bet: p.bet + amount, total: p.total + amount} : p),
    actions: null, pot: current.pot + amount, log: [...current.log, '你 · 跟注 ' + amount]
  };
}
