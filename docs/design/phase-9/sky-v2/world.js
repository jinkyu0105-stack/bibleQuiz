/* global window, document, Image, performance, requestAnimationFrame, cancelAnimationFrame */
// Original billboard world: no Air assets/code, no rendering dependencies.
export function createWorld() {
  const canvas = document.querySelector('#clouds');
  const vault = document.querySelector('.sky-vault');
  const meadow = document.querySelector('.meadow');
  const home = document.querySelector('#home-view');
  const header = document.querySelector('.site-header');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = document.querySelector('#motion');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  let program, rect, tint, alpha, flip;
  const textures = [];
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
  const themes = { dawn: [.94, .89, .94], day: [.99, 1, 1], dusk: [1, .81, .76], night: [.24, .36, .55] };
  // x/y are world coordinates; depth determines apparent size and camera parallax.
  const clouds = [
    { x: -17, y: 11, depth: 22, size: 24, ratio: 3, image: 2, opacity: .39, speed: .033 },
    { x: 17, y: 6, depth: 19, size: 22, ratio: 3, image: 2, opacity: .43, speed: -.029 },
    { x: -9.5, y: 4, depth: 13, size: 15, ratio: 1.5, image: 0, opacity: .5, speed: .048 },
    { x: 13, y: 1, depth: 14, size: 19, ratio: 3, image: 2, opacity: .42, speed: -.042 },
    { x: -7.4, y: 12.4, depth: 7.5, size: 11.2, ratio: 1.5, image: 1, opacity: .82, speed: .042 },
    { x: 7.8, y: 10.7, depth: 7, size: 11, ratio: 1.5, image: 0, opacity: .75, speed: -.043 },
    { x: -6.2, y: 1.8, depth: 6.5, size: 10.3, ratio: 1.5, image: 1, opacity: .65, speed: .038 },
    { x: 7.8, y: -2, depth: 8, size: 13, ratio: 3, image: 2, opacity: .52, speed: -.035 },
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
    const fragment = compile(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D uTexture; uniform vec3 uTint; uniform float uAlpha; varying vec2 vUv; void main(){vec4 c=texture2D(uTexture,vUv); gl_FragColor=vec4(c.rgb*uTint,c.a)*uAlpha;}');
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
    let finished = 0;
    ['cloud', 'cloud-near', 'cloud-bank'].forEach((name, index) => {
      const image = new Image(); image.src = `assets/${name}.webp`;
      image.onload = () => {
        if (lost) return;
        const texture = gl.createTexture(); textures[index] = texture;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        finished++; ready = true; canvas.dataset.renderer = finished === 3 ? 'webgl-billboards' : 'webgl-partial'; wake();
      };
      image.onerror = () => { canvas.dataset.renderer = ready ? 'webgl-partial' : 'static-fallback'; };
    });
  }

  function measure() {
    width = window.innerWidth; height = window.innerHeight;
    // Cap fill rate on high-DPI mobile displays. Fine texture supplies detail.
    const dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? 1.15 : 1.4);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    if (gl && !lost) gl.viewport(0, 0, canvas.width, canvas.height);
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
    vault.style.opacity = String(Math.max(0, 1 - progress * 2.8));
    const ground = Math.max(0, Math.min(1, (progress - .40) / .60));
    meadow.style.transform = `translate3d(0,${height * (1 - ground) * .95}px,0) scale(${1.01 + .12 * ground})`;
    meadow.style.opacity = String(Math.min(1, ground * 2));
    canvas.dataset.progress = progress.toFixed(4); canvas.dataset.time = time.toFixed(3);
    canvas.dataset.camera = cameraY.toFixed(3); canvas.dataset.ground = ground.toFixed(4);
    if (!ready || lost) return;
    gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program); gl.uniform3fv(tint, color);
    const aspect = width / height;
    clouds.forEach((cloud, index) => {
      const focal = cloud.depth * .75;
      // Gentle continuous oscillation keeps clouds inside their original world bank.
      const drift = Math.sin(time * cloud.speed + index * .7) * .75;
      const x = (cloud.x + drift) / focal / Math.max(.83, aspect);
      const y = (cloud.y - cameraY) / focal;
      const w = cloud.size / focal / aspect;
      const h = cloud.size / cloud.ratio / focal;
      if (y - h / 2 > 1.1 || y + h / 2 < -1.1 || !textures[cloud.image]) return;
      gl.bindTexture(gl.TEXTURE_2D, textures[cloud.image]);
      gl.uniform4f(rect, x, y, w, h); gl.uniform1f(alpha, cloud.opacity * (quiet ? .32 : 1)); gl.uniform1f(flip, index % 2);
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
    motionButton.setAttribute('aria-pressed', String(paused || media.matches));
    const label = media.matches ? '움직임 감소 설정 적용 중' : paused ? '구름 움직임 재개' : '구름 움직임 멈춤';
    motionButton.setAttribute('aria-label', label); motionButton.title = label;
    motionButton.querySelector('span').textContent = paused || media.matches ? '▷' : 'Ⅱ';
    motionButton.disabled = media.matches;
    wake();
  }
  motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
  media.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(animation); animation = 0; canvas.dataset.suspended = 'true'; } else { delete canvas.dataset.suspended; wake(); } });
  // A passive wake-up only: layout and drawing are coalesced into the next frame.
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', measure);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; ready = false; canvas.dataset.renderer = 'static-fallback'; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); measure(); });
  setup(); measure(); updateMotion();
  return {
    setTheme(theme) { targetColor = themes[theme] || themes.day; wake(); },
    reset() { readProgress(); progress = targetProgress; lastScrollY = -1; wake(); },
  };
}
