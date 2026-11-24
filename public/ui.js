const formatter = new Intl.NumberFormat('zh-CN');
export const num = value => formatter.format(value);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const template = id => document.getElementById(id).content.firstElementChild.cloneNode(true);

export function text(node, value) {
  const next = String(value);
  if (node.textContent !== next) node.textContent = next;
}

// Keep existing seats, rows and focus targets alive when a snapshot arrives.
export function reconcile(parent, items, keyFor, create, update) {
  const existing = new Map(Array.from(parent.children, node => [node.dataset.key, node]));
  items.forEach((item, index) => {
    const key = String(keyFor(item, index));
    const node = existing.get(key) || create(item, index);
    node.dataset.key = key;
    update(node, item, index);
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);
    existing.delete(key);
  });
  existing.forEach(node => node.remove());
}

let touchGlintShown = false;

export function mountLobbyArt(art) {
  if (reducedMotion()) return;
  if (window.matchMedia('(hover:none) and (pointer:coarse)').matches) {
    try { touchGlintShown ||= sessionStorage.getItem('chip-room-art-glint') === 'seen'; } catch {}
    if (touchGlintShown) return;
    art.querySelector('img').decode().then(() => {
      if (!art.isConnected || touchGlintShown || reducedMotion()) return;
      touchGlintShown = true;
      try { sessionStorage.setItem('chip-room-art-glint','seen'); } catch {}
      art.classList.add('glint');
      art.addEventListener('animationend',() => art.classList.remove('glint'),{once:true});
    }).catch(() => {});
    return;
  }

  const desktop = window.matchMedia('(min-width:781px) and (hover:hover) and (pointer:fine)');
  art.addEventListener('pointermove',event => {
    if (!desktop.matches || reducedMotion() || event.pointerType === 'touch') return;
    const bounds = art.getBoundingClientRect();
    const x = (event.clientX-bounds.left)/bounds.width - .5;
    const y = (event.clientY-bounds.top)/bounds.height - .5;
    art.style.setProperty('--tilt-x',(-6*y).toFixed(2)+'deg');
    art.style.setProperty('--tilt-y',(9*x).toFixed(2)+'deg');
    art.style.setProperty('--light-x',(50-52*x).toFixed(1)+'%');
    art.style.setProperty('--light-y',(50-48*y).toFixed(1)+'%');
    art.classList.add('is-lit');
  });
  function settle() {
    art.classList.remove('is-lit');
    for (const key of ['--tilt-x','--tilt-y','--light-x','--light-y']) art.style.removeProperty(key);
  }
  art.addEventListener('pointerleave',settle);
  art.addEventListener('pointercancel',settle);
}
