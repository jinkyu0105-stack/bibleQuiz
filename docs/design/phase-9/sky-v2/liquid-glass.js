/* global window, document, URLSearchParams, CSS, ResizeObserver, MutationObserver,
   requestAnimationFrame, cancelAnimationFrame, AbortController */
// A web material inspired by Apple. The optical map is original procedural code;
// it distorts only a backdrop pseudo-element, never labels, inputs or content.
export function installLiquidGlass() {
  const params = new URLSearchParams(window.location.search);
  const classic = params.get('glass') === 'off';
  const clarityButton = document.querySelector('#glass-clarity');
  document.querySelector('#liquid-glass-style').disabled = classic;
  document.body.dataset.glass = classic ? 'off' : 'on';
  function preserveChoice(key, value) {
    for (const link of document.querySelectorAll('a[href^="?view="]')) {
      const [path, hash] = link.getAttribute('href').split('#');
      const query = new URLSearchParams(path.slice(1));
      if (value) query.set(key, value); else query.delete(key);
      link.setAttribute('href', `?${query}${hash ? `#${hash}` : ''}`);
    }
  }
  if (classic) { preserveChoice('glass', 'off'); return; }
  clarityButton.hidden = false;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const reduceTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let manualClarity = params.get('clarity') === 'high';
  function syncClarity() {
    const high = manualClarity || reduceTransparency.matches;
    document.body.dataset.transparency = high ? 'reduced' : 'normal';
    clarityButton.setAttribute('aria-pressed', String(high));
    clarityButton.disabled = reduceTransparency.matches;
    clarityButton.setAttribute('aria-label', reduceTransparency.matches ? '시스템 투명도 감소 적용 중' : high ? '유리 투명도 복원' : '투명도 줄이기');
    clarityButton.title = clarityButton.getAttribute('aria-label');
    preserveChoice('clarity', manualClarity ? 'high' : '');
  }
  clarityButton.addEventListener('click', () => {
    manualClarity = !manualClarity;
    const query = new URLSearchParams(window.location.search);
    if (manualClarity) query.set('clarity', 'high'); else query.delete('clarity');
    window.history.replaceState(null, '', `?${query}${window.location.hash}`);
    syncClarity();
  }, { signal });
  reduceTransparency.addEventListener('change', syncClarity, { signal });
  syncClarity();

  const groups = [...document.querySelectorAll('.glass-segmented')].map(element => {
    const indicator = document.createElement('span');
    indicator.className = 'glass-indicator'; indicator.setAttribute('aria-hidden', 'true');
    element.prepend(indicator);
    return { element, indicator };
  });
  function measureSelection({ element, indicator }) {
    const selected = element.querySelector(':scope > [aria-pressed=true], :scope > [aria-current=page]');
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
  const canLens = Boolean(window.chrome) && CSS.supports('backdrop-filter', 'url("#liquid-edge")');
  const lenses = canLens ? [...document.querySelectorAll('[data-glass-lens]')].map((element, index) => {
    const filter = document.createElementNS(svgNS, 'filter');
    const id = `liquid-edge-${index}`;
    filter.id = id;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    const map = document.createElementNS(svgNS, 'feImage');
    map.setAttribute('result', 'edge-map'); map.setAttribute('preserveAspectRatio', 'none');
    const bend = document.createElementNS(svgNS, 'feDisplacementMap');
    bend.setAttribute('in', 'SourceGraphic'); bend.setAttribute('in2', 'edge-map');
    bend.setAttribute('xChannelSelector', 'R'); bend.setAttribute('yChannelSelector', 'G');
    bend.setAttribute('scale', '16');
    const soften = document.createElementNS(svgNS, 'feGaussianBlur');
    soften.setAttribute('stdDeviation', '.7');
    filter.append(map, bend, soften); defs.append(filter);
    return { element, filter, map, id, size: '' };
  }) : [];
  function measureLens(lens) {
    const { element, filter, map, id } = lens;
    const width = element.clientWidth, height = element.clientHeight;
    if (width < 1 || height < 1) return;
    const radius = Math.min(parseFloat(window.getComputedStyle(element).borderTopLeftRadius), width / 2, height / 2);
    const size = `${width}:${height}:${radius}`;
    if (size === lens.size) return;
    lens.size = size;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(width, height);
    const edge = Math.min(16, radius);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = x + .5 - Math.max(radius, Math.min(width - radius, x + .5));
      const dy = y + .5 - Math.max(radius, Math.min(height - radius, y + .5));
      const distance = Math.hypot(dx, dy);
      const inside = radius - distance;
      const strength = distance > 0 && inside >= 0 && inside < edge ? Math.sin(Math.PI * inside / edge) * 112 : 0;
      const offset = (y * width + x) * 4;
      pixels.data[offset] = 128 + (distance ? dx / distance * strength : 0);
      pixels.data[offset + 1] = 128 + (distance ? dy / distance * strength : 0);
      pixels.data[offset + 2] = 128; pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    filter.setAttribute('width', String(width)); filter.setAttribute('height', String(height));
    map.setAttribute('width', String(width)); map.setAttribute('height', String(height));
    map.setAttribute('href', canvas.toDataURL());
    element.style.setProperty('--glass-optics', `url("#${id}") blur(3px)`);
    element.dataset.lensReady = 'true';
  }
  let measurementFrame = 0;
  function scheduleMeasurement() {
    if (measurementFrame) return;
    measurementFrame = requestAnimationFrame(() => {
      measurementFrame = 0;
      groups.forEach(measureSelection); lenses.forEach(measureLens);
    });
  }
  const resize = new ResizeObserver(scheduleMeasurement);
  for (const { element } of [...groups, ...lenses]) resize.observe(element);
  const selection = new MutationObserver(scheduleMeasurement);
  for (const { element } of groups) selection.observe(element, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] });
  scheduleMeasurement();
  document.fonts.ready.then(() => { if (!signal.aborted) scheduleMeasurement(); });

  let glintFrame = 0, activeGlass = null, pending = null;
  function clearGlint() {
    cancelAnimationFrame(glintFrame); glintFrame = 0; pending = null;
    activeGlass?.style.removeProperty('--glint-x'); activeGlass?.style.removeProperty('--glint-y');
    activeGlass = null;
  }
  function canMove() { return finePointer.matches && !reduceMotion.matches && document.body.dataset.motion !== 'off' && !document.hidden; }
  for (const element of document.querySelectorAll('[data-glint]')) {
    element.addEventListener('pointermove', event => {
      if (!canMove()) return;
      if (activeGlass !== element) { clearGlint(); activeGlass = element; }
      pending = { x: event.clientX, y: event.clientY };
      if (glintFrame) return;
      glintFrame = requestAnimationFrame(() => {
        glintFrame = 0;
        if (!pending || !activeGlass || !canMove()) return;
        const box = activeGlass.getBoundingClientRect();
        activeGlass.style.setProperty('--glint-x', `${((pending.x - box.left) / box.width * 100).toFixed(1)}%`);
        activeGlass.style.setProperty('--glint-y', `${((pending.y - box.top) / box.height * 100).toFixed(1)}%`);
      });
    }, { passive: true, signal });
    element.addEventListener('pointerleave', clearGlint, { signal });
  }
  const motion = new MutationObserver(clearGlint);
  motion.observe(document.body, { attributes: true, attributeFilter: ['data-motion'] });
  reduceMotion.addEventListener('change', clearGlint, { signal });
  finePointer.addEventListener('change', clearGlint, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearGlint(); }, { signal });
  window.addEventListener('pagehide', event => {
    clearGlint();
    if (event.persisted) return;
    cancelAnimationFrame(measurementFrame);
    resize.disconnect(); selection.disconnect(); motion.disconnect(); lifetime.abort();
  }, { signal });
}
