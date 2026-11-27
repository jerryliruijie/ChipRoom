const stages = {
  preflop: ['翻牌前','公共牌 0 张'], flop: ['翻牌圈','公共牌 3 张'],
  turn: ['转牌圈','公共牌 4 张'], river: ['河牌圈','公共牌 5 张'],
  showdown: ['摊牌','确认底池赢家'], complete: ['本手结束',''], lobby: ['准备入座','']
};
export function mountStageNotice(root) {
  const label = root.querySelector('#stage-label'), notice = root.querySelector('.stage-notice');
  const title = notice.querySelector('strong'), detail = notice.querySelector('small');
  let lastKey = '', latest, timer;
  function dismiss() { clearTimeout(timer); notice.hidden = true; }
  function update(state,reset = false) {
    latest = state;
    const stage = state.phase === 'betting' ? state.street : state.phase;
    const key = state.hand+'/'+stage;
    if (!reset && key === lastKey) return;
    if (!document.hidden) lastKey = key;
    const [name,hint] = stages[stage];
    label.textContent = name;
    label.dataset.stage = stage;
    dismiss();
    if (stage === 'lobby' || document.hidden) return;
    title.textContent = name;
    detail.textContent = ['第 '+state.hand+' 手',hint].filter(Boolean).join(' · ');
    notice.hidden = false;
    timer = setTimeout(dismiss,2000);
  }
  function onVisibility() {
    if (document.hidden) dismiss();
    else if (latest) update(latest);
  }
  document.addEventListener('visibilitychange',onVisibility);
  return {
    update,
    destroy() {
      dismiss();
      document.removeEventListener('visibilitychange',onVisibility);
    }
  };
}
