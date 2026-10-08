/* global window */
/**
 * Adapted from OriginKit Grass Field, base preset, fetched via its MCP on 2026-10-08.
 * https://www.originkit.dev/components/grass-field?preset=base
 * OriginKit hill/wind/shading and low-discrepancy geometry are retained;
 * field x coordinates now expand with the viewport aspect ratio (P9-06 wide fix).
 * Adapter replaces React lifecycle and opaque sky with this review's shared clock,
 * transparent backdrop, themes, lazy allocation, quality cap and explicit cleanup.
 * See ORIGINKIT.md for provenance, tuning and rollback.
 */
const FIELD_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec3 uHaze;
varying vec3 vCol;
varying float vFog;

void main() {
    gl_FragColor = vec4(mix(vCol, uHaze, vFog * 0.82), 1.0);
}
`;

const HILL_GLSL = `
uniform float uTerrain;
uniform float uFieldWidth;
float hill(vec2 b) {
    return uTerrain * (
          0.42 * sin(b.x * 0.155 + 0.6) * cos(b.y * 0.105)
        + 0.30 * sin(b.y * 0.185 + 1.1)
        - 0.10 * cos(b.x * 0.34 - b.y * 0.2)
    );
}
`;

const GROUND_VS = `
precision highp float;
attribute vec2 a_xz;

uniform float uAspect;
uniform float uF;
uniform vec3  uEye;
uniform float uPitch;
uniform vec3  uBase;

varying vec3 vCol;
varying float vFog;

float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
}

${HILL_GLSL}

void main() {
    vec2 b = vec2(a_xz.x * uFieldWidth, a_xz.y);
    vec3 P = vec3(b.x, hill(b) - 0.012, b.y);
    vec3 rel = P - uEye;
    float cp = cos(uPitch), sp = sin(uPitch);
    float wx = rel.x;
    float wy = rel.y * cp - rel.z * sp;
    float depth = max(-rel.y * sp - rel.z * cp, 0.05);
    gl_Position = vec4(uF * wx / uAspect, uF * wy, 1.00334 * depth - 0.2003, depth);

    float e = 0.55;
    vec3 n = normalize(vec3(
        hill(b - vec2(e, 0.0)) - hill(b + vec2(e, 0.0)),
        2.0 * e,
        hill(b - vec2(0.0, e)) - hill(b + vec2(0.0, e))
    ));
    float lam = 0.42 + 0.58 * clamp(dot(n, normalize(vec3(-0.35, 0.80, 0.48))), 0.0, 1.0);
    vCol = uBase * (0.55 + 0.85 * lam) * (0.80 + 0.35 * h21(b * 1.7));
    vFog = clamp((depth - 8.0) / 26.0, 0.0, 1.0);
}
`;

const BLADE_VS = `
precision highp float;
attribute vec2 a_base;
attribute vec2 a_param;
attribute vec2 a_rand;

uniform float uTime;
uniform float uAspect;
uniform float uF;
uniform vec3  uEye;
uniform float uPitch;
uniform vec2  uPush;
uniform float uPushAmt;
uniform float uReach;
uniform float uHeight;
uniform float uWind;
uniform float uGust;
uniform vec2  uWindDir;
uniform vec3  uBase;
uniform vec3  uTip;

varying vec3 vCol;
varying float vFog;

float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
}

${HILL_GLSL}

