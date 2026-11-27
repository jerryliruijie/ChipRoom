const digits = new Intl.NumberFormat('zh-CN');
const compact = new Intl.NumberFormat('zh-CN', {notation:'compact',maximumSignificantDigits:3});

// The input and confirmation always use the exact amount. Mark rounded labels
// explicitly so even a one-chip difference is not presented as an exact value.
export function presetAmountLabel(to) {
  if (to >= 100000000 && to % 100000000 === 0) return digits.format(to/100000000)+' 亿';
  if (to >= 10000 && to % 10000 === 0) {
    const label = digits.format(to/10000)+' 万';
    if (label.length <= 8) return label;
  }
  if (to < 1000000) return digits.format(to);
  return '≈'+compact.format(to);
}

// All choices are street totals; the pot already contains this street's wagers.
export function wagerPresets(state) {
  const a = state.actions;
  if (!a?.raise) return [];
  const own = state.players.find(p => p.id === state.me);
  const call = a.toCall ?? a.call;
  const afterCall = state.pot + call;
  const totalAfterCall = own.bet + call;
  const amounts = [
    ...[1,2,3,4,5].map(n => [n+'bb', n+' BB', n*state.settings.bb]),
    ['half','半池',totalAfterCall + Math.round(afterCall / 2)],
    ['pot','满池',totalAfterCall + afterCall],
    ['max','全下',a.maxRaiseTo]
  ];
  return amounts.map(([id,label,to]) => ({
    id,label,to,enabled:Number.isSafeInteger(to) && to >= a.minRaiseTo && to <= a.maxRaiseTo
  }));
}
