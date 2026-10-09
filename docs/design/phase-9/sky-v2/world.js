/* global window, document, Image, performance, requestAnimationFrame, cancelAnimationFrame */
import { createSkyBanks } from './sky-banks.js';
import { createSkyVideo } from './sky-video.js';
// Original billboard world: no Air assets/code, no rendering dependencies.
export function createWorld() {
  const canvas = document.querySelector('#clouds');
  const vault = document.querySelector('.sky-vault');
  const meadow = document.querySelector('.meadow');
  const mountains = document.querySelector('.distant-mountains');
  const mountainImage = mountains.querySelector('img');
  let mountainRequested = false, mountainReady = false;
  mountainImage.addEventListener('load', async () => {
    // Large responsive photographs should be decoded before their layer is revealed.
    try { await mountainImage.decode(); mountainReady = true; } catch { mountainReady = false; }
    wake();
  });
  mountainImage.addEventListener('error', () => { mountainReady = false; wake(); });
  const grassCanvas = document.querySelector('#origin-grass');
  let groundMode = 'photo', grassField = null, grassLoading = false, grassFailed = false;
  const grassStatus = document.querySelector('#grass-status');
  const home = document.querySelector('#home-view');
  const header = document.querySelector('.site-header');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = document.querySelector('#motion');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  let program, rect, tint, alpha, flip;
  const textures = [];
  let textureSize = '', textureGeneration = 0;
  let ready = false;
  let lost = false;
  let animation = 0;
  let previous = performance.now();
  let time = 0;
  let paused = false;
  let targetProgress = 0;
  let progress = 0;
  let color = [1, 1, 1];
  let targetColor = color;
  let lastScrollY = -1;
  let width = window.innerWidth;
  let height = window.innerHeight;
  const skyBanks = createSkyBanks(vault, wake);
  const skyVideo = createSkyVideo(vault, wake, updateMotion);
  const themes = { dawn: [.94, .89, .94], day: [.99, 1, 1], dusk: [1, .81, .76], night: [.24, .36, .55] };
  // x/y are world coordinates; depth determines apparent size and camera parallax.
  const cloudNames = ['cumulus-crown', 'cumulus-tower', 'cumulus-island', 'cumulus-drift', 'cumulus-billow'];
  const clouds = [
    { x: -14, y: 21, depth: 20, size: 13, image: 2, opacity: .32, speed: .027 },
    { x: 16, y: 24, depth: 24, size: 17, image: 4, opacity: .43, speed: -.024 },
    { x: -18, y: 6, depth: 23, size: 16, image: 0, opacity: .34, speed: .028 },
    { x: 14, y: 5, depth: 20, size: 16, image: 2, opacity: .38, speed: -.031 },
    { x: 16, y: 8, depth: 18, size: 13, image: 1, opacity: .50, speed: .034 },
    { x: -2, y: 23, depth: 10, size: 8, image: 3, opacity: .54, speed: .041 },
    { x: -9.8, y: 15, depth: 9, size: 10, image: 0, opacity: .93, speed: .065 },
    { x: 9.6, y: 17, depth: 10, size: 11, image: 1, opacity: .87, speed: -.052 },
    { x: -10, y: -1, depth: 10, size: 13, image: 3, opacity: .76, speed: .050 },
    { x: 8, y: 0, depth: 12, size: 12, image: 4, opacity: .72, speed: -.043 },
  ];
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  }
  function setup() {
    if (!gl) { canvas.dataset.renderer = 'static-fallback'; return; }
    textures.length = 0;
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 aPosition; uniform vec4 uRect; uniform float uFlip; varying vec2 vUv; void main(){vUv=vec2(mix(aPosition.x,1.0-aPosition.x,uFlip),1.0-aPosition.y); gl_Position=vec4(uRect.xy+(aPosition-0.5)*uRect.zw,0.0,1.0);}');
    const fragment = compile(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D uTexture; uniform vec3 uTint; uniform float uAlpha; varying vec2 vUv; void main(){vec4 c=texture2D(uTexture,vUv); vec2 edge=smoothstep(vec2(0.0),vec2(0.025),vUv)*smoothstep(vec2(0.0),vec2(0.025),1.0-vUv); gl_FragColor=vec4(c.rgb*uTint,c.a)*uAlpha*edge.x*edge.y;}');
    if (!vertex || !fragment) { canvas.dataset.renderer = 'static-fallback'; return; }
    program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { canvas.dataset.renderer = 'static-fallback'; return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    rect = gl.getUniformLocation(program, 'uRect'); tint = gl.getUniformLocation(program, 'uTint'); alpha = gl.getUniformLocation(program, 'uAlpha'); flip = gl.getUniformLocation(program, 'uFlip');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0,0,0,0);
    textureSize = '';
    loadTextures();
  }
  function loadTextures() {
    const size = width < 700 ? 'small' : 'full';
    // Upgrade after widening the window; keep the full source when narrowing again.
    if (textureSize === 'full' || textureSize === size) return;
    textureSize = size;
    const generation = ++textureGeneration;
    let finished = 0;
    cloudNames.forEach((name, index) => {
      const image = new Image();
      image.onload = () => {
        if (lost || generation !== textureGeneration) return;
        const texture = gl.createTexture();
        if (textures[index]) gl.deleteTexture(textures[index]);
        textures[index] = texture;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        finished++; ready = true; canvas.dataset.renderer = finished === cloudNames.length ? 'webgl-billboards' : 'webgl-partial'; wake();
      };
      image.onerror = () => {
        if (lost || generation !== textureGeneration) return;
        canvas.dataset.renderer = ready ? 'webgl-partial' : 'static-fallback';
      };
      image.src = `assets/${name}${size === 'small' ? '-small' : ''}.webp`;
    });
  }

  function measure() {
    width = window.innerWidth; height = window.innerHeight;
    // Cap fill rate on high-DPI mobile displays. Fine texture supplies detail.
    const dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? 1.15 : 1.4, 3840 / width, 2160 / height);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    if (gl && !lost) { gl.viewport(0, 0, canvas.width, canvas.height); if (program) loadTextures(); }
    lastScrollY = -1; wake();
  }
  function readProgress() {
    const isHome = document.body.dataset.view === 'home';
    targetProgress = isHome ? Math.max(0, Math.min(1, window.scrollY / Math.max(1, home.offsetHeight - height))) : .22;
  }
  function renderWorld() {
    // One camera descends through a fixed cloud field. Ground approaches from below.
    const cameraY = 15 - progress * 18;
    const quiet = document.body.dataset.view !== 'home';
    vault.style.transform = `translate3d(0,${-progress * height * .58}px,0) scale(${1.015 + progress * .1})`;
    const vaultOpacity = Math.max(0, 1 - progress * 2.8) * (quiet ? .14 : 1);
    vault.style.opacity = String(vaultOpacity);
    vault.style.setProperty('--sky-edge-alpha', String(quiet ? 1 : 1 - Math.min(1, progress / .045)));
    const videoVisible = skyVideo.update({ theme: document.body.dataset.time, visible: !quiet && vaultOpacity > 0, moving: !paused && !media.matches, width });
    skyBanks.render({ time, width, height, theme: document.body.dataset.time, visible: !quiet && vaultOpacity > 0 && !videoVisible, moving: !paused && !media.matches });
    const ground = Math.max(0, Math.min(1, (progress - .40) / .60));
    meadow.style.transform = `translate3d(0,${height * (1 - ground) * .95}px,0) scale(${1.01 + .12 * ground})`;
    let grassVisible = false;
    if (groundMode === 'grass' && !quiet && ground > .40) {
      if (!grassField && !grassLoading && !grassFailed) {
        grassLoading = true;
        import('./originkit-grass.js').then(module => {
          grassField = module.createGrassField(grassCanvas, wake);
          grassFailed = !grassField;
        }).catch(() => { grassFailed = true; }).finally(() => { grassLoading = false; wake(); });
      }
      if (grassField) {
        grassCanvas.style.transform = `translate3d(0,${height * ((1 - ground) * .95 + .17)}px,0)`;
        grassVisible = grassField.render({ time, ground, theme: document.body.dataset.time, moving: !paused && !media.matches, reduced: media.matches, width, height });
      }
    }
    // A local photograph sits behind the interactive grass.
    const showMountains = grassVisible && document.body.dataset.mountains !== 'off';
    if (showMountains && !mountainRequested) { mountainRequested = true; mountainImage.srcset = 'assets/mountains.webp 1600w, assets/mountains-4k.webp 3840w'; mountainImage.sizes = '100vw'; mountainImage.src = 'assets/mountains.webp'; }
    mountains.hidden = !showMountains || !mountainReady;
    mountains.style.transform = `translate3d(-50%,${height * (1 - ground) * .95}px,0)`;
    mountains.style.opacity = String(Math.min(1, Math.max(0, (ground - .40) / .22)));
    grassCanvas.hidden = !grassVisible;
    grassCanvas.dataset.active = String(grassVisible);
    meadow.style.opacity = grassVisible ? '0' : String(Math.min(1, ground * 2));
    const failed = groundMode === 'grass' && (grassFailed || grassCanvas.dataset.renderer === 'photo-fallback');
    const grassMessage = failed ? '움직이는 잔디를 표시할 수 없어 기존 사진을 보여 드립니다.' : groundMode === 'grass' ? 'OriginKit · 바람에 흔들리는 잔디' : '기존 사진 · 언제든 다시 선택할 수 있어요';
    if (grassStatus.textContent !== grassMessage) grassStatus.textContent = grassMessage;
    canvas.dataset.progress = progress.toFixed(4); canvas.dataset.time = time.toFixed(3);
    canvas.dataset.camera = cameraY.toFixed(3); canvas.dataset.ground = ground.toFixed(4);
    if (!ready || lost) return;
    gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program); gl.uniform3fv(tint, color);
    const aspect = width / height;
    const reveal = quiet ? 1 : Math.max(0, Math.min(1, progress / .22));
    const cloudArrival = reveal * reveal * (3 - 2 * reveal);
    if (cloudArrival === 0) return;
    clouds.forEach((cloud, index) => {
      const focal = cloud.depth * .75;
      // Foreground banks join the same world as the camera descends.
      const drift = Math.sin(time * cloud.speed + index * .7) * 1.35;
      const span = Math.max(1, aspect / 1.78);
      const x = (cloud.x * span + drift) / focal / Math.max(.83, aspect);
      const y = (cloud.y - cameraY) / focal;
      const projectedWidth = cloud.size / focal / aspect * width / 2;
      // Never stretch a 1672px sprite beyond its useful texel density at desktop DPR.
      const displayWidth = Math.min(projectedWidth, width < 700 ? width * 1.15 : Math.min(width * .58, 1120));
      const w = displayWidth / width * 2;
      const h = displayWidth / (1672 / 941) / height * 2;
      if (y - h / 2 > 1.1 || y + h / 2 < -1.1 || !textures[cloud.image]) return;
      gl.bindTexture(gl.TEXTURE_2D, textures[cloud.image]);
      gl.uniform4f(rect, x, y, w, h); gl.uniform1f(alpha, cloud.opacity * cloudArrival * (quiet ? .32 : 1)); gl.uniform1f(flip, index % 2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });
  }
  function frame(now) {
    animation = 0;
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    if (window.scrollY !== lastScrollY) { lastScrollY = window.scrollY; readProgress(); header.classList.toggle('scrolled', lastScrollY > 40); }
    const smoothing = media.matches ? 1 : Math.min(1, dt * 8);
    progress += (targetProgress - progress) * smoothing;
    if (Math.abs(targetProgress - progress) < .0001) progress = targetProgress;
    color = color.map((value, index) => value + (targetColor[index] - value) * (media.matches ? 1 : Math.min(1, dt * 4)));
    if (!paused && !media.matches) time += dt;
    renderWorld();
    const unsettled = Math.abs(targetProgress - progress) > .0001 || color.some((value, index) => Math.abs(value - targetColor[index]) > .001);
    if (!document.hidden && ((!paused && !media.matches) || unsettled)) animation = requestAnimationFrame(frame);
  }
  function wake() {
    if (!animation && !document.hidden) { previous = performance.now(); animation = requestAnimationFrame(frame); }
  }
  function updateMotion() {
    document.body.dataset.motion = paused || media.matches ? 'off' : 'on';
    const videoBlocked = skyVideo.blocked;
    motionButton.setAttribute('aria-pressed', String(paused || media.matches || videoBlocked));
    const label = media.matches ? '움직임 감소 설정 적용 중' : videoBlocked ? '하늘 영상 재생' : paused ? '배경 움직임 재개' : '배경 움직임 멈춤';
    motionButton.setAttribute('aria-label', label); motionButton.title = label;
    motionButton.querySelector('span').textContent = paused || media.matches || videoBlocked ? '▷' : 'Ⅱ';
    motionButton.disabled = media.matches;
    wake();
  }
  motionButton.addEventListener('click', () => {
    if (skyVideo.blocked) { paused = false; skyVideo.retry(); }
    else paused = !paused;
    updateMotion();
  });
  media.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(animation); animation = 0; canvas.dataset.suspended = 'true'; } else { delete canvas.dataset.suspended; wake(); } });
  // A passive wake-up only: layout and drawing are coalesced into the next frame.
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', measure);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; ready = false; textureGeneration++; canvas.dataset.renderer = 'static-fallback'; wake(); });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); measure(); });
  window.addEventListener('pagehide', event => { if (!event.persisted) { grassField?.dispose(); skyBanks.dispose(); skyVideo.dispose(); } });
  setup(); measure(); updateMotion();
  return {
    setGround(mode) { groundMode = mode === 'grass' ? 'grass' : 'photo'; document.body.dataset.ground = groundMode; wake(); },
    setTheme(theme) { targetColor = themes[theme] || themes.day; wake(); },
    reset() { readProgress(); progress = targetProgress; lastScrollY = -1; wake(); },
  };
}
