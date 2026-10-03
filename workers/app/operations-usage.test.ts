import { env, exports } from 'cloudflare:workers';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {readOperationsUsage,refreshOperationsUsage,confirmOperationsMonth,usageStatus,seoulMonth,fetchR2Usage} from '../_shared/services/operations-usage';
import {serviceIds,pricingVersion} from '../../src/config/service-registry';
import {enforcePublicRate,publicRateResponse} from '../_shared/services/public-rate-limit';
import {app,type AppBindings,type AppEnvironment} from './app';
import {Hono} from 'hono';
import {createAccessFixture} from './test/access-fixture';
const base=env as AppBindings,now=new Date('2026-10-01T00:00:00.000Z'),at=now.toISOString();
beforeEach(async()=>{for(const table of ['service_usage_snapshots','pricing_catalog','monthly_operations_checks'])await base.DB.prepare(`DELETE FROM ${table}`).run();});
afterEach(()=>vi.restoreAllMocks());
describe('P8 usage and monthly operations',()=>{
 it('uses Korean month boundaries and leaves missing, invalid and stale values delayed',()=>{
   expect(seoulMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
   expect(usageStatus({requests:0},{requests:100},at,null,now)).toBe('comfortable');
   expect(usageStatus({requests:50},{requests:100},at,null,now)).toBe('check');
   expect(usageStatus({requests:80},{requests:100},at,null,now)).toBe('warning');
   for(const date of [null,'invalid','2026-09-29T00:00:00Z'])expect(usageStatus({requests:0},{requests:100},date,null,now)).toBe('delayed');
   expect(usageStatus({requests:0,durationGbSeconds:null},{requests:100,durationGbSeconds:100},at,null,now)).toBe('delayed');
   expect(usageStatus({requests:80,durationGbSeconds:null},{requests:100,durationGbSeconds:100},at,null,now)).toBe('warning');
   expect(usageStatus({costMicroUsd:100,unknownCalls:1},{},at,null,now)).toBe('delayed');
 });
 it('does not fabricate infrastructure zeroes or call a provider during reads',async()=>{
   const f=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('NO_NETWORK'));
   const view=await readOperationsUsage(base,now);expect(view.items.filter(v=>v.service!=='openai')).toHaveLength(9);
   expect(view.items.filter(v=>v.service!=='openai').every(v=>v.status==='delayed'&&Object.keys(v.metrics).length===0)).toBe(true);
   expect(f).not.toHaveBeenCalled();expect(await base.DB.prepare('SELECT COUNT(*) n FROM pricing_catalog').first()).toEqual({n:0});
 });
 it('preserves old project observations while exposing a failed account refresh and caches for five minutes',async()=>{
   await base.DB.prepare("INSERT INTO service_usage_snapshots(id,service,scope,scope_id,period_start,period_end,metrics_json,source,fetched_at) VALUES('old','workers','project','app',?,?,'{\"requests\":42}','cloudflare_graphql',?)").bind(at,at,at).run();
   const f=vi.fn(async()=>{throw new Error('secret upstream detail');}) as typeof fetch;
   const view=await refreshOperationsUsage(base,now,f),old=view.items.find(v=>v.scopeId==='app');
   expect(old).toMatchObject({status:'delayed',metrics:{requests:42},errorCode:'METRICS_NOT_CONNECTED'});
   expect(JSON.stringify(view)).not.toContain('secret upstream');
   const rows=await base.DB.prepare('SELECT COUNT(*) n FROM service_usage_snapshots').first();
   await refreshOperationsUsage(base,new Date(now.getTime()+60_000),f);expect(await base.DB.prepare('SELECT COUNT(*) n FROM service_usage_snapshots').first()).toEqual(rows);
   expect(await base.DB.prepare("SELECT refresh_lease_id FROM pricing_catalog WHERE service='workers'").first()).toEqual({refresh_lease_id:null});
 });
 it('requires all service/version confirmations, records a month once, and keeps actual warnings',async()=>{
   const command={yearMonth:'2026-10',pricingVersion,checkedServices:[...serviceIds],confirmation:'official_policies_reviewed'};
   await expect(confirmOperationsMonth(base,{...command,checkedServices:['workers']},'synthetic@example.invalid',now)).rejects.toThrow('POLICY_CHECK_CONFLICT');
   await expect(confirmOperationsMonth(base,{...command,yearMonth:'2026-09'},'synthetic@example.invalid',now)).rejects.toThrow('POLICY_CHECK_CONFLICT');
   const view=await confirmOperationsMonth(base,command,'synthetic@example.invalid',now);expect(view.policyCheckNeeded).toBe(false);expect(view.items.some(v=>v.status==='delayed')).toBe(true);
   expect((await readOperationsUsage(base,new Date('2026-10-31T15:00:00Z'))).policyCheckNeeded).toBe(true);
 });
 it('uses account totals with multiple buckets and refuses unknown operation classes',async()=>{
   const b={...base,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_ANALYTICS_TOKEN:'synthetic-only',BACKUP_BUCKET_NAME:'backup'};
   const fixture={storage:[{max:{objectCount:1,payloadSize:100,metadataSize:1},dimensions:{bucketName:'backup',datetime:at}},{max:{objectCount:2,payloadSize:200,metadataSize:2},dimensions:{bucketName:'other',datetime:at}}],operations:[{sum:{requests:5},dimensions:{actionType:'PutObject',bucketName:'other'}}]};
   const f=vi.fn(async()=>Response.json({data:{viewer:{accounts:[fixture]}}})) as typeof fetch;
   expect(await fetchR2Usage(b,now,f)).toMatchObject({account:{storageBytes:303,classA:5},bucket:{storageBytes:101,classA:0}});
   fixture.operations[0]!.dimensions.actionType='Unknown';await expect(fetchR2Usage(b,now,f)).rejects.toThrow('R2_OPERATIONS_UNCLASSIFIED');
 });
 it('rejects analytics and account API redirects without caching their body or forwarding credentials',async()=>{
   const b={...base,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_ANALYTICS_TOKEN:'synthetic-only',BACKUP_BUCKET_NAME:'backup'};
   const f=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
     expect(new URL(String(input)).origin).toBe('https://api.cloudflare.com');
     expect(init?.redirect).toBe('manual');
     return new Response('private-redirect-canary',{status:302,headers:{Location:'https://untrusted.test.invalid/redirect'}});
   });
   await expect(fetchR2Usage(b,now,f as typeof fetch)).rejects.toThrow('METRICS_FETCH_FAILED');
   expect(f).toHaveBeenCalledTimes(1);
   const view=await refreshOperationsUsage(b,now,f as typeof fetch);
   for(const service of ['r2','workers_builds','access'])expect(view.items.find(item=>item.service===service)).toMatchObject({status:'delayed',errorCode:'METRICS_FETCH_FAILED'});
   expect(f.mock.calls.every(([input])=>String(input).startsWith('https://api.cloudflare.com/'))).toBe(true);
   const saved=await base.DB.prepare('SELECT metrics_json FROM service_usage_snapshots').all();
   expect(JSON.stringify(saved)).not.toContain('private-redirect-canary');
   expect(JSON.stringify(saved)).not.toContain('synthetic-only');
 });
 it('guards operations and manual endpoints with Access, same-origin JSON and safe private responses',async()=>{
   const access=await createAccessFixture(new Date());vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{if(String(input).startsWith('https://test-team.cloudflareaccess.com/'))return Response.json(access.jwks);throw new Error('NO_EXTERNAL');});
   const paths=['/api/admin/usage-summary','/api/admin/backups','/api/admin/manual','/api/admin/manual/future/member-auth'];
   for(const path of paths){const no=await exports.default.fetch(new Request(`https://example.com${path}`));expect(no.status).toBe(401);
     const yes=await exports.default.fetch(new Request(`https://example.com${path}`,{headers:{'Cf-Access-Jwt-Assertion':access.token}}));expect(yes.status).toBe(200);expect(yes.headers.get('Cache-Control')).toBe('private, no-store');const text=await yes.text();expect(text).not.toContain(access.token);expect(text).not.toContain('synthetic@example.invalid');}
   const post=await exports.default.fetch(new Request('https://example.com/api/admin/backups',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':access.token,Origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'}));expect(post.status).toBe(403);
   const query=await exports.default.fetch(new Request('https://example.com/api/admin/usage-summary?token=ignored',{headers:{'Cf-Access-Jwt-Assertion':access.token}}));expect(query.status).toBe(400);
 });
});
describe('P8 public request limiting',()=>{
 it('counts separate stable actors/routes and never puts IP or secret in the key',async()=>{
   const limit=vi.fn(async(input:{key:string})=>({success:input.key.length>0}));const b={...base,PUBLIC_RATE_LIMIT_ENABLED:'true',PUBLIC_ACTOR_LIMIT:{limit},PUBLIC_GUEST_LIMIT:{limit},PUBLIC_SESSION_LIMIT:{limit}};
   const request=new Request('https://example.com/',{headers:{'cf-connecting-ip':'192.0.2.1'}});
   for(let i=0;i<50;i++)await enforcePublicRate(b,request,'submissions/v',i.toString(16).padStart(64,'0'));
   expect(new Set(limit.mock.calls.map(c=>c[0].key)).size).toBe(50);
   await enforcePublicRate(b,request,'session');expect(limit.mock.calls.at(-1)![0].key).not.toContain('192.0.2.1');expect(limit.mock.calls.at(-1)![0].key).not.toContain(base.SESSION_PEPPER);
   expect(await enforcePublicRate({...base,PUBLIC_RATE_LIMIT_ENABLED:'false'},request,'session')).toBeUndefined();
 });
 it('returns 429 with Retry-After, preserves the public error envelope, and fails closed when enabled but unavailable',async()=>{
   const request=new Request('https://example.com/',{headers:{'cf-connecting-ip':'192.0.2.1'}});
   const b={...base,PUBLIC_RATE_LIMIT_ENABLED:'true',PUBLIC_GUEST_LIMIT:{limit:vi.fn(async()=>({success:false}))}};
   await expect(enforcePublicRate(b,request,'privacy-read')).rejects.toMatchObject({status:429});
   await expect(enforcePublicRate({...base,PUBLIC_RATE_LIMIT_ENABLED:"true"},request,'privacy-read')).rejects.toMatchObject({status:503});
   const server=new Hono<AppEnvironment>();server.get('/',async c=>{c.set('requestId','synthetic');return await publicRateResponse(c as never,'privacy-read')??c.text('ok');});
   const response=await server.fetch(request,b);expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('10');expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 });
 it('limits the actual session issuer before any new session is stored',async()=>{
   const limit=vi.fn(async()=>({success:false}));
   const response=await app.fetch(new Request('https://example.com/api/session',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json','cf-connecting-ip':'192.0.2.1'},body:'{}'}),{...base,PUBLIC_RATE_LIMIT_ENABLED:'true',PUBLIC_SESSION_LIMIT:{limit}});
   expect(response.status).toBe(429);expect(response.headers.get('Set-Cookie')).toBeNull();
 });
});

it('enforces native local counters per actor while fifty actors share the same IP',async()=>{
  const runtime=env as AppBindings & {TEST_PUBLIC_LIMIT:RateLimit};
  const b={...base,PUBLIC_RATE_LIMIT_ENABLED:'true',PUBLIC_ACTOR_LIMIT:runtime.TEST_PUBLIC_LIMIT};
  const request=new Request('https://example.com/',{headers:{'cf-connecting-ip':'192.0.2.1'}}),scope=crypto.randomUUID();
  for(let i=0;i<50;i++)await enforcePublicRate(b,request,scope,i.toString(16).padStart(64,'0'));
  // Native local windows follow the wall clock. The fifty-actor loop may
  // cross a window, so fill a fresh actor immediately before asserting it.
  const remaining=10_000-Date.now()%10_000;
  if(remaining<2_000)await new Promise(resolve=>setTimeout(resolve,remaining+50));
  const actor='f'.repeat(64);for(let i=0;i<6;i++)await enforcePublicRate(b,request,scope,actor);
  await expect(enforcePublicRate(b,request,scope,actor)).rejects.toMatchObject({status:429});
  await expect(enforcePublicRate(b,request,scope,'1'.repeat(64))).resolves.toBeUndefined();
});
it('reads supported Builds exhaustion and Access seat fields without retaining upstream PII',async()=>{
 const b={...base,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_ANALYTICS_TOKEN:'synthetic-only'};
 const f=vi.fn(async input=>{const url=String(input);
   if(url.includes('/builds/account/limits'))return Response.json({success:true,result:{has_reached_build_minutes_limit:true,build_minutes_refresh_on:'2026-11-01T00:00:00Z'}});
   if(url.includes('/access/users'))return Response.json({success:true,result:[{id:'synthetic-user',seat_uid:'same-seat',email:'private-fixture@example.invalid',access_seat:true,gateway_seat:true}],result_info:{page:1,total_pages:1,total_count:1}});
   return Response.json({errors:[{}],data:null});
 }) as typeof fetch;
 const data=await refreshOperationsUsage(b,now,f);
 expect(data.items.find(i=>i.service==='workers_builds')).toMatchObject({source:'provider_api',metrics:{buildMinutes:null,buildLimitReached:1},status:'warning'});
 expect(data.items.find(i=>i.service==='access')).toMatchObject({metrics:{activeSeats:1},status:'comfortable'});
 const rows=await base.DB.prepare('SELECT metrics_json FROM service_usage_snapshots').all();expect(JSON.stringify(rows)).not.toContain('private-fixture');expect(JSON.stringify(rows)).not.toContain('same-seat');
});
