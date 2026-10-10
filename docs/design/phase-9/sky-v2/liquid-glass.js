/* global window, document, URLSearchParams, AbortController */
import { mountGlassComponents } from './components/glass.js?v=20261010-components-1';
// A web material inspired by Apple. The optical map is original procedural code;
// it distorts only a backdrop pseudo-element, never labels, inputs or content.
export function installLiquidGlass() {
  const params = new URLSearchParams(window.location.search);
  const classic = params.get('glass') === 'off';
  const prismatic = !classic && params.get('glass') !== 'soft';
  const clarityButton = document.querySelector('#glass-clarity');
  document.querySelector('#liquid-glass-style').disabled = classic;
  document.querySelector('#prismatic-glass-style').disabled = !prismatic;
  document.body.dataset.glass = classic ? 'off' : 'on';
  document.body.dataset.glassMaterial = prismatic ? 'prism' : 'soft';
  function preserveChoice(key, value) {
    for (const link of document.querySelectorAll('a[href^="?view="]')) {
      const [path, hash] = link.getAttribute('href').split('#');
      const query = new URLSearchParams(path.slice(1));
      if (value) query.set(key, value); else query.delete(key);
      link.setAttribute('href', `?${query}${hash ? `#${hash}` : ''}`);
    }
  }
  // Review-only comparison: restore both original glints, or try either
  // experiment independently without changing the glass material or video.
  const glint = ['original', 'header', 'dock'].includes(params.get('glint')) ? params.get('glint') : 'both';
  document.body.dataset.glintComparison = glint;
  preserveChoice('glint', params.has('glint') ? glint : '');
  // Keep the header light on its rim; preserve previous review choices.
  const headerGlint = ['spot', 'straight', 'flare'].includes(params.get('header-glint')) ? params.get('header-glint') : 'edge';
  preserveChoice('header-glint', params.has('header-glint') ? headerGlint : '');
  const elasticDock = params.get('dock-motion') !== 'off';
  preserveChoice('dock-motion', params.has('dock-motion') ? (elasticDock ? 'elastic' : 'off') : '');
  const convexDock = params.get('dock-material') !== 'flat';
  preserveChoice('dock-material', params.has('dock-material') ? (convexDock ? 'convex' : 'flat') : '');
  const expandedMenus = params.get('menu-glass') !== 'off';
  const menuGlass = prismatic && expandedMenus;
  preserveChoice('menu-glass', params.has('menu-glass') ? (expandedMenus ? 'on' : 'off') : '');
  if (classic) { preserveChoice('glass', 'off'); return; }
  if (!prismatic) preserveChoice('glass', 'soft');
  clarityButton.hidden = false;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const reduceTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
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

  if (menuGlass) {
    document.querySelector('.public-nav').classList.add('glass-segmented');
    const levelSwitch = document.querySelector('.level-switch');
    levelSwitch.dataset.glassLens = ''; levelSwitch.dataset.glint = '';
    levelSwitch.dataset.glintShape = 'spot';
    document.querySelector('.admin-sidebar nav').classList.add('glass-segmented');
    const admin = document.querySelector('.admin-link');
    admin.classList.add('glass-action');
  }
  if (prismatic) {
    if (glint === 'both' || glint === 'header') document.querySelector('.site-header').dataset.glintShape = headerGlint === 'straight' ? 'vertical' : headerGlint;
    if (glint === 'both' || glint === 'dock') document.querySelector('.review-switch').dataset.glintShape = 'spot';
    const dock = document.querySelector('.review-switch');
    if (elasticDock) dock.dataset.glassMotion = 'elastic';
    if (elasticDock && convexDock) dock.dataset.glassConvex = '';
    if (menuGlass) for (const menu of document.querySelectorAll('.public-nav, .time-options, .level-switch, .content-tabs, .admin-sidebar nav')) {
      menu.dataset.glassMotion = 'elastic';
      menu.dataset.glassConvex = '';
    }
  }
  const components = mountGlassComponents(document, { prismatic });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { components.destroy(); lifetime.abort(); }
  }, { signal });
}
