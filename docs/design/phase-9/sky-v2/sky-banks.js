/* global window */
// Animate the original day/night artwork in place. No replacement artwork or
// repeated cloud sprites: each soft region follows a cloud bank in that image.
const BANKS = [
  { name: 'upper-left-wisps', center: [.12, .12], radius: [.28, .20], pixels: 4, speed: .045, phase: .0 },
  { name: 'left-high-tower', center: [.08, .38], radius: [.19, .23], pixels: 9, speed: .031, phase: .6 },
  { name: 'left-middle-tower', center: [.29, .61], radius: [.16, .20], pixels: 7, speed: .037, phase: 1.2 },
  { name: 'left-near-bank', center: [.09, .79], radius: [.24, .24], pixels: 11, speed: .024, phase: 2.1 },
  { name: 'lower-left-bank', center: [.32, .91], radius: [.19, .19], pixels: 8, speed: .030, phase: 3.3 },
  { name: 'lower-center-bank', center: [.53, .91], radius: [.16, .16], pixels: 5, speed: .026, phase: 4.0 },
  { name: 'distant-center-bank', center: [.52, .75], radius: [.22, .10], pixels: 3, speed: .040, phase: 1.8 },
  { name: 'middle-wisps', center: [.56, .57], radius: [.26, .08], pixels: 3, speed: .043, phase: 4.8 },
  { name: 'upper-right-wisps', center: [.94, .12], radius: [.15, .19], pixels: 4, speed: .036, phase: 2.7 },
  { name: 'right-high-tower', center: [.96, .43], radius: [.18, .22], pixels: 10, speed: .029, phase: 5.3 },
  { name: 'right-middle-bank', center: [.80, .65], radius: [.19, .18], pixels: 7, speed: .034, phase: .9 },
  { name: 'right-near-bank', center: [.86, .88], radius: [.26, .21], pixels: 11, speed: .022, phase: 3.7 },
];

