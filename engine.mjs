const streets = ['preflop', 'flop', 'turn', 'river'];
const streetNames = ['翻牌前', '翻牌', '转牌', '河牌'];
const live = p => p.inHand && !p.folded;
const active = p => live(p) && p.stack > 0;
const sum = (players, key) => players.reduce((n, p) => n + p[key], 0);

function requireThat(ok, msg) {
  if (!ok) throw new Error(msg);
}

function log(r, msg) {
  r.log.push(msg);
  if (r.log.length > 120) r.log.shift();
}

function makePlayer(id, name, stack) {
  requireThat(typeof name === 'string' && name.trim().length > 0 && [...name.trim()].length <= 20, '昵称需为 1 到 20 个字符');
  return { id, name: name.trim(), stack, inHand: false, folded: false, bet: 0, total: 0, actedAt: null };
}

export function createRoom(id, name) {
  const settings = {stack: 1000, sb: 5, bb: 10};
  return {
    hostId: id, phase: 'lobby', settings, players: [makePlayer(id, name, settings.stack)],
    hand: 0, street: 'preflop', dealer: null, sbId: null, bbId: null, turn: null,
    target: 0, increment: settings.bb, log: []
  };
}

function clockwise(r, id) {
  const i = r.players.findIndex(p => p.id === id);
  return [...r.players.slice(i + 1), ...r.players.slice(0, i + 1)];
}

function pay(p, cost) {
  p.stack -= cost;
  p.bet += cost;
  p.total += cost;
}

function blind(r, id, size, label) {
  const player = r.players.find(p => p.id === id);
  const amount = Math.min(size, player.stack);
  pay(player, amount);
  log(r, player.name + ' · ' + label + ' ' + amount);
}

function start(r) {
  requireThat(r.phase === 'lobby' || r.phase === 'complete', '当前这手牌尚未结束');
  const funded = r.players.filter(p => p.stack > 0);
  requireThat(funded.length >= 2, '至少需要两位有筹码的玩家');
  const bb = r.hand ? clockwise(r, r.bbId).find(p => p.stack > 0) : funded[funded.length === 2 ? 1 : 2];
  const order = clockwise(r, bb.id).filter(p => p.stack > 0);
  r.bbId = bb.id;
  r.sbId = order.at(-2).id;
  r.dealer = funded.length === 2 ? r.sbId : order.at(-3).id;
  for (const p of r.players) {
    Object.assign(p, {inHand: p.stack > 0, folded: false, bet: 0, total: 0, actedAt: null});
  }
  r.hand++;
  r.phase = 'betting';
  r.street = 'preflop';
  r.target = r.increment = r.settings.bb;
  log(r, '第 ' + r.hand + ' 手开始');
  blind(r, r.sbId, r.settings.sb, '小盲');
  blind(r, r.bbId, r.settings.bb, '大盲');
  advance(r, r.bbId);
}

function refundUncalled(r) {
  const bets = [...r.players].sort((a, b) => b.bet - a.bet);
  const refund = bets[0].bet - bets[1].bet;
  if (refund) {
    pay(bets[0], -refund);
    log(r, bets[0].name + ' · 收回未跟注筹码 ' + refund);
  }
}

function finish(r) {
  r.phase = 'complete';
  r.turn = null;
  for (const p of r.players) p.bet = p.total = 0;
}

function advance(r, after) {
  const contenders = r.players.filter(live);
  const actors = contenders.filter(active);
  if (contenders.length === 1) {
    refundUncalled(r);
    const amount = sum(r.players, 'total');
    contenders[0].stack += amount;
    log(r, contenders[0].name + ' · 赢得底池 ' + amount);
    finish(r);
    return;
  }
  if (actors.length <= 1) r.target = Math.max(...contenders.map(p => p.bet));
  const next = clockwise(r, after).find(p => active(p) &&
    (p.bet < r.target || (actors.length > 1 && p.actedAt === null)));
  if (next) {
    r.turn = next.id;
    return;
  }
  refundUncalled(r);
  if (r.street === 'river' || r.players.filter(active).length <= 1) {
    r.phase = 'showdown';
    r.turn = null;
    log(r, '摊牌 · 请房主根据实体牌确认赢家');
    return;
  }
  const street = streets.indexOf(r.street) + 1;
  r.street = streets[street];
  log(r, streetNames[street] + '圈开始');
  for (const p of r.players) {
    p.bet = 0;
    p.actedAt = null;
  }
  r.target = 0;
  r.increment = r.settings.bb;
  r.turn = clockwise(r, r.dealer).find(active).id;
}

function actions(r, id) {
  if (r.phase !== 'betting' || r.turn !== id) return null;
  const p = r.players.find(player => player.id === id);
  const owed = Math.max(0, r.target - p.bet);
  const maxRaiseTo = p.bet + p.stack;
  const reopened = p.actedAt === null || r.target - p.actedAt >= r.increment;
  return {
    fold: true, check: !owed, call: Math.min(owed, p.stack),
    raise: reopened && maxRaiseTo > r.target && r.players.some(q => q.id !== id && active(q)),
    minRaiseTo: Math.min(maxRaiseTo, r.target + r.increment), maxRaiseTo
  };
}

