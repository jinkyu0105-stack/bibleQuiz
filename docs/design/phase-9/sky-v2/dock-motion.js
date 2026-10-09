/* global window, document, requestAnimationFrame, cancelAnimationFrame */
// Review dock only. The glass stretches; link labels and hit areas stay fixed.
export function installDockMotion({ element, indicator, signal, canMove }) {
  const links = [...element.querySelectorAll(':scope > a[data-view-link]')];
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const spring = (value = 0) => ({ value, velocity: 0 });
  const state = { x: spring(), width: spring(), stretch: spring(), lift: spring() };
  let boxes = [], target = null, hovered = null, frame = 0, previousTime = 0, ready = false;
  const selected = () => links.find(link => link.getAttribute('aria-current') === 'page') || links[0];
  const focused = () => links.find(link => link === document.activeElement && link.matches(':focus-visible'));
  const enabled = () => canMove() && !forcedColors.matches;
  element.dataset.dockMotion = 'elastic';

  function render() {
    const stretch = state.stretch.value, lift = state.lift.value;
    const scaleX = 1 + stretch, scaleY = 1 + lift * .08 - stretch * .35;
    const halfWidth = state.width.value * scaleX / 2;
    // Keep the glass out of the title and within the dock, including reversals.
    const x = clamp(state.x.value, boxes[0].left + halfWidth - 2, boxes.at(-1).right - halfWidth + 2);
    indicator.style.width = `${state.width.value.toFixed(2)}px`;
    indicator.style.height = `${target.height}px`;
    indicator.style.setProperty('--selection-x', `${(x - state.width.value / 2).toFixed(2)}px`);
    indicator.style.setProperty('--selection-y', `${target.top}px`);
    indicator.style.setProperty('--dock-scale-x', scaleX.toFixed(4));
    indicator.style.setProperty('--dock-scale-y', scaleY.toFixed(4));
    indicator.style.setProperty('--dock-lift', clamp(lift, 0, 1).toFixed(3));
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    delete element.dataset.dockMoving;
  }
  function snap() {
    stop();
    for (const [key, value] of Object.entries({ x: target.x, width: target.width, stretch: 0, lift: 0 })) {
      state[key].value = value; state[key].velocity = 0;
    }
    render();
  }
  function step(part, destination, stiffness, damping, dt) {
    part.velocity += ((destination - part.value) * stiffness - part.velocity * damping) * dt;
    part.value += part.velocity * dt;
  }
  function animate(time) {
    frame = 0;
    if (!enabled()) { reset(); return; }
    // Small substeps keep the same spring stable at different refresh rates.
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, .05) : 1 / 60;
    previousTime = time;
    const count = Math.ceil(elapsed * 120), dt = elapsed / count;
    const lift = hovered || focused() ? 1 : 0;
    for (let i = 0; i < count; i++) {
      step(state.x, target.x, 380, 27, dt);
      step(state.width, target.width, 380, 27, dt);
      step(state.stretch, Math.min(Math.abs(state.x.velocity) / 1900, .32), 480, 30, dt);
      step(state.lift, lift, 360, 25, dt);
    }
    render();
    const resting = Math.abs(state.x.value - target.x) < .08 && Math.abs(state.x.velocity) < .2 &&
      Math.abs(state.width.value - target.width) < .08 && Math.abs(state.width.velocity) < .2 &&
      Math.abs(state.stretch.value) < .001 && Math.abs(state.stretch.velocity) < .005 &&
      Math.abs(state.lift.value - lift) < .001 && Math.abs(state.lift.velocity) < .005;
    if (resting) {
      stop();
      state.x.value = target.x; state.width.value = target.width;
      state.stretch.value = 0; state.lift.value = lift;
      for (const part of Object.values(state)) part.velocity = 0;
      render();
    } else frame = requestAnimationFrame(animate);
  }
  function aim(link, offset = 0) {
    const box = boxes.find(box => box.link === link);
    if (!box) return;
    target = { ...box, x: box.center + offset };
    element.toggleAttribute('data-dock-previewing', enabled() && link !== selected());
    for (const item of links) item.toggleAttribute('data-dock-preview', enabled() && item === link);
    if (!ready || !enabled()) { snap(); ready = true; return; }
    if (!frame) { element.dataset.dockMoving = ''; frame = requestAnimationFrame(animate); }
  }
  function reset() {
    hovered = null;
    if (boxes.length) { aim(selected()); snap(); }
    element.removeAttribute('data-dock-previewing');
    for (const link of links) link.removeAttribute('data-dock-preview');
  }
  function measure() {
    if (!element.getClientRects().length) return;
    boxes = links.map(link => ({ link, left: link.offsetLeft, right: link.offsetLeft + link.offsetWidth,
      center: link.offsetLeft + link.offsetWidth / 2, top: link.offsetTop,
      width: link.offsetWidth, height: link.offsetHeight }));
    indicator.style.borderRadius = window.getComputedStyle(selected()).borderRadius;
    // A resize/font load remeasures immediately, without retaining old geometry.
    hovered = null; aim(enabled() ? focused() || selected() : selected()); snap();
    element.dataset.selectionReady = 'true';
  }
  function leave() {
    hovered = null; aim(enabled() ? focused() || selected() : selected());
  }
  element.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !enabled() || !boxes.length) return;
    const x = event.clientX - element.getBoundingClientRect().left - element.clientLeft;
    if (x < boxes[0].left || x > boxes.at(-1).right) { if (hovered) leave(); return; }
    const box = boxes.reduce((nearest, box) => Math.abs(box.center - x) < Math.abs(nearest.center - x) ? box : nearest);
    hovered = box.link;
    aim(hovered, clamp((x - box.center) * .22, -6, 6));
  }, { passive: true, signal });
  element.addEventListener('pointerleave', leave, { signal });
  element.addEventListener('pointercancel', reset, { signal });
  element.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') reset(); }, { passive: true, signal });
  element.addEventListener('focusin', () => { if (enabled() && focused()) aim(focused()); }, { signal });
  element.addEventListener('focusout', () => { if (!hovered) aim(selected()); }, { signal });
  window.addEventListener('blur', reset, { signal });
  forcedColors.addEventListener('change', reset, { signal });
  signal.addEventListener('abort', stop, { once: true });
  return { measure, reset };
}