void main() {
    vec2 base = vec2(a_base.x * uFieldWidth, a_base.y);
    float v = a_param.x;
    float side = a_param.y;

    float y0 = hill(base);
    float h = (0.16 + 0.20 * a_rand.x) * uHeight;
    float ang = a_rand.y * 6.2831853;
    vec2 lean = normalize(uWindDir + 0.55 * vec2(cos(ang), sin(ang)));

    float wind = sin(uTime * 1.25 + base.x * 0.55 + base.y * 0.30 + a_rand.x * 6.28) * 0.5 + 0.5;
    float gust = 1.0 - uGust * 0.5 + uGust * 0.5 * sin(uTime * 0.42 - base.y * 0.16);
    float bend = (0.10 + 0.16 * wind) * gust * uWind;

    vec2 dp = base - uPush;
    float dl = length(dp) + 1e-4;
    float push = uPushAmt * exp(-dl * dl / max(uReach, 0.05));

    vec2 off = lean * bend * v * v + (dp / dl) * push * v * v * 0.75;
    float drop = 1.0 - 0.30 * dot(off, off) / max(h * h, 1e-4);
    vec3 P = vec3(base.x + off.x, y0 + h * v * clamp(drop, 0.45, 1.0), base.y + off.y);

    vec2 perp = normalize(mix(vec2(1.0, 0.0), vec2(-lean.y, lean.x), 0.40));
    float wdt = (0.0080 + 0.0040 * a_rand.y) * (1.0 - 0.88 * v);
    P.xz += perp * side * wdt;

    vec3 rel = P - uEye;
    float cp = cos(uPitch), sp = sin(uPitch);
    float wx = rel.x;
    float wy = rel.y * cp - rel.z * sp;
    float depth = max(-rel.y * sp - rel.z * cp, 0.05);
    gl_Position = vec4(uF * wx / uAspect, uF * wy, 1.00334 * depth - 0.2003, depth);

    vec3 nrm = normalize(vec3(lean.x * 0.55, 1.0, lean.y * 0.55));
    float lam = 0.34 + 0.66 * clamp(dot(nrm, normalize(vec3(-0.35, 0.80, 0.48))), 0.0, 1.0);
    vec3 c = mix(uBase, uTip, pow(v, 0.85));
    c *= 0.55 + 0.45 * lam;
    c *= 0.70 + 0.42 * h21(base * 3.1);
    c *= mix(0.42, 1.0, pow(v, 0.7));
    vCol = c;
    vFog = clamp((depth - 8.0) / 26.0, 0.0, 1.0);
}
`;

const EYE_Y = 1.35, PITCH = .135, FOCAL = 1.55;
const PALETTES = {
  day: { base: [0.085, .19, .055], tip: [.53, .72, .25], haze: [.64, .81, .88] },
  dawn: { base: [.08, .15, .10], tip: [.46, .60, .34], haze: [.64, .67, .77] },
  dusk: { base: [.15, .16, .06], tip: [.65, .57, .25], haze: [.79, .61, .58] },
  night: { base: [.018, .055, .050], tip: [.16, .29, .24], haze: [.10, .21, .31] },
};

export function createGrassField(canvas, wake) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, powerPreference: 'low-power' });
  if (!gl) { canvas.dataset.renderer = 'photo-fallback'; return null; }
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const bladeCount = mobile ? 9000 : 24000;
  let programs = [], buffers = [], ground, blades;
  let groundCount = 0, lost = false, disposed = false;
  let palette = null;
  let previousTime = -1, lastState = '', frames = 0;
  const pointer = { x: .5, y: .5, targetX: .5, targetY: .5, on: 0, targetOn: 0 };

  function link(vertex, fragment) {
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, index) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Grass shader allocation');
      gl.shaderSource(shader, index === 0 ? vertex : fragment); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Grass shader compilation'); }
      return shader;
    });
    const program = gl.createProgram();
    if (!program) throw new Error('Grass program allocation');
    shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('Grass program link'); }
    programs.push(program);
    const uniforms = new Map();
    return { program, u(name) { if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name)); return uniforms.get(name); } };
  }
  function buffer(array) {
    const value = gl.createBuffer(); buffers.push(value);
    gl.bindBuffer(gl.ARRAY_BUFFER, value); gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    return value;
  }
  function clean() {
    buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value));
    buffers = []; programs = [];
  }
  function setup() {
    try {
      ground = link(GROUND_VS, FIELD_FS); blades = link(BLADE_VS, FIELD_FS);
      // OriginKit's logarithmically spaced terrain grid.
      const nx = 72, nz = 58, vertices = [];
      const gz = index => -(.04 * Math.pow(46 / .04, index / nz));
      for (let i = 0; i < nz; i++) {
        const z0 = gz(i), z1 = gz(i + 1), s0 = 3 - z0 * 1.05, s1 = 3 - z1 * 1.05;
        for (let j = 0; j < nx; j++) {
          const t0 = j / nx * 2 - 1, t1 = (j + 1) / nx * 2 - 1;
          vertices.push(t0*s0,z0,t1*s0,z0,t0*s1,z1,t0*s1,z1,t1*s0,z0,t1*s1,z1);
        }
      }
      ground.buffer = buffer(new Float32Array(vertices)); groundCount = vertices.length / 2;
      ground.position = gl.getAttribLocation(ground.program, 'a_xz');
      const base = new Float32Array(bladeCount * 18), param = new Float32Array(bladeCount * 18), random = new Float32Array(bladeCount * 18);
      const shape = [[0,-1],[0,1],[.55,-1],[.55,-1],[0,1],[.55,1],[.55,-1],[.55,1],[1,0]];
      let vi = 0;
      for (let b = 0; b < bladeCount; b++) {
        const dist = .55 + 32 * Math.pow((b * .6180339887498949) % 1, 1.75);
        const spread = 2.2 + dist * .85;
        const x = ((b * .41421356237309515) % 1) * 2 * spread - spread;
        const r0 = (b * .7320508075688772) % 1, r1 = (b * .5436890126920763) % 1;
        for (const [v, side] of shape) {
          base[vi] = x; base[vi+1] = -dist;
          param[vi] = v; param[vi+1] = side; random[vi] = r0; random[vi+1] = r1; vi += 2;
        }
      }
      blades.attributes = [['a_base', base], ['a_param', param], ['a_rand', random]].map(([name, array]) => ({ location: gl.getAttribLocation(blades.program, name), buffer: buffer(array) }));
      canvas.dataset.renderer = 'originkit-grass'; canvas.dataset.blades = String(bladeCount);
      return true;
    } catch {
      clean(); canvas.dataset.renderer = 'photo-fallback'; return false;
    }
  }
  function bind(location, value) {
    gl.bindBuffer(gl.ARRAY_BUFFER, value); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }
  function common(program, aspect) {
    gl.useProgram(program.program);
    gl.uniform1f(program.u('uAspect'), aspect); gl.uniform1f(program.u('uF'), FOCAL);
    gl.uniform3f(program.u('uEye'), 0, EYE_Y, 0); gl.uniform1f(program.u('uPitch'), PITCH);
    gl.uniform1f(program.u('uTerrain'), 1);
    // Keep the far terrain and blade field beyond both sides of the camera frustum.
    gl.uniform1f(program.u('uFieldWidth'), Math.max(1, aspect * .9));
    gl.uniform3fv(program.u('uBase'), palette.base); gl.uniform3fv(program.u('uHaze'), palette.haze);
  }
  function render({ time, ground: arrival, theme, moving, reduced, width, height }) {
    if (disposed || lost || canvas.dataset.renderer !== 'originkit-grass') return false;
    const state = `${theme}/${width}/${height}/${reduced}/${moving}`;
    // The grass follows the world's clock; it has no independent animation loop.
    // Keep camera/CSS movement smooth while limiting the heavier grass pass to 30Hz.
    if (state === lastState && time >= previousTime && time - previousTime < 1 / 30) return true;
    lastState = state; previousTime = time;
    const target = PALETTES[theme] || PALETTES.day;
    if (!palette || reduced || !moving) palette = Object.fromEntries(Object.entries(target).map(([key, value]) => [key, [...value]]));
    else for (const key of Object.keys(target)) palette[key] = palette[key].map((value, index) => value + (target[key][index] - value) * .16);
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.25, 3840 / width, 2160 / height);
    const bw = Math.round(width * dpr), bh = Math.round(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    gl.viewport(0, 0, bw, bh); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    const aspect = bw / bh;
    const activePointer = moving && arrival > .8 ? pointer.targetOn : 0;
    pointer.on += (activePointer - pointer.on) * .2;
    pointer.x += (pointer.targetX - pointer.x) * .2; pointer.y += (pointer.targetY - pointer.y) * .2;
    const nx = (pointer.x * 2 - 1) * aspect / FOCAL, ny = ((1 - pointer.y) * 2 - 1) / FOCAL;
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH), dy = ny * cp - sp, dz = -ny * sp - cp;
    let pushX = 0, pushZ = -999, amount = 0;
    if (dy < -.001) { const distance = -EYE_Y / dy; if (distance > 0 && distance < 42) { pushX = distance * nx; pushZ = distance * dz; amount = pointer.on * 1.2; } }
    for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
    common(ground, aspect); bind(ground.position, ground.buffer); gl.drawArrays(gl.TRIANGLES, 0, groundCount);
    for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
    common(blades, aspect); blades.attributes.forEach(attribute => bind(attribute.location, attribute.buffer));
    gl.uniform1f(blades.u('uTime'), time * 2); gl.uniform2f(blades.u('uPush'), pushX, pushZ);
    gl.uniform1f(blades.u('uPushAmt'), amount); gl.uniform1f(blades.u('uReach'), 1.57 * 1.35);
    gl.uniform1f(blades.u('uHeight'), 1.81); gl.uniform1f(blades.u('uWind'), 1); gl.uniform1f(blades.u('uGust'), .9);
    gl.uniform2f(blades.u('uWindDir'), .966, .259); gl.uniform3fv(blades.u('uTip'), palette.tip);
    gl.drawArrays(gl.TRIANGLES, 0, bladeCount * 9);
    canvas.dataset.time = time.toFixed(3); canvas.dataset.push = amount.toFixed(3); canvas.dataset.frames = String(++frames);
    return true;
  }
  function track(event) {
    if (canvas.hidden || event.pointerType !== 'mouse' || event.target.closest?.('a,button,input,textarea,dialog')) { pointer.targetOn = 0; return; }
    const bounds = canvas.getBoundingClientRect();
    pointer.targetX = Math.max(0, Math.min(1, event.clientX / bounds.width));
    pointer.targetY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pointer.targetOn = 1;
  }
  function leave() { pointer.targetOn = 0; }
  function onLoss(event) { event.preventDefault(); lost = true; canvas.dataset.renderer = 'photo-fallback'; wake(); }
  function onRestore() { lost = false; buffers = []; programs = []; lastState = ''; setup(); wake(); }
  function dispose() {
    if (disposed) return;
    disposed = true; clean();
    window.removeEventListener('pointermove', track); window.removeEventListener('pointerout', leave);
    canvas.removeEventListener('webglcontextlost', onLoss); canvas.removeEventListener('webglcontextrestored', onRestore);
  }
  if (!setup()) return null;
  window.addEventListener('pointermove', track, { passive: true }); window.addEventListener('pointerout', leave);
  canvas.addEventListener('webglcontextlost', onLoss); canvas.addEventListener('webglcontextrestored', onRestore);
  return { render, dispose };
}
