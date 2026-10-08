/* global window, document, URLSearchParams */
// The user's baked dawn color replaces the photo grade only while this layer is visible.
export function createSkyVideo(vault, wake, onPlaybackPolicyChange) {
  const layer = vault.querySelector('.sky-video');
  const poster = layer.querySelector('img');
  const video = layer.querySelector('video');
  const enabled = new URLSearchParams(window.location.search).get('video') !== 'off';
  let state = { theme: '', visible: false, moving: false, width: 0 };
  let posterRequested = false, posterReady = false, frameReady = false;
  let source = '', failed = false, blocked = false, reportedBlocked = false;
  let pendingPlay = null, generation = 0, disposed = false;
  const directory = 'assets/video/';
  video.muted = true;

  function eligible() { return enabled && state.theme === 'dawn' && state.visible; }
  function wantsPlayback() { return eligible() && state.moving && !document.hidden && !disposed; }
  function policyBlocked() { return blocked && eligible(); }
  function notifyPolicy() {
    if (reportedBlocked === policyBlocked()) return;
    reportedBlocked = policyBlocked(); onPlaybackPolicyChange();
  }
  function refresh() {
    if (disposed) return;
    const active = eligible() && (posterReady || frameReady);
    layer.hidden = !active;
    video.hidden = !frameReady;
    const shown = active ? 'on' : 'off';
    if (document.body.dataset.skyVideo !== shown) document.body.dataset.skyVideo = shown;
    const status = failed ? 'error' : blocked ? 'blocked' : !source ? 'poster' : !frameReady ? 'loading' : video.paused ? 'paused' : 'playing';
    if (video.dataset.state !== status) video.dataset.state = status;
    notifyPolicy(); wake();
  }
  async function loadPoster() {
    try { await poster.decode(); posterReady = true; } catch { posterReady = false; }
    refresh();
  }
  function ready() { frameReady = true; refresh(); }
  function fail() { failed = true; frameReady = false; video.pause(); refresh(); }
  function play() {
    if (pendingPlay || blocked || failed || !video.paused || !source) return;
    const requestGeneration = generation;
    const attempt = video.play();
    pendingPlay = attempt;
    attempt.then(() => {
      if (requestGeneration === generation && !wantsPlayback()) video.pause();
    }).catch(error => {
      if (disposed || requestGeneration !== generation || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') blocked = true;
      else { failed = true; frameReady = false; }
    }).finally(() => {
      if (pendingPlay === attempt) pendingPlay = null;
      refresh();
    });
  }
  function update(next) {
    state = next;
    if (disposed) return false;
    if (eligible() && !posterRequested) {
      posterRequested = true;
      poster.srcset = `${directory}sky-dawn-poster-small.webp 1280w, ${directory}sky-dawn-poster-4k.webp 3840w`;
      poster.sizes = '100vw';
      poster.src = `${directory}sky-dawn-poster-4k.webp`;
    }
    if (wantsPlayback() && !failed && !blocked) {
      // Request a movie only for a visible, moving dawn hero. Upgrade once on widening.
      const wanted = state.width <= 700 ? '1080p' : '4k';
      if (!source || source === '1080p' && wanted === '4k') {
        generation++; frameReady = false; source = wanted;
        video.src = `${directory}sky-dawn-${source}.mp4`;
        video.load();
      }
      play();
    } else if (!video.paused) video.pause();
    const active = eligible() && (posterReady || frameReady);
    layer.hidden = !active; video.hidden = !frameReady;
    // The generated clip has different endpoints. Fade into its own first frame
    // over the last .9s; the native loop resumes at that same picture, not a cut.
    const end = Math.max(0, Math.min(1, (video.currentTime - (video.duration - .9)) / .9));
    const blend = !frameReady ? 1 : posterReady && Number.isFinite(end) ? end * end * (3 - 2 * end) : 0;
    const opacity = blend.toFixed(4);
    if (poster.style.opacity !== opacity) poster.style.opacity = opacity;
    const shown = active ? 'on' : 'off';
    if (document.body.dataset.skyVideo !== shown) document.body.dataset.skyVideo = shown;
    notifyPolicy();
    return active;
  }
  function visibility() {
    if (document.hidden) video.pause();
    refresh();
  }
  function pagehide() { video.pause(); }
  function dispose() {
    disposed = true; generation++; video.pause();
    poster.removeEventListener('load', loadPoster);
    video.removeEventListener('loadeddata', ready); video.removeEventListener('playing', ready);
    video.removeEventListener('pause', refresh); video.removeEventListener('error', fail);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    video.removeAttribute('src'); video.load();
  }
  poster.addEventListener('load', loadPoster);
  video.addEventListener('loadeddata', ready); video.addEventListener('playing', ready);
  video.addEventListener('pause', refresh); video.addEventListener('error', fail);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  return {
    update, dispose,
    get blocked() { return policyBlocked(); },
    retry() {
      blocked = false; state = { ...state, moving: true };
      if (wantsPlayback()) play(); // Preserve the click gesture on stricter autoplay policies.
      notifyPolicy();
    },
  };
}
