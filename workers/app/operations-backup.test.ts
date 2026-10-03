import {env,type WorkflowStep,type WorkflowEvent} from 'cloudflare:workers';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createDatabase} from '../_shared/db/client';
import {backupRuns,pricingCatalog,serviceUsageSnapshots,monthlyOperationsChecks,auditLogs} from '../_shared/db/schema';
import {measureStream,registerBackupRun,storeSqlBackup,rotateSqlBackups,readBackups,syncDeletionManifest,mergeDeletionManifests,exportPoll,budgetBeforeUpload,backupFailure,requestBackup,type BackupBindings} from '../_shared/services/backup-storage';
import {runBackup,scheduleBackup} from '../backup/index';
import {runScheduledFinalization} from './index';
import {runScheduledDraftCleanup} from '../_shared/services/draft-cleanup';
const runtime=env as Env & {TEST_BACKUP_BUCKET:R2Bucket};
const db=createDatabase(runtime.DB),at='2026-10-01T00:00:00.000Z',bookmark='test-bookmark',url='https://export.test.invalid/synthetic.sql';
const base:BackupBindings={DB:runtime.DB,BACKUP_BUCKET:runtime.TEST_BACKUP_BUCKET,BACKUP_ENABLED:'true',OPERATIONS_ENVIRONMENT:'local',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),D1_DATABASE_ID:'11111111-1111-4111-8111-111111111111',CLOUDFLARE_ANALYTICS_TOKEN:'synthetic-test-only',D1_REST_API_TOKEN:'synthetic-export-only',BACKUP_BUCKET_NAME:'backup'};
function fetcher(storage=10):typeof fetch{return vi.fn(async(input,init)=>{
  const target=String(input);
  if(target.includes('/graphql')) return Response.json({errors:null,data:{viewer:{accounts:[{storage:[{max:{objectCount:8,payloadSize:storage,metadataSize:0},dimensions:{bucketName:'backup',datetime:at}}],operations:[{sum:{requests:12},dimensions:{actionType:'PutObject',bucketName:'backup'}}]}]}}});
  if(target.endsWith('/export')){const body=JSON.parse(String(init?.body));return Response.json({success:true,result:{at_bookmark:bookmark,status:'active',...(body.current_bookmark?{status:'complete',result:{signed_url:url,filename:'export.sql'}}:{})}});}
  if(target===url){expect(init?.headers).toBeUndefined();return new Response('CREATE TABLE synthetic(id text);\nINSERT INTO synthetic VALUES("합성");');}
  throw new Error('UNEXPECTED_NETWORK');
}) as typeof fetch;}
async function running(kind:'manual'|'weekly'|'deletion_manifest'='manual',date=at){const params={runId:crypto.randomUUID(),kind,requestedAt:date};await registerBackupRun(base,params);await base.DB.prepare("UPDATE backup_runs SET status='running' WHERE id=?").bind(params.runId).run();return params;}
beforeEach(async()=>{await db.delete(backupRuns);await db.delete(pricingCatalog);await db.delete(serviceUsageSnapshots);await db.delete(monthlyOperationsChecks);await db.delete(auditLogs);const list=await runtime.TEST_BACKUP_BUCKET.list();if(list.objects.length)await runtime.TEST_BACKUP_BUCKET.delete(list.objects.map(o=>o.key));});
afterEach(()=>vi.unstubAllGlobals());
describe('P8 backup storage and private gates',()=>{
  it('uses nested D1 API response, polls same bookmark and does not leak URLs into records',async()=>{
    const f=fetcher(),started=await exportPoll(base,undefined,f);expect(started).toEqual({bookmark,url:null});
    expect(await exportPoll(base,bookmark,f)).toEqual({bookmark,url});
    await expect(exportPoll({...base,BACKUP_ENABLED:'false'},undefined,f)).rejects.toThrow('BACKUP_NOT_CONNECTED');
    const bad=vi.fn(async()=>Response.json({success:true,result:{at_bookmark:'changed'}})) as typeof fetch;
    await expect(exportPoll(base,bookmark,bad)).rejects.toThrow('BACKUP_BOOKMARK_CHANGED');
  });
  it('accepts active export responses and keeps polling the original bookmark until completion',async()=>{
    const responses=[
      {success:true,result:{success:true,status:'active',at_bookmark:bookmark}},
      {success:true,result:{success:true,status:'active',at_bookmark:bookmark}},
      {success:true,result:{success:true,status:'complete',at_bookmark:bookmark,result:{signed_url:url,filename:'export.sql'}}},
    ];
    const poll=vi.fn(async()=>Response.json(responses.shift())) as unknown as typeof fetch;
    const started=await exportPoll(base,undefined,poll);
    expect(started).toEqual({bookmark,url:null});
    expect(await exportPoll(base,started.bookmark!,poll)).toEqual({bookmark,url:null});
    expect(await exportPoll(base,started.bookmark!,poll)).toEqual({bookmark,url});
    expect(vi.mocked(poll).mock.calls.map(([,init])=>JSON.parse(String(init?.body)))).toEqual([
      {output_format:'polling'},
      {output_format:'polling',current_bookmark:bookmark},
      {output_format:'polling',current_bookmark:bookmark},
    ]);
  });
  it('rejects export and download redirects without following them or marking a backup verified',async()=>{
    const redirect=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(init?.redirect).toBe('manual');
      return new Response(null,{status:302,headers:{Location:'https://untrusted.test.invalid/redirect'}});
    });
    await expect(exportPoll(base,undefined,redirect as typeof fetch)).rejects.toThrow('BACKUP_EXPORT_FAILED');
    expect(redirect).toHaveBeenCalledTimes(1);
    const params=await running();
    await expect(storeSqlBackup(base,params,url,bookmark,new Date(at),redirect as typeof fetch)).rejects.toThrow('BACKUP_DOWNLOAD_FAILED');
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(redirect.mock.calls.map(call=>String(call[0]))).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${base.CLOUDFLARE_ACCOUNT_ID}/d1/database/${base.D1_DATABASE_ID}/export`,url,
    ]);
    expect(redirect.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect((await runtime.TEST_BACKUP_BUCKET.list()).objects).toHaveLength(0);
    expect(await base.DB.prepare('SELECT status FROM backup_runs WHERE id=?').bind(params.runId).first()).toEqual({status:'running'});
  });
  it('stream-compresses and reads back the entire object before marking verified',async()=>{
    const params=await running(),result=await storeSqlBackup(base,params,url,bookmark,new Date(at),fetcher());
    const object=await runtime.TEST_BACKUP_BUCKET.get(`local/sql/${params.runId}.sql.gz`);expect(object).not.toBeNull();
    const original=await new Response(object!.body.pipeThrough(new DecompressionStream('gzip'))).text();expect(original).toContain('합성');
    const row=await base.DB.prepare('SELECT * FROM backup_runs WHERE id=?').bind(params.runId).first();expect(row?.status).toBe('verified');expect(result.sha256).toHaveLength(64);
    const publicList=await readBackups(base);expect(publicList.items[0]?.checksumPrefix).toHaveLength(12);expect(JSON.stringify(publicList)).not.toContain('local/sql/');expect(JSON.stringify(row)).not.toContain(url);
    expect((await measureStream(new Response(original).body!)).sizeBytes).toBe(new TextEncoder().encode(original).byteLength);
  });
  it('preserves all eight good copies when upload budget or verification fails',async()=>{
    for(let i=0;i<8;i++){const p=await running('weekly',new Date(Date.parse(at)+i*1000).toISOString());await storeSqlBackup(base,p,url,bookmark,new Date(p.requestedAt),fetcher());}
    const p=await running('manual','2026-10-01T00:01:00.000Z');await expect(storeSqlBackup(base,p,url,bookmark,new Date(at),fetcher(8_000_000_000))).rejects.toThrow('BACKUP_R2_BUDGET_PAUSED');
    await backupFailure(base,p,new Error('raw private error'));expect((await readBackups(base)).items.filter(r=>r.status==='verified')).toHaveLength(8);
    expect((await runtime.TEST_BACKUP_BUCKET.list({prefix:'local/sql/'})).objects).toHaveLength(8);
  });
  it('rotates SQL only after a ninth verified record and retains deletion evidence',async()=>{
    await runtime.TEST_BACKUP_BUCKET.put('local/deletions/latest.json','{"version":1,"entries":[],"generatedAt":"2026-10-01T00:00:00.000Z"}');
    for(let i=0;i<9;i++){const p=await running('weekly',new Date(Date.parse(at)+i*1000).toISOString());await storeSqlBackup(base,p,url,bookmark,new Date(p.requestedAt),fetcher());}
    expect(await rotateSqlBackups(base,new Date(at))).toEqual({rotated:1});expect((await runtime.TEST_BACKUP_BUCKET.list({prefix:'local/sql/'})).objects).toHaveLength(8);expect(await runtime.TEST_BACKUP_BUCKET.get('local/deletions/latest.json')).not.toBeNull();
  });
  it('serializes active exports and never replaces an existing request with a different kind',async()=>{
    const p=await running(),second=await registerBackupRun(base,{runId:crypto.randomUUID(),kind:'manual',requestedAt:at});
    await expect(base.DB.prepare("UPDATE backup_runs SET status='running' WHERE id=?").bind(second.runId).run()).rejects.toThrow();
    await expect(registerBackupRun(base,{...p,kind:'weekly'})).rejects.toThrow('BACKUP_REQUEST_CONFLICT');
  });
  it('keeps cumulative manifest when an older source DB no longer has the original deletion audit',async()=>{
    const entry={auditId:'old-delete',deletionSource:'self_service' as const,deletedAt:at,quizRevision:1,quizVariantId:'old-variant',submissionId:'old-submission'};
    const older={version:1 as const,generatedAt:at,entries:[entry]};await runtime.TEST_BACKUP_BUCKET.put('local/deletions/latest.json',JSON.stringify(older));
    const p=await running('deletion_manifest');await syncDeletionManifest(base,p,new Date(at),fetcher());
    const latest=await (await runtime.TEST_BACKUP_BUCKET.get('local/deletions/latest.json'))!.json();expect(latest).toMatchObject({entries:[entry]});
    expect(JSON.stringify(latest)).not.toContain('sessionHash');expect((await readBackups(base)).manifestUpdatedAt).toBe(at);
    const failed=await registerBackupRun(base,{runId:crypto.randomUUID(),kind:'deletion_manifest',requestedAt:'2026-10-01T00:10:00.000Z'});await backupFailure(base,failed,new Error('upstream private error'));
    const visible=await readBackups(base);expect(visible.items.find(i=>i.kind==='deletion_manifest')).toMatchObject({status:'failed',errorCode:'BACKUP_FAILED'});expect(visible.manifestUpdatedAt).toBe(at);
    expect(()=>mergeDeletionManifests(older,{...older,entries:[{...entry,quizRevision:2}]})).toThrow('DELETION_MANIFEST_CONFLICT');
  });
  it('does not upload or rotate when account usage is unavailable',async()=>{
    const f=vi.fn(async()=>Response.json({errors:[{message:'private detail'}],data:null})) as typeof fetch;
    await expect(budgetBeforeUpload(base,5,new Date(at),f)).rejects.toThrow('METRICS_UNAVAILABLE');expect((await runtime.TEST_BACKUP_BUCKET.list()).objects).toHaveLength(0);
  });
  it('runs the whole backup orchestration with no SQL or signed URL in step results',async()=>{
    vi.stubGlobal('fetch',fetcher());const p={runId:crypto.randomUUID(),kind:'manual' as const,requestedAt:at},results:unknown[]=[],options:unknown[]=[];
    const step={async do(_name:string,a:unknown,b?:()=>Promise<unknown>){if(b)options.push(a);const fn=b??a as ()=>Promise<unknown>;const result=await fn();results.push(result);return result;}} as unknown as WorkflowStep;
    const result=await runBackup(base,{payload:p} as WorkflowEvent<typeof p>,step);
    expect(result.status).toBe('verified');expect(JSON.stringify(results)).not.toContain(url);expect(JSON.stringify(results)).not.toContain('CREATE TABLE');expect(options).toContainEqual({retries:{limit:0,delay:'1 second'}});
  });
  it('disabled/unknown schedules make no database change or Workflow dispatch',async()=>{
    const controller={scheduledTime:Date.parse(at),cron:'* * * * *'} as ScheduledController;
    expect(await runScheduledFinalization(controller,{...base,OPERATIONS_CRON_ENABLED:'false'})).toEqual({outcome:'disabled'});
    expect(await runScheduledDraftCleanup({DB:base.DB,DRAFT_CLEANUP_ENABLED:'false'},at)).toEqual({outcome:'disabled'});
    expect(await scheduleBackup(controller,{...base,BACKUP_ENABLED:'false'})).toEqual({outcome:'disabled'});
    expect((await db.select().from(backupRuns))).toHaveLength(0);
  });
});

describe('P8 failure and Cron replay',()=>{
 it('refuses corrupt readback and preserves already verified status on rotation failure',async()=>{
   const p=await running(),bucket=new Proxy(runtime.TEST_BACKUP_BUCKET,{get(target,key){if(key==='get')return async(name:string)=>{const object=await target.get(name);if(!object)return object;return {...object,body:new Response('corrupt').body!,size:7};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
   await expect(storeSqlBackup({...base,BACKUP_BUCKET:bucket},p,url,bookmark,new Date(at),fetcher())).rejects.toThrow('BACKUP_VERIFY_FAILED');
   expect(await base.DB.prepare('SELECT status FROM backup_runs WHERE id=?').bind(p.runId).first()).toEqual({status:'running'});
   await storeSqlBackup(base,p,url,bookmark,new Date(at),fetcher());await backupFailure(base,p,new Error('private'));
   expect(await base.DB.prepare('SELECT status,error_code FROM backup_runs WHERE id=?').bind(p.runId).first()).toEqual({status:'verified',error_code:'BACKUP_FAILED'});
 });
 it('never marks an empty export as verified',async()=>{
   const f=fetcher(),empty=vi.fn(async(input,init)=>String(input)===url?new Response(''):f(input,init)) as typeof fetch,p=await running();
   await expect(storeSqlBackup(base,p,url,bookmark,new Date(at),empty)).rejects.toThrow('BACKUP_EMPTY');expect((await runtime.TEST_BACKUP_BUCKET.list()).objects).toHaveLength(0);
 });
 it('replays a lost manual dispatch with the same ID and does not start a second export',async()=>{
   const create=vi.fn(async()=>({id:'synthetic'})),get=vi.fn(async()=>({status:async()=>({status:'running'})}));
   const b={...base,BACKUP_WORKFLOW:{create,get} as unknown as Workflow<import('../_shared/services/backup-storage').BackupParams>};
   const command={requestKey:crypto.randomUUID(),kind:'manual',confirmation:'export_may_pause_database'};
   expect(await requestBackup(b,command,new Date(at))).toMatchObject({outcome:'started',runId:command.requestKey});
   expect(await requestBackup(b,command,new Date(at))).toMatchObject({outcome:'replayed',runId:command.requestKey});expect(create).toHaveBeenCalledTimes(1);
 });
 it('uses a deterministic weekly run ID and ignores unknown schedules',async()=>{
   const started=new Set<string>(),create=vi.fn(async({id}:{id:string})=>{started.add(id);return {id};}),get=vi.fn(async(id:string)=>{if(!started.has(id))throw new Error('missing');return {status:async()=>({status:'running'})};});
   const b={...base,BACKUP_WORKFLOW:{create,get} as unknown as Workflow<import('../_shared/services/backup-storage').BackupParams>};
   const controller={scheduledTime:Date.parse(at),cron:'0 19 * * SUN'} as ScheduledController;
   expect(await scheduleBackup(controller,b)).toEqual(await scheduleBackup(controller,b));expect(create).toHaveBeenCalledTimes(1);
   expect(await scheduleBackup({...controller,cron:'unknown'},b)).toEqual({outcome:'ignored'});
   expect(await base.DB.prepare('SELECT kind FROM backup_runs').first()).toEqual({kind:'weekly'});
 });
});
