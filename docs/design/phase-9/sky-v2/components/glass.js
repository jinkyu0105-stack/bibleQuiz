/* global window, document, CSS, navigator, ResizeObserver, MutationObserver,
   requestAnimationFrame, cancelAnimationFrame, AbortController */
import { installDockMotion } from './dock-motion.js';

const mounts = new WeakMap();
let nextInstance = 0;

/**
 * Enhance static glass markup in a Document or Element. See README.md.
 * Selection/content remain caller-owned: hover never changes aria or inputs.
 * Mount once per non-overlapping root; remounting that root disposes its effects.
 */
export function mountGlassComponents(root = document, { prismatic = true, descendants = true } = {}) {
  mounts.get(root)?.destroy();
  const instance = nextInstance++;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const reduceTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const decorations = [], restorations = [];
  const find = selector => [...(root.matches?.(selector) ? [root] : []), ...[...root.querySelectorAll(selector)].filter(element => descendants || decorations.includes(element))];
  // Restore only properties owned by the effect; preserve content, selection,
  // and any unrelated inline styles changed by the caller while mounted.
  function remember(element, attributes, properties = []) {
    const saved = attributes.map(name => [name, element.getAttribute(name)]);
    const styles = properties.map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    restorations.push(() => {
      for (const [name, value] of saved) {
        if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
      }
      for (const [name, value, priority] of styles) {
        if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
      }
    });
  }
  for (const element of find('[data-glass-panel], .glass-action, .glass-segmented, [data-glass-lens], [data-glint]')) {
    remember(element, ['data-glint', 'data-glint-shape', 'data-glint-feather', 'data-glint-active',
      'data-glass-lens', 'data-lens-ready', 'data-selection-ready', 'data-dock-motion',
      'data-dock-material', 'data-dock-axis', 'data-dock-visible', 'data-dock-previewing', 'data-dock-moving'],
    ['--glass-optics', '--glint-x', '--glint-y']);
    for (const item of element.querySelectorAll(':scope > a, :scope > button')) remember(item, ['data-dock-preview']);
  }
  function decorate(element, className) {
    const decoration = document.createElement('span');
    decoration.className = className; decoration.setAttribute('aria-hidden', 'true');
    element.prepend(decoration); decorations.push(decoration);
  }
  if (prismatic) {
    for (const panel of find('[data-glass-panel]')) {
      panel.dataset.glint = '';
      panel.dataset.glintFeather = '';
      if (panel.dataset.glassPanel === 'reading') {
        panel.dataset.glintShape = 'reading-rim';
        panel.dataset.glassLens = 'reading-header';
        decorate(panel, 'glass-reading-core');
      } else if (!panel.dataset.glintShape) panel.dataset.glintShape = 'feather';
      decorate(panel, 'glass-rim-glow');
    }
    for (const action of find('.glass-action')) {
      const hadLens = action.classList.contains('convex-lens');
      action.classList.add('convex-lens');
      action.dataset.glassLens = 'convex'; action.dataset.glint = '';
      restorations.push(() => { if (!hadLens) action.classList.remove('convex-lens'); });
    }
  }
  const groups = find('.glass-segmented').map(element => {
    const indicator = document.createElement('span');
    indicator.className = 'glass-indicator'; indicator.setAttribute('aria-hidden', 'true');
    element.prepend(indicator); decorations.push(indicator);
    const motion = prismatic && element.dataset.glassMotion === 'elastic'
      ? installDockMotion({ element, indicator, signal, canMove }) : null;
    if (motion && element.hasAttribute('data-glass-convex')) {
      element.dataset.dockMaterial = 'convex';
      indicator.classList.add('convex-lens');
      indicator.dataset.glassLens = 'convex';
    }
    return { element, indicator, motion };
  });
  function measureSelection({ element, indicator, motion }) {
    if (motion) { motion.measure(); return; }
    const selected = element.querySelector(':scope > [aria-pressed=true], :scope > [aria-current=page], :scope > [aria-selected=true]');
    if (!selected || !element.getClientRects().length) return;
    indicator.style.width = `${selected.offsetWidth}px`;
    indicator.style.height = `${selected.offsetHeight}px`;
    indicator.style.borderRadius = window.getComputedStyle(selected).borderRadius;
    indicator.style.setProperty('--selection-x', `${selected.offsetLeft}px`);
    indicator.style.setProperty('--selection-y', `${selected.offsetTop}px`);
    element.dataset.selectionReady = 'true';
  }

  // Static edge-normal maps are rebuilt only when a visible control changes size.
  // CSS.supports only checks parsing: Firefox accepts SVG URLs without rendering
  // this backdrop displacement. Enable that enhancement on verified Chromium;
  // other engines retain the ordinary CSS blur, tint and edge highlights.
  const svgNS = 'http://www.w3.org/2000/svg';
  const filters = document.createElementNS(svgNS, 'svg');
  filters.classList.add('liquid-filter-definitions');
  filters.setAttribute('aria-hidden', 'true'); filters.setAttribute('focusable', 'false');
  const defs = document.createElementNS(svgNS, 'defs'); filters.append(defs); document.body.append(filters);
  // Some Chromium builds do not expose window.chrome. This narrow engine gate
  // is paired with a real pixel-difference check in the review verification.
  const chromiumEngine = /(?:Chrome|Chromium)\/\d+/.test(navigator.userAgent) && !/(?:OPiOS|CriOS|FxiOS)/.test(navigator.userAgent);
  const canLens = (prismatic ? chromiumEngine : Boolean(window.chrome)) && CSS.supports('backdrop-filter', 'url("#liquid-edge")');
  const lenses = canLens ? find('[data-glass-lens]').map((element, index) => {
    const flexible = element.dataset.glassLens === 'convex';
    const filter = document.createElementNS(svgNS, 'filter');
    const id = `liquid-edge-${instance}-${index}`;
    filter.id = id;
    filter.setAttribute('filterUnits', flexible ? 'objectBoundingBox' : 'userSpaceOnUse');
    if (flexible) filter.setAttribute('primitiveUnits', 'objectBoundingBox');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    const map = document.createElementNS(svgNS, 'feImage');
    map.setAttribute('result', 'edge-map'); map.setAttribute('preserveAspectRatio', 'none');
    filter.append(map);
    // Three slightly different paths separate the backdrop's colours only at
    // the curved edge. The centre of the normal map remains neutral.
    const channels = prismatic ? [
      { name: 'red', scale: flexible ? .28 : 18, matrix: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'green', scale: flexible ? .26 : 14, matrix: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'blue', scale: flexible ? .24 : 10, matrix: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' },
    ] : [{ name: 'all', scale: 16 }];
    for (const channel of channels) {
      const bend = document.createElementNS(svgNS, 'feDisplacementMap');
      bend.setAttribute('in', 'SourceGraphic'); bend.setAttribute('in2', 'edge-map');
      bend.setAttribute('xChannelSelector', 'R'); bend.setAttribute('yChannelSelector', 'G');
      bend.setAttribute('scale', String(channel.scale));
      bend.setAttribute('result', `${channel.name}-bend`); filter.append(bend);
      if (channel.matrix) {
        const isolate = document.createElementNS(svgNS, 'feColorMatrix');
        isolate.setAttribute('in', `${channel.name}-bend`); isolate.setAttribute('type', 'matrix');
        isolate.setAttribute('values', channel.matrix); isolate.setAttribute('result', channel.name);
        filter.append(isolate);
      }
    }
    if (prismatic) {
      for (const [first, second, result] of [['red', 'green', 'red-green'], ['red-green', 'blue', 'spectrum']]) {
        const blend = document.createElementNS(svgNS, 'feBlend');
        blend.setAttribute('in', first); blend.setAttribute('in2', second);
        blend.setAttribute('mode', 'screen'); blend.setAttribute('result', result); filter.append(blend);
      }
    }
    const soften = document.createElementNS(svgNS, 'feGaussianBlur');
    soften.setAttribute('stdDeviation', flexible ? '.0035' : prismatic ? '.35' : '.7');
    filter.append(soften); defs.append(filter);
    return { element, filter, map, id, flexible, size: '' };
  }) : [];
  function measureLens(lens) {
    const { element, filter, map, id, flexible } = lens;
    // A normalized capsule follows the spring's dimensions. Rebuild only
    // when its layout axis changes, never for an animation frame.
    const vertical = flexible && element.parentElement.dataset.dockAxis === 'y';
    const width = flexible ? (vertical ? 84 : 128) : element.clientWidth;
    const height = flexible ? (vertical ? 128 : 84) : element.clientHeight;
    if (width < 1 || height < 1) return;
    const radius = flexible ? 42 : Math.min(parseFloat(window.getComputedStyle(element).borderTopLeftRadius), width / 2, height / 2);
    const size = `${width}:${height}:${radius}`;
    if (size === lens.size) return;
    lens.size = size;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(width, height);
    const reading = element.dataset.glassLens === 'reading';
    // Home cards share the header's clear outer refraction; their separate
    // inset reading surface supplies the stronger blur behind text.
    const edge = Math.min(flexible ? 18 : reading ? 22 : 16, radius);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = x + .5 - Math.max(radius, Math.min(width - radius, x + .5));
      const dy = y + .5 - Math.max(radius, Math.min(height - radius, y + .5));
      const distance = Math.hypot(dx, dy);
      const inside = radius - distance;
      // The convex capsule samples inward, magnifying its inner backdrop at
      // the shoulder without pulling empty pixels across its outer border.
      const strength = distance > 0 && inside >= 0 && inside < edge ? Math.sin(Math.PI * inside / edge) * (flexible || reading ? -112 : 112) : 0;
      const offset = (y * width + x) * 4;
      pixels.data[offset] = 128 + (distance ? dx / distance * strength : 0);
      pixels.data[offset + 1] = 128 + (distance ? dy / distance * strength : 0);
      pixels.data[offset + 2] = 128; pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    filter.setAttribute('width', String(flexible ? 1 : width)); filter.setAttribute('height', String(flexible ? 1 : height));
    map.setAttribute('width', String(flexible ? 1 : width)); map.setAttribute('height', String(flexible ? 1 : height));
    map.setAttribute('href', canvas.toDataURL());
    element.style.setProperty('--glass-optics', flexible ? `url("#${id}")` : prismatic ? `blur(${reading ? 14 : 1.5}px) url("#${id}")` : `url("#${id}") blur(3px)`);
    element.dataset.lensReady = 'true';
  }
  let measurementFrame = 0;
  function scheduleMeasurement() {
    if (signal.aborted || measurementFrame) return;
    measurementFrame = requestAnimationFrame(() => {
      measurementFrame = 0;
      groups.forEach(measureSelection); lenses.forEach(measureLens);
    });
  }
  const resize = new ResizeObserver(scheduleMeasurement);
  for (const { element } of [...groups, ...lenses.filter(lens => !lens.flexible)]) resize.observe(element);
  const selection = new MutationObserver(records => {
    for (const group of groups) if (records.some(record => group.element.contains(record.target))) {
      if (group.motion) group.motion.syncSelection(); else measureSelection(group);
    }
  });
  for (const { element } of groups) selection.observe(element, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current', 'aria-selected'] });
  scheduleMeasurement();
  document.fonts.ready.then(() => { if (!signal.aborted) scheduleMeasurement(); });

  let glintFrame = 0, activeGlass = null, pending = null;
  function clearGlint() {
    cancelAnimationFrame(glintFrame); glintFrame = 0; pending = null;
    activeGlass?.removeAttribute('data-glint-active');
    activeGlass?.style.removeProperty('--glint-x'); activeGlass?.style.removeProperty('--glint-y');
    activeGlass = null;
  }
  function canMove() { return !reduceTransparency.matches && document.body.dataset.transparency !== 'reduced' && finePointer.matches && !reduceMotion.matches && document.body.dataset.motion !== 'off' && !document.hidden; }
  for (const element of find('[data-glint]')) {
    element.addEventListener('pointermove', event => {
      // Nested arrow lenses own their pointer; the parent card must not steal it.
      if (!canMove() || event.target.closest('[data-glint]') !== element) return;
      if (activeGlass !== element) { clearGlint(); activeGlass = element; }
      pending = { x: event.clientX, y: event.clientY };
      if (glintFrame) return;
      glintFrame = requestAnimationFrame(() => {
        glintFrame = 0;
        if (!pending || !activeGlass || !canMove()) return;
        activeGlass.dataset.glintActive = '';
        const box = activeGlass.getBoundingClientRect();
        activeGlass.style.setProperty('--glint-x', `${((pending.x - box.left) / box.width * 100).toFixed(1)}%`);
        activeGlass.style.setProperty('--glint-y', `${((pending.y - box.top) / box.height * 100).toFixed(1)}%`);
      });
    }, { passive: true, signal });
    element.addEventListener('pointerleave', clearGlint, { signal });
  }
  function resetInteraction() {
    clearGlint();
    for (const group of groups) group.motion?.reset();
  }
  const motion = new MutationObserver(resetInteraction);
  motion.observe(document.body, { attributes: true, attributeFilter: ['data-motion', 'data-transparency'] });
  reduceMotion.addEventListener('change', resetInteraction, { signal });
  reduceTransparency.addEventListener('change', resetInteraction, { signal });
  finePointer.addEventListener('change', resetInteraction, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInteraction(); }, { signal });
  function destroy() {
    if (signal.aborted) return;
    resetInteraction();
    lifetime.abort();
    cancelAnimationFrame(measurementFrame);
    resize.disconnect(); selection.disconnect(); motion.disconnect();
    filters.remove();
    for (const decoration of decorations) decoration.remove();
    for (const restore of restorations.reverse()) restore();
    mounts.delete(root);
  }
  const controller = { refresh: scheduleMeasurement, destroy };
  mounts.set(root, controller);
  window.addEventListener('pagehide', event => {
    resetInteraction();
    if (!event.persisted) destroy();
  }, { signal });
  return controller;
}
