// Finite local-only component experiment; no DB, remote binding, or credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = process.argv[2];
assert(output && path.isAbsolute(output));
await mkdir(output);
const require = createRequire(import.meta.url);
const installed = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = installed("miniflare");
const script = String.raw`
const badUnicode = /[\uD800-\uDFFF]/u;
const controls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const combined = /[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const plainControls = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const texts = { ascii:'x'.repeat(200000), korean:'가'.repeat(66666)+'xx', emoji:'😀'.repeat(50000) };
export default {async fetch(request) {
 const {mode,kind} = await request.json(), text=texts[kind];let accepted=0;
 for(let i=0;i<400;i++) {
  let valid;
  if(mode==='original')valid=!badUnicode.test(text)&&!controls.test(text);
  else if(mode==='native')valid=text.isWellFormed()&&!controls.test(text);
  else if(mode==='combined')valid=!combined.test(text);
  else if(mode==='plain-control')valid=text.isWellFormed()&&!plainControls.test(text);
  else throw Error('Unsupported mode');
  accepted+=Number(valid);
 }
 return Response.json({mode,kind,accepted});
}};`;
const mf = new Miniflare(convertV4MiniflareOptions({ inspectorPort:0,port:0,host:"127.0.0.1",log:new Log(LogLevel.ERROR),
  workers:[{name:"p527-text-checks",modules:true,script,compatibilityDate:"2026-08-25",
    outboundService:()=>new Response("Disabled",{status:403})}]}));
let socket, serial=0;const pending=new Map();
function cdp(method,params={}) {return new Promise((resolve,reject)=>{
  const id=++serial, timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout"));},15000);
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
});}
const results=[];
try {
 await mf.ready;const url=await mf.getInspectorURL();url.protocol="http:";
 const targets=await(await fetch(new URL("/json/list",url))).json();
 const target=targets.find(t=>t.title.includes("p527-text-checks"));assert(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
 socket.addEventListener("message",e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;
  pending.delete(v.id);clearTimeout(p.timer);if(v.error)p.reject(Error(JSON.stringify(v.error)));else p.resolve(v.result);});
 await cdp("Profiler.enable");await cdp("Profiler.setSamplingInterval",{interval:100});
 for(let round=0;round<2;round++)for(const kind of ["ascii","korean","emoji"]) {
  const modes=["original","native","combined","plain-control"];if(round) modes.reverse();
  for(const mode of modes) {
   await cdp("Profiler.start");const response=await mf.dispatchFetch("https://local.invalid/",{method:"POST",body:JSON.stringify({mode,kind})});
   const result=await response.json();assert.equal(result.accepted,400);
   const {profile}=await cdp("Profiler.stop");const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
   const frames=new Map();for(const id of profile.samples??[]){const f=nodes.get(id).callFrame;const key=JSON.stringify(f);frames.set(key,(frames.get(key)||0)+1);}
   const summary={round,...result,frames:[...frames].map(([k,samples])=>({...JSON.parse(k),samples})).sort((a,b)=>b.samples-a.samples)};
   summary.activeSamples=summary.frames.filter(f=>!["(idle)","(program)"].includes(f.functionName)).reduce((a,f)=>a+f.samples,0);
   results.push(summary);console.log(JSON.stringify({round,kind,mode,activeSamples:summary.activeSamples}));
   await writeFile(path.join(output,`${round}-${kind}-${mode}.cpuprofile`),JSON.stringify(profile),{flag:"wx"});
  }
 }
 await writeFile(path.join(output,"summary.json"),JSON.stringify({kind:"local-component-samples-not-billing-ms",results}),{flag:"wx"});
}finally{socket?.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error("Closed"));}await mf.dispose();}
