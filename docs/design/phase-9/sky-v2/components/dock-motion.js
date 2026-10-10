/* global window, document, requestAnimationFrame, cancelAnimationFrame */
// Shared by glass menus, including the responsive admin navigation grid.
// Only the glass stretches; labels, hit areas and actual selection stay fixed.
export function installDockMotion({ element, indicator, signal, canMove }) {
  const links = [...element.querySelectorAll(':scope > a, :scope > button')];
  if (!links.length) return null;
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const spring = (value = 0) => ({ value, velocity: 0 });
  const state = { position: spring(), length: spring(), crossPosition: spring(), crossLength: spring(), stretch: spring(), lift: spring() };
  let boxes = [], target = null, hovered = null, frame = 0, previousTime = 0, ready = false, vertical = false;
  const selected = () => links.find(link => link.matches('[aria-current=page], [aria-pressed=true]'));
  const focused = () => links.find(link => link === document.activeElement && link.matches(':focus-visible'));
  const enabled = () => canMove() && !forcedColors.matches;
  element.dataset.dockMotion = 'elastic';

  function render() {
    const stretch = state.stretch.value, lift = state.lift.value;
    const along = 1 + stretch, across = 1 + lift * .08 - stretch * .35;
    const halfLength = state.length.value * along / 2;
    // Keep the glass within the menu, including rapid reversals.
    const position = clamp(state.position.value, Math.min(...boxes.map(box => box.start)) + halfLength - 2, Math.max(...boxes.map(box => box.end)) - halfLength + 2);
    const offset = position - state.length.value / 2;
    const crossOffset = state.crossPosition.value - state.crossLength.value / 2;
    indicator.style.width = `${(vertical ? state.crossLength.value : state.length.value).toFixed(2)}px`;
    indicator.style.height = `${(vertical ? state.length.value : state.crossLength.value).toFixed(2)}px`;
    indicator.style.setProperty('--selection-x', `${(vertical ? crossOffset : offset).toFixed(2)}px`);
    indicator.style.setProperty('--selection-y', `${(vertical ? offset : crossOffset).toFixed(2)}px`);
    indicator.style.setProperty('--dock-scale-x', (vertical ? across : along).toFixed(4));
    indicator.style.setProperty('--dock-scale-y', (vertical ? along : across).toFixed(4));
    indicator.style.setProperty('--dock-lift', clamp(lift, 0, 1).toFixed(3));
    indicator.style.setProperty('--dock-light-x', `${clamp(50 + state.position.velocity * .035, 22, 78).toFixed(1)}%`);
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    delete element.dataset.dockMoving;
  }
  function snap() {
    stop();
    for (const [key, value] of Object.entries({ position: target.position, length: target.length, crossPosition: target.crossCenter, crossLength: target.crossLength, stretch: 0, lift: 0 })) {
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
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, .05) : 1 / 60;
    previousTime = time;
    const count = Math.ceil(elapsed * 120), dt = elapsed / count;
    const lift = hovered || focused() ? 1 : 0;
    for (let i = 0; i < count; i++) {
      step(state.position, target.position, 380, 27, dt);
      step(state.length, target.length, 380, 27, dt);
      step(state.crossPosition, target.crossCenter, 380, 27, dt);
      step(state.crossLength, target.crossLength, 380, 27, dt);
      step(state.stretch, Math.min(Math.abs(state.position.velocity) / 1900, .32), 480, 30, dt);
      step(state.lift, lift, 360, 25, dt);
    }
    render();
    const resting = Math.abs(state.position.value - target.position) < .08 && Math.abs(state.position.velocity) < .2 &&
      Math.abs(state.length.value - target.length) < .08 && Math.abs(state.length.velocity) < .2 &&
      Math.abs(state.crossPosition.value - target.crossCenter) < .08 && Math.abs(state.crossPosition.velocity) < .2 &&
      Math.abs(state.crossLength.value - target.crossLength) < .08 && Math.abs(state.crossLength.velocity) < .2 &&
      Math.abs(state.stretch.value) < .001 && Math.abs(state.stretch.velocity) < .005 &&
      Math.abs(state.lift.value - lift) < .001 && Math.abs(state.lift.velocity) < .005;
    if (resting) {
      stop();
      state.position.value = target.position; state.length.value = target.length;
      state.crossPosition.value = target.crossCenter; state.crossLength.value = target.crossLength;
      state.stretch.value = 0; state.lift.value = lift;
      for (const part of Object.values(state)) part.velocity = 0;
      render();
    } else frame = requestAnimationFrame(animate);
  }
  function aim(link, offset = 0) {
    const box = boxes.find(box => box.link === (link || links[0]));
    if (!box) return;
    const wasVisible = element.hasAttribute('data-dock-visible');
    target = { ...box, position: box.center + offset };
    // Header section links have no persistent selection: show only on hover/focus.
    element.toggleAttribute('data-dock-visible', Boolean(link));
    element.toggleAttribute('data-dock-previewing', enabled() && Boolean(link) && link !== selected());
    for (const item of links) item.toggleAttribute('data-dock-preview', enabled() && item === link);
    // Fade an unselected header lens where it was, rather than jumping back
    // to the first link while it is still visible.
    if (!link && ready) { stop(); return; }
    if (!ready || !enabled()) { snap(); ready = true; return; }
    if (!wasVisible) snap();
    if (!frame) { element.dataset.dockMoving = ''; frame = requestAnimationFrame(animate); }
  }
  function reset() {
    hovered = null;
    const current = selected();
    if (boxes.length) { aim(current); if (current) snap(); }
    element.removeAttribute('data-dock-previewing');
    for (const link of links) link.removeAttribute('data-dock-preview');
  }
  function measure() {
    if (!element.getClientRects().length) { reset(); return; }
    boxes = links.map(link => ({ link, left: link.offsetLeft, top: link.offsetTop,
      width: link.offsetWidth, height: link.offsetHeight }));
    vertical = boxes.length > 1 && Math.abs(boxes[1].top - boxes[0].top) > Math.abs(boxes[1].left - boxes[0].left);
    element.dataset.dockAxis = vertical ? 'y' : 'x';
    for (const box of boxes) {
      box.start = vertical ? box.top : box.left;
      box.length = vertical ? box.height : box.width;
      box.crossLength = vertical ? box.width : box.height;
      box.crossCenter = (vertical ? box.left : box.top) + box.crossLength / 2;
      box.end = box.start + box.length; box.center = box.start + box.length / 2;
    }
    indicator.style.borderRadius = window.getComputedStyle(selected() || links[0]).borderRadius;
    hovered = null; aim(enabled() ? focused() || selected() : selected()); snap();
    element.dataset.selectionReady = 'true';
  }
  function syncSelection() {
    // A click changes the real selection without interrupting a hovered spring
    // or remeasuring the other menus on every aria-pressed update.
    aim(enabled() ? hovered || focused() || selected() : selected());
  }
  function leave() {
    hovered = null; aim(enabled() ? focused() || selected() : selected());
  }
  element.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !enabled() || !boxes.length) return;
    const bounds = element.getBoundingClientRect();
    const coordinate = vertical ? event.clientY - bounds.top - element.clientTop : event.clientX - bounds.left - element.clientLeft;
    if (coordinate < Math.min(...boxes.map(box => box.start)) || coordinate > Math.max(...boxes.map(box => box.end))) { if (hovered) leave(); return; }
    const cross = vertical ? event.clientX - bounds.left - element.clientLeft : event.clientY - bounds.top - element.clientTop;
    const distance = box => Math.hypot(box.center - coordinate, box.crossCenter - cross);
    const box = boxes.reduce((nearest, box) => distance(box) < distance(nearest) ? box : nearest);
    hovered = box.link;
    aim(hovered, clamp((coordinate - box.center) * .22, -6, 6));
  }, { passive: true, signal });
  element.addEventListener('pointerleave', leave, { signal });
  element.addEventListener('pointercancel', reset, { signal });
  element.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') reset(); }, { passive: true, signal });
  element.addEventListener('focusin', () => { if (enabled() && focused()) aim(focused()); }, { signal });
  element.addEventListener('focusout', () => { if (!hovered) aim(selected()); }, { signal });
  window.addEventListener('blur', reset, { signal });
  forcedColors.addEventListener('change', reset, { signal });
  signal.addEventListener('abort', stop, { once: true });
  return { measure, syncSelection, reset };
}
