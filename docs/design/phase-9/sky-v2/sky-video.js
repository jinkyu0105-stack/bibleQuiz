/* global window, document, URLSearchParams */
// Each supplied movie carries its own time-of-day colour, without the photo grade.
export function createSkyVideo(vault, wake, onPlaybackPolicyChange, media = null) {
  const layer = vault.querySelector('.sky-video');
  const poster = layer.querySelector('img');
  const video = layer.querySelector('video');
  const enabled = new URLSearchParams(window.location.search).get('video') !== 'off';
  let state = { theme: '', visible: false, moving: false, width: 0 };
  let posterRequested = false, posterReady = false, frameReady = false;
  let source = '', failed = false, blocked = false, reportedBlocked = false;
  let pendingPlay = null, generation = 0, posterGeneration = 0, disposed = false;
  let selectedTheme = '';
  const variant = new URLSearchParams(window.location.search).get('video');
  const nightVariant = new URLSearchParams(window.location.search).get('night-video');
  const previousNight = nightVariant === 'v1';
  const directories = {
    dawn: variant === 'calm' ? 'assets/video/'
      : variant === 'dynamic' ? 'assets/video/dynamic/' : 'assets/video/billowing/',
    day: 'assets/video/day/', dusk: 'assets/video/dusk/',
    night: previousNight ? 'assets/video/night/' : 'assets/video/night-v2/',
  };
  video.muted = true;

  function eligible() { return enabled && Boolean(media ? media[state.theme] : directories[state.theme]) && state.visible; }
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
    const requestGeneration = posterGeneration;
    let decoded = false;
    try { await poster.decode(); decoded = true; } catch { /* Keep the original sky visible. */ }
    if (disposed || requestGeneration !== posterGeneration) return;
    posterReady = decoded; refresh();
  }
  function ready() {
    if (!source || video.readyState < 2) return;
    frameReady = true; refresh();
  }
  function fail() {
    if (!source) return;
    failed = true; frameReady = false; video.pause(); refresh();
  }
  function selectTheme() {
    // Invalidate the previous decode/play before exposing another time of day.
    generation++; posterGeneration++; selectedTheme = state.theme;
    source = ''; pendingPlay = null; failed = false; blocked = false;
    posterRequested = false; posterReady = false; frameReady = false;
    layer.hidden = true; video.hidden = true; poster.style.opacity = '1';
    video.pause(); video.removeAttribute('src'); video.load();
    poster.removeAttribute('srcset'); poster.removeAttribute('src');
  }
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
    if (eligible() && selectedTheme !== state.theme) selectTheme();
    const directory = directories[selectedTheme];
    if (eligible() && !posterRequested) {
      posterRequested = true;
      poster.srcset = media ? `${media[selectedTheme].smallPoster} 1280w, ${media[selectedTheme].poster} 3840w` : `${directory}sky-${selectedTheme}-poster-small.webp 1280w, ${directory}sky-${selectedTheme}-poster-4k.webp 3840w`;
      poster.sizes = '100vw';
      poster.src = media ? media[selectedTheme].poster : `${directory}sky-${selectedTheme}-poster-4k.webp`;
    }
    if (wantsPlayback() && !failed && !blocked) {
      // Request a movie only for a visible, moving hero. Upgrade once on widening.
      const wanted = state.width <= 700 ? '1080p' : '4k';
      if (!source || source === '1080p' && wanted === '4k') {
        generation++; frameReady = false; source = wanted;
        const optimizedNight = selectedTheme === 'night' && !previousNight && nightVariant !== 'v2-original' && source === '4k';
        video.src = media ? media[selectedTheme][source === '4k' ? 'desktop' : 'mobile'] : `${directory}sky-${selectedTheme}-${source}${optimizedNight ? '-optimized' : ''}.mp4`;
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
    disposed = true; generation++; posterGeneration++; video.pause();
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
    // While the selected poster/movie is arriving the static sky is sufficient;
    // do not compile the animated-photo fallback only to hide it a moment later.
    get pending() { return eligible() && !failed && !blocked && !posterReady && !frameReady; },
    get blocked() { return policyBlocked(); },
    retry() {
      blocked = false; state = { ...state, moving: true };
      if (wantsPlayback()) play(); // Preserve the click gesture on stricter autoplay policies.
      notifyPolicy();
    },
  };
}
