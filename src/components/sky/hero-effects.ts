// Original procedural shaders inspired by the public Mercury Veins, Veil Rays and Silk Flow previews.
// No purchased source, texture, video sampling, or additional dependencies.
import { defaultVeilSettings, normalizeVeilSettings } from "./veil-settings";
import { defaultMercurySettings, normalizeMercurySettings } from "./mercury-settings";

import { defaultFlowSettings, normalizeFlowSettings } from "./flow-settings";

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
uniform vec3 uVeilSettings;
uniform vec2 uMercurySettings;
uniform float uMercuryTime;
uniform float uVeilTime;
uniform float uSilk;
uniform vec3 uSilkSettings;
uniform vec3 uMoon;
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
  vec2 p = (uv - .5) * vec2(uResolution.x / uResolution.y, 1.) * 3.2 / mix(.5, 1.5, uMercurySettings.y);
  float t = uMercuryTime * .13;
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
  alpha = min(.85, alpha * uMercurySettings.x);
  return vec4(color * alpha, alpha);
}
vec4 veil() {
  float t = uVeilTime * .18;
  float aspect = uResolution.x / uResolution.y;
  float night = uMoon.z;
  float width = uVeilSettings.x;
  float strength = uVeilSettings.y;
  float spread = mix(.34, 1.1, uVeilSettings.z);
  float pointer = uPointer.x < 0. ? 0. : (uPointer.x - .5) * .035;
  float depth = 1.08 - vUv.y;
  float source = .51 + sin(t * .27) * .035 + pointer;
  float lateral = (vUv.x - source) * aspect;
  if (night > .5) {
    // Follow the existing crescent's crop. No extra sun or luminous disc.
    vec2 fromMoon = (vUv - uMoon.xy) * vec2(aspect, 1.);
    vec2 direction = normalize(vec2(-.48, -.88));
    depth = dot(fromMoon, direction);
    lateral = dot(fromMoon, vec2(-direction.y, direction.x));
  }
  // A wide emitting band retains its width at the top, unlike a point spotlight.
  float sourceWidth = mix(.025, mix(.8, .22, night), width);
  float distanceFromBand = max(abs(lateral) - sourceWidth * .5, 0.);
  float opening = .10 + max(depth, 0.) * spread;
  float cone = exp(-pow(distanceFromBand / opening, 2.) * 2.2);
  float angle = lateral / (max(depth, 0.) + .13 + sourceWidth);
  float fold = noise(vec2(angle * 8. + t * .15, depth * .65 - t * .22));
  float fine = noise(vec2(angle * 25. + fold * 2., t * .28));
  float threads = .2 + .52 * fold + .28 * fine;
  float shaft = pow(max(0., sin(angle * 32. + fold * 4. + t * .3)), 5.) * .12;
  float falloff = exp(-max(depth, 0.) * .8) * smoothstep(0., .14, vUv.y);
  // Moonlight blooms softly below the moon, never from the top edge.
  falloff *= mix(1., smoothstep(.015, .18, depth), night);
  float sides = smoothstep(0., .07, vUv.x) * smoothstep(0., .07, 1. - vUv.x);
  float grain = (hash(gl_FragCoord.xy + floor(uVeilTime * 8.)) - .5) * .045;
  float alpha = clamp(cone * (threads + shaft + grain) * falloff * sides * strength * mix(1.05, .72, night), 0., .62);
  return vec4(uTint * alpha, alpha);
}
// Both new materials use the same small framebuffer and analytic fields.
// Their dark folds are translucent: the existing sky remains the background.
float flowEdge() {
  return smoothstep(0., .06, vUv.x) * smoothstep(0., .06, 1. - vUv.x)
    * smoothstep(0., .16, vUv.y) * smoothstep(0., .1, 1. - vUv.y);
}
// Advected multi-scale density: broad folds break into drifting wisps rather
// than remaining smooth sine bands. Fine structure follows the same flow.
float turbulence(vec2 p) {
  return noise(p) * .57 + noise(p * 2.07 + 7.3) * .28
    + noise(p * 4.13 - 5.8) * .15;
}
vec4 silk() {
  float t = uSilkSettings.z * .42;
  // Keep the full fold visible on portrait screens instead of a flat crop.
  vec2 p = (vUv - .5) * vec2(max(1.25, uResolution.x / uResolution.y), 1.);
  p /= mix(.65, 1.65, uSilkSettings.y);
  vec2 drift = vec2(p.x * 1.6 - t, p.y * 4.4);
  float curl = turbulence(drift * .75 + vec2(0., t * .13)) - .5;
  float ripple = turbulence(drift * vec2(1.1, 2.8) + curl * 2.2) - .5;
  float fold = p.y * 19. + curl * 5.8 + ripple * 1.7 - p.x * .8;
  float crest = pow(.5 + .5 * sin(fold), 2.6);
  float fibers = turbulence(vec2(drift.x * 2.2, drift.y * 9. + curl * 8.));
  float fray = turbulence(drift * vec2(2.8, 5.5) + vec2(-t * .55, curl * 4.));
  // Density erodes unevenly and leaves small translucent trails outside folds.
  float body = crest * smoothstep(.12, .78, fibers + fray * .23);
  float wisps = pow(smoothstep(.32, .85, fibers), 2.)
    * (.35 + .65 * crest) * smoothstep(.15, .8, fray);
  float grain = mix(.86, 1.12, hash(gl_FragCoord.xy + floor(t * 13.)));
  float density = (body * .9 + wisps * .5) * grain;
  float alpha = min(.78, density * uSilkSettings.x * 2.5) * flowEdge();
  vec3 color = mix(uTint * .48, uTint, smoothstep(.03, .55, density));
  return vec4(color * alpha, alpha);
}
void main() {
  vec4 reflection = vec4(0.);
  vec4 rays = vec4(0.);
  if (uEffects.x > .5) reflection = mercury();
  if (uEffects.y > .5) rays = veil();
  vec4 color = rays + reflection * (1. - rays.a);
  if (uSilk > .5) { vec4 fabric = silk(); color = fabric + color * (1. - fabric.a); }
  gl_FragColor = color;
}`;

export function createHeroEffects(canvas: HTMLCanvasElement): () => void {
  const hero = canvas.parentElement;
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl || !hero) { canvas.dataset.state = "unavailable"; return () => {}; }

  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  let frame = 0, lastFrame = 0, time = 0, mercuryTime = 0, veilTime = 0, silkTime = 0, visible = false, lost = false, disposed = false;
  let pointerX = -2, pointerY = -2, targetX = -2, targetY = -2;
  let veilSettings = { ...defaultVeilSettings }, moonX = .74, moonY = .86;
  let mercurySettings = { ...defaultMercurySettings };
  let silkSettings = { ...defaultFlowSettings.silk };
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
      uniforms = Object.fromEntries(["uResolution", "uPointer", "uTime", "uTint", "uEffects", "uVeilSettings", "uMercurySettings", "uMercuryTime", "uMoon", "uVeilTime", "uSilk", "uSilkSettings"].map(name => [name, gl!.getUniformLocation(program!, name)]));
    } catch {
      release(); canvas.dataset.state = "unavailable";
    } finally {
      shaders.forEach(shader => gl!.deleteShader(shader));
    }
  }
  const hidden = () => document.hidden || !visible;
  const clear = () => contrast.matches || transparency.matches || document.body.dataset.transparency === "reduced";
  const moving = () => !reduced.matches && document.body.dataset.motion !== "off";
  const effects = () => [document.body.dataset.heroMercury !== "off", document.body.dataset.heroVeil === "on", document.body.dataset.heroSilk === "on"] as const;

  function draw() {
    if (!program || lost || disposed) return;
    const tint = document.body.dataset.time === "dusk" ? [1, .87, .73] : document.body.dataset.time === "dawn" ? [.94, .94, 1] : [.88, .95, 1];
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(uniforms.uResolution!, canvas.width, canvas.height);
    gl!.uniform2f(uniforms.uPointer!, pointerX, pointerY);
    gl!.uniform1f(uniforms.uTime!, time);
    gl!.uniform1f(uniforms.uMercuryTime!, mercuryTime);
    gl!.uniform1f(uniforms.uVeilTime!, veilTime);
    gl!.uniform1f(uniforms.uSilk!, Number(effects()[2]));
    gl!.uniform3f(uniforms.uSilkSettings!, silkSettings.strength / 100, silkSettings.scale / 100, silkTime);
    gl!.uniform2f(uniforms.uMercurySettings!, mercurySettings.strength / 50, mercurySettings.scale / 100);
    gl!.uniform3f(uniforms.uTint!, tint[0]!, tint[1]!, tint[2]!);
    gl!.uniform2f(uniforms.uEffects!, Number(effects()[0]), Number(effects()[1]));
    gl!.uniform3f(uniforms.uVeilSettings!, veilSettings.width / 100, veilSettings.strength / 100, veilSettings.spread / 100);
    gl!.uniform3f(uniforms.uMoon!, moonX, moonY, Number(document.body.dataset.time === "night"));
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    canvas.dataset.time = time.toFixed(3);
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !program || hidden() || clear() || !moving() || !effects().some(Boolean)) return;
    if (!lastFrame || now - lastFrame >= 1000 / 30) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
      time += dt; lastFrame = now;
      // Integrate speed rather than multiplying elapsed time: changing the
      // slider must not jump the reflection to another point in its animation.
      mercuryTime += dt * mercurySettings.speed / 50;
      // Preserve the old lower half, then open a useful fast range. At 100%
      // the rays run 16x baseline (8x the former maximum), without phase jumps.
      const raySpeed = veilSettings.speed <= 50 ? veilSettings.speed / 50
        : 1 + 15 * Math.pow((veilSettings.speed - 50) / 50, 1.35);
      veilTime += dt * raySpeed;
      silkTime += dt * silkSettings.speed / 50;
      const ease = 1 - Math.exp(-dt * 4);
      pointerX += (targetX - pointerX) * ease; pointerY += (targetY - pointerY) * ease;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
    if (disposed || lost || !program) return;
    veilSettings = normalizeVeilSettings({ width: Number(document.body.dataset.veilWidth), strength: Number(document.body.dataset.veilStrength), spread: Number(document.body.dataset.veilSpread), speed: Number(document.body.dataset.veilSpeed) });
    mercurySettings = normalizeMercurySettings({ strength: Number(document.body.dataset.mercuryStrength), scale: Number(document.body.dataset.mercuryScale), speed: Number(document.body.dataset.mercurySpeed) });
    silkSettings = normalizeFlowSettings("silk", { strength: Number(document.body.dataset.silkStrength), scale: Number(document.body.dataset.silkScale), speed: Number(document.body.dataset.silkSpeed) });
    locateMoon();
    canvas.dataset.state = !effects().some(Boolean) ? "disabled" : clear() ? "clear" : hidden() ? "offscreen" : moving() ? "running" : "paused";
    if (!effects().some(Boolean) || clear() || hidden()) return;
    draw();
    if (moving()) frame = requestAnimationFrame(tick);
  }
  function locateMoon() {
    if (document.body.dataset.time !== "night") return;
    const image = document.querySelector<HTMLImageElement>(document.body.dataset.skyVideo === "on" ? ".sky-video > img" : ".night-sky");
    if (!image) return;
    const bounds = image.getBoundingClientRect(), local = hero!.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !local.width || !local.height) return;
    // Both approved night assets place the crescent at this normalized location.
    // Map object-fit: cover and object-position, so narrow screens keep it offscreen.
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 16 / 9;
    const width = Math.max(bounds.width, bounds.height * ratio), height = width / ratio;
    const position = getComputedStyle(image).objectPosition.split(" ").map(Number.parseFloat);
    const x = bounds.left + (bounds.width - width) * ((position[0] ?? 50) / 100) + width * .744;
    const y = bounds.top + (bounds.height - height) * ((position[1] ?? 50) / 100) + height * .145;
    moonX = (x - local.left) / local.width; moonY = 1 - (y - local.top) / local.height;
  }
  function resize() {
    const { width, height } = hero!.getBoundingClientRect();
    // These diffuse layers stay smooth when upscaled; leave room for the video
    // and glass interaction instead of shading a full-resolution background.
    const scale = Math.min(devicePixelRatio, 1, 640 / Math.max(width, 1), 480 / Math.max(height, 1));
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
  settings.observe(document.body, { attributes: true, attributeFilter: ["data-time", "data-motion", "data-transparency", "data-hero-mercury", "data-hero-veil", "data-veil-width", "data-veil-strength", "data-veil-spread", "data-mercury-strength", "data-mercury-scale", "data-mercury-speed", "data-sky-video", "data-veil-speed", "data-hero-silk", "data-silk-strength", "data-silk-scale", "data-silk-speed"] });
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
