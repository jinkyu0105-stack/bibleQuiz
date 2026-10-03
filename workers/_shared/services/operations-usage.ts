import { z } from "zod";
import { metricSchema,operationsUsageSchema,monthlyCheckSchema,type usageItemSchema } from "../../../shared/api/admin-operations";
import { pricingVersion,serviceRegistry,type ServiceId } from "../../../src/config/service-registry";
export interface UsageBindings { DB:D1Database; CLOUDFLARE_ACCOUNT_ID?:string; CLOUDFLARE_ANALYTICS_TOKEN?:string; D1_DATABASE_ID?:string; BACKUP_BUCKET_NAME?:string; OPERATIONS_ENVIRONMENT?:string; CF_VERSION_METADATA?:{id:string;tag:string;timestamp:string}; }
export class OperationsError extends Error { constructor(readonly code:string){super(code);} }
export const seoulMonth=(now:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit"}).format(now);
export async function ensurePricing(db:D1Database){
  for(const service of serviceRegistry) await db.prepare(`INSERT INTO pricing_catalog(service,plan_name,free_limits_json,official_source_url,pricing_version,pricing_checked_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(service) DO NOTHING`)
    .bind(service.id,service.planAndCostType,JSON.stringify(service.freeLimits),service.officialDocsUrl,pricingVersion,service.pricingCheckedAt,service.pricingCheckedAt).run();
}
export function usageStatus(metrics:z.infer<typeof metricSchema>,limits:Record<string,number>,fetchedAt:string|null,errorCode:string|null,now:Date):"comfortable"|"check"|"warning"|"delayed" {
  if(!fetchedAt||errorCode||now.getTime()-Date.parse(fetchedAt)>86_400_000||!Number.isFinite(Date.parse(fetchedAt))||Date.parse(fetchedAt)>now.getTime()) return "delayed";
  if(metrics.buildLimitReached===1) return "warning";
  if(metrics.unknownCalls && metrics.unknownCalls>0) return "delayed";
  const values=Object.entries(limits).map(([key,limit])=>metrics[key as keyof typeof metrics]===undefined||metrics[key as keyof typeof metrics]===null?null:metrics[key as keyof typeof metrics]!/limit);
  if(values.some(v=>v!==null&&v>=.8)) return "warning";
  if(values.some(v=>v===null)) return "delayed";
  if(values.some(v=>v!==null&&v>=.5)||(metrics.costMicroUsd??0)>0) return "check";
  return Object.keys(metrics).length===0 ? "delayed" : "comfortable";
}
type UsageItem=z.infer<typeof usageItemSchema>;
function period(now:Date,monthly:boolean){
  const day=now.toISOString().slice(0,10);
  return monthly?{start:`${day.slice(0,7)}-01T00:00:00.000Z`,end:now.toISOString()}:{start:`${day}T00:00:00.000Z`,end:now.toISOString()};
}
async function graph(env:UsageBindings,body:string,variables:Record<string,string>,fetcher:typeof fetch){
  if(!env.CLOUDFLARE_ANALYTICS_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID||!/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new OperationsError("METRICS_NOT_CONNECTED");
  const response=await fetcher("https://api.cloudflare.com/client/v4/graphql",{method:"POST",redirect:"manual",signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({query:body,variables:{account:env.CLOUDFLARE_ACCOUNT_ID,...variables}})});
  if(!response.ok) throw new OperationsError("METRICS_FETCH_FAILED");
  const parsed=z.object({errors:z.array(z.unknown()).nullish(),data:z.object({viewer:z.object({accounts:z.array(z.record(z.string(),z.unknown()))})}).nullish()}).parse(await response.json());
  if(parsed.errors?.length||parsed.data?.viewer.accounts.length!==1) throw new OperationsError("METRICS_UNAVAILABLE");
  return parsed.data.viewer.accounts[0]!;
}
const num=z.number().finite().nonnegative();
const r2StorageRow=z.object({max:z.object({objectCount:num,payloadSize:num,metadataSize:num}),dimensions:z.object({bucketName:z.string(),datetime:z.iso.datetime()})});
const r2OpsRow=z.object({sum:z.object({requests:num}),dimensions:z.object({actionType:z.string(),bucketName:z.string()})});
export async function fetchR2Usage(env:UsageBindings,now:Date,fetcher:typeof fetch=fetch,rolling=false){
  const {start:monthStart,end}=period(now,true);
  const start=rolling?new Date(now.getTime()-31*86_400_000).toISOString():monthStart;
  const storageStart=new Date(now.getTime()-86_400_000).toISOString();
  const data=await graph(env,`query($account:string!,$start:Time!,$end:Time!,$storageStart:Time!){viewer{accounts(filter:{accountTag:$account}){
    storage:r2StorageAdaptiveGroups(limit:10000,filter:{datetime_geq:$storageStart,datetime_leq:$end},orderBy:[datetime_DESC]){max{objectCount payloadSize metadataSize} dimensions{bucketName datetime}}
    operations:r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:$start,datetime_leq:$end}){sum{requests} dimensions{actionType bucketName}}
  }}}`,{start,end,storageStart},fetcher);
  const storage=z.array(r2StorageRow).parse(data.storage),operations=z.array(r2OpsRow).parse(data.operations);
  if(!storage.length||storage.length>=10000||operations.length>=10000) throw new OperationsError("METRICS_INCOMPLETE");
  const latest=new Map<string,z.infer<typeof r2StorageRow>>();
  for(const row of storage) if(!latest.has(row.dimensions.bucketName)) latest.set(row.dimensions.bucketName,row);
  const classA=new Set(["ListBuckets","PutBucket","ListObjects","PutObject","CopyObject","CompleteMultipartUpload","CreateMultipartUpload","LifecycleStorageTierTransition","CreateMultipartUploadPart","UploadPart","UploadPartCopy","ListParts","PutBucketEncryption","PutBucketCors","PutBucketLifecycleConfiguration"]);
  const classB=new Set(["HeadBucket","HeadObject","GetObject","UsageSummary","GetBucketEncryption","GetBucketCors","GetBucketLifecycleConfiguration"]);
  const free=new Set(["DeleteObject","DeleteBucket","AbortMultipartUpload"]);
  if(operations.some(r=>!classA.has(r.dimensions.actionType)&&!classB.has(r.dimensions.actionType)&&!free.has(r.dimensions.actionType))) throw new OperationsError("R2_OPERATIONS_UNCLASSIFIED");
  function totals(bucket?:string){
    const rows=[...latest.values()].filter(r=>!bucket||r.dimensions.bucketName===bucket);
    if(!rows.length) throw new OperationsError("METRICS_INCOMPLETE");
    const ops=operations.filter(r=>!bucket||r.dimensions.bucketName===bucket);
    return {storageBytes:rows.reduce((v,r)=>v+r.max.payloadSize+r.max.metadataSize,0),objectCount:rows.reduce((v,r)=>v+r.max.objectCount,0),
      classA:ops.filter(r=>classA.has(r.dimensions.actionType)).reduce((v,r)=>v+r.sum.requests,0),classB:ops.filter(r=>classB.has(r.dimensions.actionType)).reduce((v,r)=>v+r.sum.requests,0)};
  }
  return {account:totals(),bucket:env.BACKUP_BUCKET_NAME?totals(env.BACKUP_BUCKET_NAME):null,periodStart:start,periodEnd:end};
}
async function accountApi(env:UsageBindings,path:string,fetcher:typeof fetch){
  if(!env.CLOUDFLARE_ANALYTICS_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID||!/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ACCOUNT_ID))throw new OperationsError("METRICS_NOT_CONNECTED");
  const res=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/${path}`,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`}});
  if(!res.ok)throw new OperationsError("METRICS_FETCH_FAILED");
  return z.object({success:z.literal(true),result:z.unknown(),result_info:z.object({page:num.optional(),total_pages:num.optional(),total_count:num.optional()}).optional()}).parse(await res.json());
}
async function collectCloudflare(env:UsageBindings,service:ServiceId,now:Date,fetcher:typeof fetch):Promise<Array<{scope:"account"|"project"|"bucket"|"database";scopeId:string;metrics:z.infer<typeof metricSchema>}>> {
  if(service==="r2") {const data=await fetchR2Usage(env,now,fetcher);return [{scope:"account",scopeId:"account",metrics:data.account},...(data.bucket?[{scope:"bucket" as const,scopeId:"backup",metrics:data.bucket}]:[])];}
  const {start,end}=period(now,false);
  if(service==="d1"){
    const data=await graph(env,`query($account:string!,$start:Date!,$end:Date!){viewer{accounts(filter:{accountTag:$account}){
      reads:d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end}){sum{rowsRead rowsWritten} dimensions{databaseId}}
      storage:d1StorageAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end}){max{databaseSizeBytes} dimensions{databaseId}}
    }}}`,{start:start.slice(0,10),end:end.slice(0,10)},fetcher);
    const rows=z.array(z.object({sum:z.object({rowsRead:num,rowsWritten:num}),dimensions:z.object({databaseId:z.string()})})).parse(data.reads);
    const storage=z.array(z.object({max:z.object({databaseSizeBytes:num}),dimensions:z.object({databaseId:z.string()})})).parse(data.storage);
    if(!storage.length||rows.length>=10000||storage.length>=10000) throw new OperationsError("METRICS_INCOMPLETE");
    const metrics=(id?:string)=>({rowsRead:rows.filter(r=>!id||r.dimensions.databaseId===id).reduce((a,r)=>a+r.sum.rowsRead,0),rowsWritten:rows.filter(r=>!id||r.dimensions.databaseId===id).reduce((a,r)=>a+r.sum.rowsWritten,0),storageBytes:storage.filter(r=>!id||r.dimensions.databaseId===id).reduce((a,r)=>a+r.max.databaseSizeBytes,0)});
    return [{scope:"account",scopeId:"account",metrics:metrics()},...(env.D1_DATABASE_ID?[{scope:"database" as const,scopeId:"database",metrics:metrics(env.D1_DATABASE_ID)}]:[])];
  }
  if(service==="workers"){
    const data=await graph(env,`query($account:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$account}){calls:workersInvocationsAdaptive(limit:10000,filter:{datetime_geq:$start,datetime_leq:$end}){sum{requests errors} dimensions{scriptName status}}}}}`,{start,end},fetcher);
    const rows=z.array(z.object({sum:z.object({requests:num,errors:num}),dimensions:z.object({scriptName:z.string(),status:z.string()})})).parse(data.calls);
    if(!rows.length||rows.length>=10000) throw new OperationsError("METRICS_INCOMPLETE");
    const metrics=(name?:string)=>({requests:rows.filter(r=>!name||r.dimensions.scriptName===name).reduce((a,r)=>a+r.sum.requests,0),resourceErrors:rows.filter(r=>(!name||r.dimensions.scriptName===name)&&r.dimensions.status==="exceededResources").reduce((a,r)=>a+r.sum.errors,0),cpuMs:null});
    return [{scope:"account",scopeId:"account",metrics:metrics()},...["app","content","backup"].map(role=>({scope:"project" as const,scopeId:role,metrics:metrics(`biblequiz-${role}${env.OPERATIONS_ENVIRONMENT==="preview"?"-preview":""}`)}))];
  }
  if(service==="workflows"){
    const data=await graph(env,`query($account:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$account}){events:workflowsAdaptiveGroups(limit:10000,filter:{datetimeHour_geq:$start,datetimeHour_leq:$end}){count dimensions{workflowName eventType}}}}}`,{start,end},fetcher);
    const rows=z.array(z.object({count:num,dimensions:z.object({workflowName:z.string(),eventType:z.string()})})).parse(data.events);
    if(!rows.length||rows.length>=10000)throw new OperationsError("METRICS_INCOMPLETE");
    const count=(type:string)=>rows.filter(r=>r.dimensions.eventType===type).reduce((a,r)=>a+r.count,0);
    return [{scope:"account",scopeId:"account",metrics:{instances:count("WORKFLOW_START"),steps:count("STEP_SUCCESS"),failures:count("WORKFLOW_FAILURE"),retries:count("ATTEMPT_START"),storageBytes:null}}];
  }
  if(service==="durable_objects"){
    const data=await graph(env,`query($account:string!,$start:Date!,$end:Date!){viewer{accounts(filter:{accountTag:$account}){calls:durableObjectsInvocationsAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end}){sum{requests}}}}}`,{start:start.slice(0,10),end:end.slice(0,10)},fetcher);
    const rows=z.array(z.object({sum:z.object({requests:num})})).parse(data.calls);
    if(!rows.length||rows.length>=10000)throw new OperationsError("METRICS_INCOMPLETE");
    return [{scope:"account",scopeId:"account",metrics:{requests:rows.reduce((a,r)=>a+r.sum.requests,0),durationGbSeconds:null}}];
  }
  if(service==="workers_builds"){
    // Official limits API supplies exhaustion, not numerical minutes used.
    const data=await accountApi(env,"builds/account/limits",fetcher);
    const result=z.object({has_reached_build_minutes_limit:z.boolean()}).parse(data.result);
    return [{scope:"account",scopeId:"account",metrics:{buildMinutes:null,buildLimitReached:result.has_reached_build_minutes_limit?1:0}}];
  }
  if(service==="access"){
    const seats=new Set<string>();let page=1,totalPages=1,totalCount=0,read=0;
    do{
      const data=await accountApi(env,`access/users?per_page=100&page=${page}`,fetcher);
      const users=z.array(z.object({id:z.string().min(1),access_seat:z.boolean(),gateway_seat:z.boolean(),seat_uid:z.string().min(1).optional()})).parse(data.result);
      if(!data.result_info?.total_pages||data.result_info.page!==page||data.result_info.total_count===undefined)throw new OperationsError("METRICS_INCOMPLETE");
      if(page===1){totalPages=data.result_info.total_pages;totalCount=data.result_info.total_count;}
      if(data.result_info.total_pages!==totalPages||data.result_info.total_count!==totalCount)throw new OperationsError("METRICS_INCOMPLETE");
      read+=users.length;for(const user of users)if(user.access_seat||user.gateway_seat)seats.add(user.seat_uid??user.id);
      page++;
    }while(page<=totalPages);
    if(read!==totalCount)throw new OperationsError("METRICS_INCOMPLETE");
    return [{scope:"account",scopeId:"account",metrics:{activeSeats:seats.size}}];
  }
  // These datasets/permissions must be verified on the target account. Never
  // infer seats, GB-s or daily Workflow steps from app events or empty results.
  throw new OperationsError("METRICS_NOT_CONNECTED");
}
async function aiSummary(db:D1Database,now:Date){
  const month=seoulMonth(now),start=new Date(`${month}-01T00:00:00+09:00`).toISOString();
  const rows=await db.prepare(`SELECT c.model,COUNT(*) calls,
    SUM(COALESCE(CASE WHEN u.call_id IS NOT NULL THEN u.input_tokens ELSE old.input_tokens END,0)) inputTokens,SUM(COALESCE(CASE WHEN u.call_id IS NOT NULL THEN u.output_tokens ELSE old.output_tokens END,0)) outputTokens,SUM(COALESCE(CASE WHEN u.call_id IS NOT NULL THEN u.audio_seconds ELSE old.audio_seconds END,0)) audioSeconds,
    SUM(COALESCE(CASE WHEN u.call_id IS NOT NULL THEN u.estimated_cost_micro_usd ELSE old.estimated_cost_micro_usd END,0)) costMicroUsd,
    SUM(CASE WHEN (CASE WHEN u.call_id IS NOT NULL THEN u.estimated_cost_micro_usd ELSE old.estimated_cost_micro_usd END) IS NULL THEN 1 ELSE 0 END) unknownCalls
    FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id
    WHERE c.started_at>=? AND c.started_at<=? GROUP BY c.model ORDER BY c.model`).bind(start,now.toISOString()).all();
  const models=operationsUsageSchema.shape.openAiModels.parse(rows.results);
  return {models,start,metrics:{costMicroUsd:models.reduce((a,r)=>a+r.costMicroUsd,0),unknownCalls:models.reduce((a,r)=>a+r.unknownCalls,0),inputTokens:models.reduce((a,r)=>a+r.inputTokens,0),outputTokens:models.reduce((a,r)=>a+r.outputTokens,0),audioSeconds:models.reduce((a,r)=>a+r.audioSeconds,0)}};
}
export async function refreshOperationsUsage(env:UsageBindings,now=new Date(),fetcher:typeof fetch=fetch){
  const cached=await env.DB.prepare("SELECT MIN(fetched_at) at,COUNT(DISTINCT service) n FROM (SELECT service,MAX(fetched_at) fetched_at FROM service_usage_snapshots GROUP BY service)").first<{at:string|null;n:number}>();
  if(cached?.n===serviceRegistry.length-1&&cached.at&&now.getTime()-Date.parse(cached.at)<300_000&&Date.parse(cached.at)<=now.getTime()) return readOperationsUsage(env,now);
  await ensurePricing(env.DB);
  const lease=crypto.randomUUID(),leaseUntil=new Date(now.getTime()+300_000).toISOString();
  const got=await env.DB.prepare("UPDATE pricing_catalog SET refresh_lease_id=?,refresh_lease_until=? WHERE service='workers' AND (refresh_lease_until IS NULL OR refresh_lease_until<?)").bind(lease,leaseUntil,now.toISOString()).run();
  if(got.meta.changes!==1) throw new OperationsError("METRICS_REFRESH_BUSY");
  try{
    for(const service of serviceRegistry){
      if(service.id==="openai") continue;
      const {start,end}=period(now,service.id==="r2"||service.id==="workers_builds");
      try{
        const records=await collectCloudflare(env,service.id,now,fetcher);
        for(const record of records) await env.DB.prepare(`INSERT INTO service_usage_snapshots(id,service,scope,scope_id,period_start,period_end,metrics_json,source,fetched_at,error_code)
          VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(service,scope,scope_id,period_start,period_end) DO UPDATE SET metrics_json=excluded.metrics_json,fetched_at=excluded.fetched_at,error_code=NULL`)
          .bind(crypto.randomUUID(),service.id,record.scope,record.scopeId,start,end,JSON.stringify(metricSchema.parse(record.metrics)),["access","workers_builds"].includes(service.id)?"provider_api":"cloudflare_graphql",now.toISOString()).run();
      }catch(error){
        const code=error instanceof OperationsError?error.code:"METRICS_UNAVAILABLE";
        await env.DB.prepare(`INSERT INTO service_usage_snapshots(id,service,scope,scope_id,period_start,period_end,metrics_json,source,fetched_at,error_code)
          VALUES(?,?,'account','account',?,?,'{}',?, ?,?) ON CONFLICT(service,scope,scope_id,period_start,period_end) DO UPDATE SET error_code=excluded.error_code,fetched_at=excluded.fetched_at`)
          .bind(crypto.randomUUID(),service.id,start,end,["r2","d1","workers","workflows","durable_objects"].includes(service.id)?"cloudflare_graphql":["access","workers_builds"].includes(service.id)?"provider_api":"configured",now.toISOString(),code).run();
      }
    }
    // Snapshot trend cache only; original AI cost ledgers are never deleted.
    await env.DB.prepare("DELETE FROM service_usage_snapshots WHERE fetched_at<?").bind(new Date(now.getTime()-31*86_400_000).toISOString()).run();
  }finally{await env.DB.prepare("UPDATE pricing_catalog SET refresh_lease_id=NULL,refresh_lease_until=NULL WHERE service='workers' AND refresh_lease_id=?").bind(lease).run();}
  return readOperationsUsage(env,now);
}
export async function readOperationsUsage(env:UsageBindings,now=new Date()){
  const rows=await env.DB.prepare("SELECT service,scope,scope_id scopeId,period_start periodStart,period_end periodEnd,metrics_json metricsJson,source,fetched_at fetchedAt,error_code errorCode FROM service_usage_snapshots ORDER BY fetched_at DESC,period_end DESC").all<Record<string,unknown>>();
  const seen=new Set<string>(),items:UsageItem[]=[];
  for(const service of serviceRegistry){
    const matching=rows.results.filter(r=>r.service===service.id);
    for(const row of matching){const key=`${service.id}/${row.scope}/${row.scopeId}`;if(seen.has(key))continue;seen.add(key);
      const accountFailure=matching.find(r=>r.scope==='account'&&r.scopeId==='account');
      const failed=accountFailure?.errorCode&&String(accountFailure.fetchedAt)>=String(row.fetchedAt)?String(accountFailure.errorCode):null;
      const metrics=metricSchema.parse(JSON.parse(String(row.metricsJson))),fetchedAt=String(row.fetchedAt),errorCode=failed??(row.errorCode===null?null:String(row.errorCode));
      const {start}=period(now,service.id==="r2"||service.id==="workers_builds");
      items.push({service:service.id,scope:row.scope as UsageItem["scope"],scopeId:String(row.scopeId),periodStart:String(row.periodStart),periodEnd:String(row.periodEnd),fetchedAt,source:row.source as UsageItem["source"],metrics,errorCode,status:usageStatus(metrics,service.freeLimits,fetchedAt,row.periodStart!==start?"METRIC_PERIOD_EXPIRED":errorCode,now)});
    }
    if(!matching.length&&service.id!=="openai") {const {start,end}=period(now,service.id==="r2"||service.id==="workers_builds");items.push({service:service.id,scope:"account",scopeId:"account",periodStart:start,periodEnd:end,metrics:{},fetchedAt:null,source:"configured",errorCode:"METRICS_NOT_CONNECTED",status:"delayed"});}
  }
  const ai=await aiSummary(env.DB,now);items.push({service:"openai",scope:"project",scopeId:"app-events",periodStart:ai.start,periodEnd:now.toISOString(),metrics:ai.metrics,fetchedAt:now.toISOString(),source:"app_events",errorCode:null,status:usageStatus(ai.metrics,{},now.toISOString(),null,now)});
  const yearMonth=seoulMonth(now),checked=await env.DB.prepare("SELECT checked_at checkedAt,pricing_versions_json versions FROM monthly_operations_checks WHERE year_month=?").bind(yearMonth).first<{checkedAt:string;versions:string}>();
  const policyCheckNeeded=!checked||serviceRegistry.some(s=>JSON.parse(checked.versions)[s.id]!==pricingVersion);
  return operationsUsageSchema.parse({items,yearMonth,policyCheckNeeded,checkedAt:checked?.checkedAt??null,pricingVersion,openAiModels:ai.models});
}
export async function confirmOperationsMonth(env:UsageBindings,raw:unknown,email:string,now=new Date()){
  const command=monthlyCheckSchema.parse(raw),ids=serviceRegistry.map(s=>s.id);
  if(command.yearMonth!==seoulMonth(now)||command.pricingVersion!==pricingVersion||command.checkedServices.length!==ids.length||ids.some(id=>!command.checkedServices.includes(id))) throw new OperationsError("POLICY_CHECK_CONFLICT");
  await ensurePricing(env.DB);
  const catalog=await env.DB.prepare("SELECT service,pricing_version version FROM pricing_catalog").all<{service:string;version:string}>();
  if(catalog.results.length!==ids.length||catalog.results.some(row=>row.version!==pricingVersion)) throw new OperationsError("POLICY_CHECK_CONFLICT");
  await env.DB.prepare(`INSERT INTO monthly_operations_checks(year_month,pricing_versions_json,checked_services_json,checked_by,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(year_month) DO UPDATE SET pricing_versions_json=excluded.pricing_versions_json,checked_services_json=excluded.checked_services_json,checked_by=excluded.checked_by,checked_at=excluded.checked_at`)
    .bind(command.yearMonth,JSON.stringify(Object.fromEntries(ids.map(id=>[id,pricingVersion]))),JSON.stringify(ids),email,now.toISOString()).run();
  return readOperationsUsage(env,now);
}
