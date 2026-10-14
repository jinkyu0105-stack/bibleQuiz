// Original procedural shaders inspired by the public Mercury Veins / Veil Rays previews.
// No purchased source, texture, video sampling, or additional dependencies.
const vertex = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const fragment = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform vec3 uTint;
uniform vec2 uEffects;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * vec3(.1031, .11369, .13787));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
vec4 mercury() {
  vec2 uv = vUv;
  vec2 p = (uv - .5) * vec2(uResolution.x / uResolution.y, 1.) * 3.2;
  float t = uTime * .13;
  vec2 fromPointer = (uv - uPointer) * vec2(uResolution.x / uResolution.y, 1.);
  p += fromPointer * exp(-dot(fromPointer, fromPointer) * 7.) * .65;
  vec2 drift = vec2(t * .31, -t * .22);
  vec2 warp = vec2(noise(p * .75 + drift), noise(p * .75 - drift + 8.1));
  p += (warp - .5) * 2.;
  float field = sin(p.x * 1.15 + sin(p.y * .8 + t) * 1.1)
    + cos(p.y * 1.2 - p.x * .45 - t * .7) * .72
    + (noise(p * 1.4 + drift) - .5) * .65;
  float distanceToVein = abs(field - .12);
  float glow = exp(-distanceToVein * 7.) * .34 + exp(-distanceToVein * 42.) * .8;
  float shade = exp(-abs(field + .14) * 5.) * .12;
  float grain = (hash(gl_FragCoord.xy) - .5) * .035;
  // Keep the title calm and dissolve the effect before the following section.
  float center = smoothstep(.12, .53, length((uv - vec2(.5, .52)) * vec2(1., 1.2)));
  float edge = smoothstep(0., .08, uv.x) * smoothstep(0., .08, 1. - uv.x)
    * smoothstep(0., .14, uv.y) * smoothstep(0., .12, 1. - uv.y);
  float alpha = clamp(glow * .53 + shade + grain * glow, 0., .64) * edge * mix(.25, 1., center);
  vec3 color = mix(uTint * .2, uTint, smoothstep(.02, .3, glow));
  return vec4(color * alpha, alpha);
}
vec4 veil() {
  float t = uTime * .18;
  float aspect = uResolution.x / uResolution.y;
  float pointer = uPointer.x < 0. ? 0. : (uPointer.x - .5) * .035;
  float depth = 1.08 - vUv.y;
  float source = .51 + sin(t * .27) * .035 + pointer;
  float angle = (vUv.x - source) * aspect / (depth + .12);
  float breath = 1. + sin(t * .6) * .12;
  float cone = exp(-angle * angle * 2.6 / breath);
  // Project irregular bands from a single source, rather than parallel stripes.
  float fold = noise(vec2(angle * 8. + t * .15, depth * .65 - t * .22));
  float fine = noise(vec2(angle * 25. + fold * 2., t * .28));
  float threads = .2 + .52 * fold + .28 * fine;
  float shaft = pow(max(0., sin(angle * 32. + fold * 4. + t * .3)), 5.) * .12;
  float falloff = exp(-depth * .8) * smoothstep(0., .14, vUv.y);
  float sides = smoothstep(0., .07, vUv.x) * smoothstep(0., .07, 1. - vUv.x);
  float grain = (hash(gl_FragCoord.xy + floor(uTime * 8.)) - .5) * .045;
  float alpha = clamp(cone * (threads + shaft + grain) * falloff * sides * .57, 0., .5);
  return vec4(uTint * alpha, alpha);
}
void main() {
  vec4 reflection = vec4(0.);
  vec4 rays = vec4(0.);
  if (uEffects.x > .5) reflection = mercury();
  if (uEffects.y > .5) rays = veil();
  gl_FragColor = rays + reflection * (1. - rays.a);
}`;

export function createHeroEffects(canvas: HTMLCanvasElement): () => void {
  const hero = canvas.parentElement;
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl || !hero) { canvas.dataset.state = "unavailable"; return () => {}; }

  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  let frame = 0, lastFrame = 0, time = 0, visible = false, lost = false, disposed = false;
  let pointerX = -2, pointerY = -2, targetX = -2, targetY = -2;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const contrast = matchMedia("(forced-colors: active)");
  const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
  const events = new AbortController();
  const options = { signal: events.signal };

  function release() {
    if (program) gl!.deleteProgram(program);
    if (buffer) gl!.deleteBuffer(buffer);
    program = null; buffer = null;
  }
  function setup() {
    release();
    const shaders: WebGLShader[] = [];
    try {
      program = gl!.createProgram(); buffer = gl!.createBuffer();
      if (!program || !buffer) throw new Error("Unavailable GPU resources");
      for (const [type, source] of [[gl!.VERTEX_SHADER, vertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl!.createShader(type);
        if (!shader) throw new Error("Unavailable shader");
        shaders.push(shader);
        gl!.shaderSource(shader, source); gl!.compileShader(shader); gl!.attachShader(program, shader);
      }
      gl!.linkProgram(program);
      if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) throw new Error("Unavailable shader program");
      gl!.useProgram(program);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW);
      const position = gl!.getAttribLocation(program, "aPosition");
      gl!.enableVertexAttribArray(position); gl!.vertexAttribPointer(position, 2, gl!.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(["uResolution", "uPointer", "uTime", "uTint", "uEffects"].map(name => [name, gl!.getUniformLocation(program!, name)]));
    } catch {
      release(); canvas.dataset.state = "unavailable";
    } finally {
      shaders.forEach(shader => gl!.deleteShader(shader));
    }
  }
  const hidden = () => document.hidden || !visible;
  const clear = () => contrast.matches || transparency.matches || document.body.dataset.transparency === "reduced";
  const moving = () => !reduced.matches && document.body.dataset.motion !== "off";
  const effects = () => [document.body.dataset.heroMercury !== "off", document.body.dataset.heroVeil === "on"] as const;

  function draw() {
    if (!program || lost || disposed) return;
    const tint = document.body.dataset.time === "dusk" ? [1, .87, .73] : document.body.dataset.time === "dawn" ? [.94, .94, 1] : [.88, .95, 1];
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(uniforms.uResolution!, canvas.width, canvas.height);
    gl!.uniform2f(uniforms.uPointer!, pointerX, pointerY);
    gl!.uniform1f(uniforms.uTime!, time);
    gl!.uniform3f(uniforms.uTint!, tint[0]!, tint[1]!, tint[2]!);
    gl!.uniform2f(uniforms.uEffects!, Number(effects()[0]), Number(effects()[1]));
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    canvas.dataset.time = time.toFixed(3);
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !program || hidden() || clear() || !moving() || !effects().some(Boolean)) return;
    if (!lastFrame || now - lastFrame >= 1000 / 30) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
      time += dt; lastFrame = now;
      const ease = 1 - Math.exp(-dt * 4);
      pointerX += (targetX - pointerX) * ease; pointerY += (targetY - pointerY) * ease;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
    if (disposed || lost || !program) return;
    canvas.dataset.state = !effects().some(Boolean) ? "disabled" : clear() ? "clear" : hidden() ? "offscreen" : moving() ? "running" : "paused";
    if (!effects().some(Boolean) || clear() || hidden()) return;
    draw();
    if (moving()) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const { width, height } = hero!.getBoundingClientRect();
    // Broad reflections need no retina buffer; cap work alongside the video.
    const scale = Math.min(devicePixelRatio, 1, 960 / Math.max(width, 1), 720 / Math.max(height, 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    sync();
  }
  setup();
  const size = new ResizeObserver(resize); size.observe(hero);
  // Touching the viewport edge is still "intersecting"; stop before that
  // zero-area boundary, where the bottom fade has already become invisible.
  const intersection = new IntersectionObserver(([entry]) => { visible = (entry?.intersectionRatio ?? 0) > .01; sync(); }, { threshold: .01 });
  intersection.observe(hero);
  const settings = new MutationObserver(sync);
  settings.observe(document.body, { attributes: true, attributeFilter: ["data-time", "data-motion", "data-transparency", "data-hero-mercury", "data-hero-veil"] });
  document.addEventListener("visibilitychange", sync, options);
  for (const media of [reduced, contrast, transparency]) media.addEventListener("change", sync, options);
  hero.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" || !moving()) return;
    const rect = hero.getBoundingClientRect();
    targetX = (event.clientX - rect.left) / rect.width;
    targetY = 1 - (event.clientY - rect.top) / rect.height;
  }, { ...options, passive: true });
  hero.addEventListener("pointerleave", () => { targetX = -2; targetY = -2; }, options);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0;
    program = null; buffer = null; uniforms = {};
    canvas.dataset.state = "unavailable";
  }, options);
  canvas.addEventListener("webglcontextrestored", () => { lost = false; setup(); resize(); }, options);
  resize();
  return () => {
    disposed = true; cancelAnimationFrame(frame); events.abort();
    size.disconnect(); intersection.disconnect(); settings.disconnect(); release();
  };
}