export function createSkyBanks(vault, wake) {
  const canvas = vault.querySelector('#sky-banks');
  const images = [...vault.querySelectorAll('picture img')];
  let gl = null, attempted = false;
  let program, buffer, uniforms, lost = false, disposed = false;
  let textures = [], sources = [], lastState = '', lastTime = -1, frames = 0;
  let night = 0;
  const shifts = new Float32Array(BANKS.length);
  function fallback() {
    if (!canvas.hidden) canvas.hidden = true;
    if (vault.dataset.banks !== 'static') vault.dataset.banks = 'static';
  }
  function release() {
    if (!gl) return;
    textures.forEach(texture => { if (texture) gl.deleteTexture(texture); });
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    textures = []; sources = []; program = null; buffer = null;
  }
  function setup() {
    attempted = true;
    gl ??= canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) { fallback(); return; }
    try {
      const vertex = 'attribute vec2 aPosition; varying vec2 vUv; void main(){vUv=vec2(aPosition.x,1.0-aPosition.y);gl_Position=vec4(aPosition*2.0-1.0,0.0,1.0);}';
      const fragment = `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform float uNightMix;
        uniform vec4 uCrop;
        uniform vec4 uBanks[${BANKS.length}];
        uniform float uShifts[${BANKS.length}];
        void main(){
          vec2 uv=uCrop.xy+vUv*uCrop.zw;
          float weight=0.0;
          float offset=0.0;
          for(int i=0;i<${BANKS.length};i++){
            vec2 local=(uv-uBanks[i].xy)/uBanks[i].zw;
            float mask=1.0-smoothstep(0.30,1.0,dot(local,local));
            weight+=mask;
            offset+=mask*uShifts[i];
          }
          // A partition of the original image keeps cloud density and avoids
          // transparent seams or a second, stationary cloud behind each bank.
          // Only x is displaced. The clear sky, moon and vertical framing stay put.
          uv.x=clamp(uv.x-offset/max(1.0,weight),0.001,0.999);
          gl_FragColor=mix(texture2D(uDay,uv),texture2D(uNight,uv),uNightMix);
        }`;
      const shaders = [vertex, fragment].map((source, index) => {
        const shader = gl.createShader(index ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Sky bank shader'); }
        return shader;
      });
      program = gl.createProgram(); shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Sky bank program');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['uCrop','uNightMix','uBanks[0]','uShifts[0]'].map(name => [name, gl.getUniformLocation(program, name)]));
      gl.uniform1i(gl.getUniformLocation(program, 'uDay'), 0); gl.uniform1i(gl.getUniformLocation(program, 'uNight'), 1);
      gl.uniform4fv(uniforms['uBanks[0]'], new Float32Array(BANKS.flatMap(bank => [...bank.center, ...bank.radius])));
      lastState = ''; lastTime = -1;
    } catch { release(); fallback(); }
  }
  function upload(index) {
    const image = images[index], source = image.currentSrc;
    if (!image.complete || !image.naturalWidth) return false;
    if (sources[index] === source) return true;
    if (textures[index]) gl.deleteTexture(textures[index]);
    const texture = gl.createTexture(); textures[index] = texture;
    gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    sources[index] = source;
    return true;
  }
  function render({ time, width, height, theme, visible, moving }) {
    if (!disposed && !lost && visible && !attempted) setup();
    if (disposed || lost || !program || !visible) { fallback(); return; }
    if (!upload(0) || !upload(1)) { fallback(); return; }
    const state = `${width}/${height}/${theme}/${moving}/${sources.join('/')}`;
    if (state === lastState && time >= lastTime && time - lastTime < 1 / 30 && !canvas.hidden) return;
    const initial = lastTime < 0;
    lastState = state; lastTime = time;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25, 2560 / (width * 1.04), 1440 / (height * 1.04));
    const bw = Math.round(width * 1.04 * dpr), bh = Math.round(height * 1.04 * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    gl.viewport(0, 0, bw, bh); gl.useProgram(program);
    const aspect = width / height, imageAspect = images[0].naturalWidth / images[0].naturalHeight;
    const cropX = Math.min(1, aspect / imageAspect), cropY = Math.min(1, imageAspect / aspect);
    gl.uniform4f(uniforms.uCrop, (1 - cropX) * (width <= 700 ? .53 : .5), (1 - cropY) * .5, cropX, cropY);
    for (let i = 0; i < BANKS.length; i++) {
      const bank = BANKS[i];
      const pixels = (Math.sin(time * bank.speed + bank.phase) - Math.sin(bank.phase)) * bank.pixels;
      shifts[i] = pixels * cropX / (width * 1.04);
    }
    gl.uniform1fv(uniforms['uShifts[0]'], shifts);
    const targetNight = theme === 'night' ? 1 : 0;
    night = initial || !moving ? targetNight : night + (targetNight - night) * .12;
    gl.uniform1f(uniforms.uNightMix, night);
    textures.forEach((texture, index) => { gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture); });
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.hidden = false; vault.dataset.banks = 'ready';
    canvas.dataset.time = time.toFixed(3); canvas.dataset.frames = String(++frames);
    canvas.dataset.layers = String(BANKS.length);
  }
  function onLoss(event) { event.preventDefault(); lost = true; fallback(); wake(); }
  function onRestore() { lost = false; textures = []; sources = []; program = null; buffer = null; setup(); wake(); }
  function dispose() {
    if (disposed) return;
    disposed = true; release();
    images.forEach(image => { image.removeEventListener('load', wake); image.removeEventListener('error', wake); });
    canvas.removeEventListener('webglcontextlost', onLoss); canvas.removeEventListener('webglcontextrestored', onRestore);
  }
  images.forEach(image => { image.addEventListener('load', wake); image.addEventListener('error', wake); });
  canvas.addEventListener('webglcontextlost', onLoss); canvas.addEventListener('webglcontextrestored', onRestore);
  return { render, dispose };
}