function act(r, p, cmd) {
  const options = actions(r, p.id);
  requireThat(options, '请等待轮到你行动');
  if (cmd.type === 'fold') {
    p.folded = true;
    log(r, p.name + ' · 弃牌');
  } else if (cmd.type === 'check') {
    requireThat(options.check, '需要跟注才能继续');
    log(r, p.name + ' · 过牌');
  } else if (cmd.type === 'call') {
    requireThat(options.call > 0, '当前可以过牌');
    pay(p, options.call);
    log(r, p.name + ' · 跟注 ' + options.call + (p.stack ? '' : '（全下）'));
  } else if (cmd.type === 'raise') {
    requireThat(options.raise && Number.isSafeInteger(cmd.to) && cmd.to >= options.minRaiseTo &&
      cmd.to <= options.maxRaiseTo, '加注金额超出允许范围');
    pay(p, cmd.to - p.bet);
    r.increment = Math.max(r.increment, cmd.to - r.target);
    r.target = cmd.to;
    log(r, p.name + ' · 加注到 ' + cmd.to + (p.stack ? '' : '（全下）'));
  } else {
    throw new Error('无效的行动');
  }
  p.actedAt = r.target;
  advance(r, p.id);
}

// Folded contributions stay in the pot. Merge slices with identical eligible
// players to avoid awarding a second odd chip at an arbitrary folded bet level.
function pots(r) {
  const caps = [...new Set(r.players.map(p => p.total).filter(Boolean))].sort((a,b) => a-b);
  const result = [];
  let previous = 0;
  for (const cap of caps) {
    const contributors = r.players.filter(p => p.total >= cap);
    const eligible = contributors.filter(live).map(p => p.id);
    const amount = (cap - previous) * contributors.length;
    previous = cap;
    const last = result.at(-1);
    if (last && eligible.length === last.eligible.length) last.amount += amount;
    else result.push({amount, eligible});
  }
  return result;
}

function award(r, winners) {
  requireThat(r.phase === 'showdown', '当前无法分配底池');
  const layers = pots(r);
  requireThat(Array.isArray(winners) && winners.length === layers.length, '请为每个底池选择赢家');
  for (const [i, pot] of layers.entries()) {
    const ids = winners[i];
    requireThat(Array.isArray(ids) && ids.length && new Set(ids).size === ids.length &&
      ids.every(id => pot.eligible.includes(id)), '赢家须为该底池的有效玩家');
  }
  const order = clockwise(r, r.dealer);
  for (const [i, pot] of layers.entries()) {
    const tied = order.filter(p => winners[i].includes(p.id));
    const each = Math.floor(pot.amount / tied.length);
    tied.forEach((p, index) => {
      const amount = each + Number(index < pot.amount % tied.length);
      p.stack += amount;
      log(r, p.name + ' · ' + (i ? '边池 ' + i : '主池') + ' 获得 ' + amount);
    });
  }
  finish(r);
}

export function apply(r, id, cmd) {
  requireThat(cmd && typeof cmd === 'object', '无效的行动');
  const player = r.players.find(p => p.id === id);
  if (cmd.type === 'join') {
    requireThat(r.phase === 'lobby' && !player, '房间已经开局或你已在房内');
    requireThat(r.players.length < 10, '房间已满（最多十人）');
    const guest = makePlayer(id, cmd.name, r.settings.stack);
    requireThat(!r.players.some(p => p.name === guest.name), '该昵称已有人使用');
    r.players.push(guest);
    return r;
  }
  requireThat(player, '请先加入房间');
  if (['settings', 'start', 'award'].includes(cmd.type)) requireThat(id === r.hostId, '仅房主可执行此操作');
  if (cmd.type === 'settings') {
    requireThat(r.phase === 'lobby', '请在准备阶段设置');
    const {stack, sb, bb} = cmd;
    requireThat([stack, sb, bb].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000000)
      && sb < bb && bb <= stack, '请输入正整数，且小盲 < 大盲 ≤ 初始筹码（最多十亿）');
    r.settings = {stack, sb, bb};
    for (const p of r.players) p.stack = stack;
  } else if (cmd.type === 'seat') {
    requireThat(r.phase === 'lobby' && Number.isInteger(cmd.index) &&
      cmd.index >= 0 && cmd.index < r.players.length, '请在准备阶段选择有效座次');
    r.players.splice(r.players.indexOf(player), 1);
    r.players.splice(cmd.index, 0, player);
  } else if (cmd.type === 'start') start(r);
  else if (cmd.type === 'award') award(r, cmd.winners);
  else act(r, player, cmd);
  return r;
}

export function view(r, id) {
  const {hostId, phase, settings, hand, street, dealer, sbId, bbId, turn, version} = r;
  return {hostId, phase, settings: {...settings}, hand, street, dealer, sbId, bbId, turn, version,
    players: r.players.map(({actedAt, ...player}) => player),
    pot: sum(r.players, 'total'), pots: phase === 'showdown' ? pots(r) : [],
    actions: actions(r, id), log: [...r.log]};
}

