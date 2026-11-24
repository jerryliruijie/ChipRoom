// Keep browser number-field validation and the raise slider in sync with chip steps.
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-step]');
  if (!button || button.disabled) return;
  const input = button.closest('form').elements.to;
  const value = input.valueAsNumber;
  const sign = button.dataset.step === 'up' ? 1 : -1;
  const min = Number(input.min);
  const max = Number(input.max);
  input.value = Math.min(max, Math.max(min, Number.isFinite(value) ? value + sign : min));
  input.dispatchEvent(new Event('input', {bubbles:true}));
});

// Touch browsers may defer :active until the synthetic click on release.
const tactile = 'button,summary,select,input[type=range],.winner';
let held;
function release() {
  held?.element.removeAttribute('data-pressed');
  held = null;
}
function press(element, pointerId) {
  if (!element || element.matches(':disabled') || element.closest('[inert]')) return;
  release();
  held = {element,pointerId};
  element.setAttribute('data-pressed','');
}
document.addEventListener('pointerdown', event => {
  if (event.isPrimary && event.button === 0) press(event.target.closest(tactile),event.pointerId);
},true);
document.addEventListener('pointermove', event => {
  if (held?.pointerId !== event.pointerId) return;
  // Touch has implicit capture, so pointerleave alone cannot detect a drag away.
  if (!held.element.contains(document.elementFromPoint(event.clientX,event.clientY))) release();
},true);
document.addEventListener('pointerout',event => {
  if (held?.pointerId === event.pointerId && !held.element.contains(event.relatedTarget)) release();
},true);
for (const type of ['pointerup','pointercancel','lostpointercapture']) {
  window.addEventListener(type,event => { if (held?.pointerId === event.pointerId) release(); },true);
}
document.addEventListener('keydown',event => {
  if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
  press(event.target.closest(tactile),null);
},true);
document.addEventListener('keyup',event => {
  if (held && held.pointerId === null && (event.key === ' ' || event.key === 'Enter')) release();
},true);
document.addEventListener('focusout',event => {
  if (held?.element === event.target && held.pointerId === null) release();
},true);
window.addEventListener('pagehide',release);
window.addEventListener('blur',release);
document.addEventListener('visibilitychange',() => { if (document.hidden) release(); });
