/* global document, matchMedia, innerWidth, innerHeight, structuredClone, scrollY, devicePixelRatio, requestAnimationFrame, performance, addEventListener, cancelAnimationFrame */
// Original, dependency-free motion study. No Air code, media, fonts, or models are reused.
(() => {
  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const motion = document.getElementById('motion');
  if (!ctx) { motion.disabled = true; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const themes = {
    dawn: { top:[102,137,178], bottom:[255,214,181], cloud:[255,226,204], grass:[86,106,64] },
    day: { top:[24,123,219], bottom:[213,238,255], cloud:[255,255,255], grass:[83,126,55] },
    dusk: { top:[120,110,170], bottom:[255,185,137], cloud:[255,222,204], grass:[77,89,56] },
    night: { top:[4,21,47], bottom:[36,93,134], cloud:[91,130,161], grass:[19,44,37] },
  };
  let width = innerWidth, height = innerHeight, time = 0, last = 0, frame = 0;
  let paused = reduced.matches, progress = 0, targetProgress = 0, transition = null;
  let colors = structuredClone(themes.day);
  const rgb = c => `rgb(${c.map(Math.round).join(',')})`;
  const clamp = (v,a=0,b=1) => Math.min(b,Math.max(a,v));
  const smooth = v => { v=clamp(v); return v*v*(3-2*v); };
  const mix = (a,b,t) => a.map((x,i)=>x+(b[i]-x)*t);
  let seed = 371;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const hashes = new Float32Array(128*128);
  for (let i=0;i<hashes.length;i++) hashes[i]=random();
  function noise(x,y) {
    const a=Math.floor(x), b=Math.floor(y), fx=smooth(x-a), fy=smooth(y-b);
    const n=(i,j)=>hashes[((j&127)*128)+(i&127)];
    return (n(a,b)*(1-fx)+n(a+1,b)*fx)*(1-fy)+(n(a,b+1)*(1-fx)+n(a+1,b+1)*fx)*fy;
  }
  function texture(offset) {
    const c=document.createElement('canvas');c.width=384;c.height=192;
    const context=c.getContext('2d'), image=context.createImageData(c.width,c.height);
    const lobes=Array.from({length:13},()=>({x:.14+random()*.72,y:.25+random()*.43,rx:.09+random()*.14,ry:.17+random()*.20}));
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++) {
      const u=x/c.width,v=y/c.height;
      let shape=0;for(const l of lobes)shape=Math.max(shape,Math.exp(-2.4*(((u-l.x)/l.rx)**2+((v-l.y)/l.ry)**2)));
      const detail=noise(u*12+offset,v*9)*.55+noise(u*29+offset,v*24)*.28+noise(u*73,v*60+offset)*.17;
      const density=clamp((shape+detail*.34-.28)*2.8);
      const edge=smooth(clamp(u*15))*smooth(clamp((1-u)*15))*smooth(clamp(v*10))*smooth(clamp((1-v)*10));
      const shade=clamp(.96-v*.23+(detail-.5)*.15,.60,1), i=(y*c.width+x)*4;
      image.data[i]=Math.round(255*shade);image.data[i+1]=Math.round(255*shade);image.data[i+2]=Math.round(255*shade);image.data[i+3]=Math.round(255*density*edge);
    }
    context.putImageData(image,0,0);return c;
  }
  const textures=[texture(0),texture(31),texture(68)];
  const clouds=Array.from({length:30},(_,i)=>({x:(random()-.5)*2600,altitude:500+random()*2400,z:700+random()*1800,size:400+random()*800,phase:random()*Math.PI*2,texture:i%3})).sort((a,b)=>b.z-a.z);
  let tintKey = '', tinted = [];
  function updateTint() {
    const key=rgb(colors.cloud);if(key===tintKey)return;tintKey=key;
    tinted=textures.map(texture=>{
      const c=document.createElement('canvas');c.width=384;c.height=192;const tc=c.getContext('2d');
      tc.drawImage(texture,0,0);tc.globalCompositeOperation='multiply';tc.fillStyle=key;tc.fillRect(0,0,384,192);
      tc.globalCompositeOperation='destination-in';tc.drawImage(texture,0,0);return c;
    });
  }
  const blades=Array.from({length:420},()=>({x:random(),depth:random(),bend:random()*2-1,size:random()}));
  function updateProgress() { targetProgress=clamp(scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)); schedule(); }
  function resize() {
    width=innerWidth;height=innerHeight;const dpr=Math.min(devicePixelRatio,1.5);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);updateProgress();
  }
  function draw() {
    const gradient=ctx.createLinearGradient(0,0,0,height);gradient.addColorStop(0,rgb(colors.top));gradient.addColorStop(1,rgb(colors.bottom));ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
    updateTint();
    const focal=Math.min(width,1400)*.9, altitude=2650*(1-progress);
    for(const cloud of clouds) {
      const depth=cloud.z-((time*7+cloud.phase*60)%160), scale=focal/depth;
      const x=width*.5+(cloud.x+Math.sin(time*.014+cloud.phase)*180)*scale;
      const y=height*.5-(cloud.altitude-altitude)*scale;
      const w=cloud.size*scale,h=w*.5;if(x+w<0||x-w>width||y+h<0||y-h>height)continue;
      ctx.globalAlpha=clamp(.35+scale*.40,.35,.84);ctx.drawImage(tinted[cloud.texture],x-w*.5,y-h*.5,w,h);
    }
    ctx.globalAlpha=1;
    const landing=smooth((progress-.58)/.42), horizon=height*(1.38-.85*landing);
    if(horizon<height+30) {
      for(let layer=0;layer<3;layer++) {
        ctx.beginPath();ctx.moveTo(0,height+10);
        for(let x=0;x<=width+12;x+=12) { const wave=Math.sin(x/width*5.2+layer)*height*.022+Math.sin(x/width*9.1-layer)*height*.01;ctx.lineTo(x,horizon+layer*height*.11+wave); }
        ctx.lineTo(width,height+10);ctx.closePath();ctx.fillStyle=rgb(mix(colors.grass,colors.bottom,.42-layer*.14));ctx.fill();
      }
      const grassTop=horizon+height*.20;
      for(const blade of blades) {
        const y=grassTop+blade.depth*(height-grassTop), x=blade.x*width, size=(6+blade.size*30)*(0.3+blade.depth);
        if(y>height||y<0)continue;const sway=Math.sin(time*.7+blade.x*8);
        ctx.strokeStyle=rgb(mix(colors.grass,colors.bottom,blade.size*.22));ctx.lineWidth=.6+blade.depth*1.2;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+blade.bend*size*.35,y-size*.65,x+blade.bend*size*.6+sway*2,y-size);ctx.stroke();
      }
    }
    canvas.dataset.progress=progress.toFixed(4);canvas.dataset.elapsed=time.toFixed(3);
  }
  function tick(now) {
    frame=0;if(document.hidden)return;
    if(last && now-last<32) { schedule(); return; }
    const dt=last?Math.min((now-last)/1000,.05):0;last=now;
    if(!paused)time+=dt;
    progress=reduced.matches||paused?targetProgress:progress+(targetProgress-progress)*Math.min(dt*8,1);
    if(transition) {
      const t=reduced.matches?1:clamp((now-transition.start)/1000), ease=1-(1-t)**3;
      for(const key of Object.keys(colors))colors[key]=mix(transition.from[key],transition.to[key],ease);
      if(t===1)transition=null;
    }
    draw();if(!paused||transition||Math.abs(progress-targetProgress)>.0001)schedule();
  }
  function schedule() { if(!frame&&!document.hidden)frame=requestAnimationFrame(tick); }
  for(const button of document.querySelectorAll('.time-control button')) button.addEventListener('click',()=>{
    document.body.dataset.time=button.dataset.time;
    document.querySelectorAll('.time-control button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    transition={from:structuredClone(colors),to:themes[button.dataset.time],start:performance.now()};schedule();
  });
  function updateMotion() { motion.setAttribute('aria-pressed',String(paused));motion.textContent=paused?'움직임 재개':'움직임 멈춤';last=0;schedule(); }
  motion.addEventListener('click',()=>{paused=!paused;updateMotion();});
  reduced.addEventListener('change',event=>{paused=event.matches;updateMotion();});
  addEventListener('scroll',updateProgress,{passive:true});addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();});
  paused=reduced.matches;resize();updateMotion();
})();
