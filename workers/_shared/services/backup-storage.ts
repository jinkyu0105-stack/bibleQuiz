import { z } from "zod";
import { backupParamsSchema,backupListSchema,backupRequestSchema,backupAcceptedSchema } from "../../../shared/api/admin-operations";
import { createDatabase } from "../db/client";
import { createSubmissionDeletionRetentionService,submissionDeletionManifestSchema,type SubmissionDeletionManifest } from "./submission-deletion-retention";
import { fetchR2Usage,OperationsError,type UsageBindings } from "./operations-usage";
export interface BackupBindings extends UsageBindings {
  BACKUP_ENABLED?:string; BACKUP_BUCKET?:R2Bucket; BACKUP_WORKFLOW?:Workflow<BackupParams>;
  D1_REST_API_TOKEN?:string;
}
export type BackupParams=z.infer<typeof backupParamsSchema>;
export class BackupError extends Error{constructor(readonly code:string){super(code);} }
const envName=(env:BackupBindings)=>{const parsed=z.enum(["local","preview","production"]).safeParse(env.OPERATIONS_ENVIRONMENT);if(!parsed.success)throw new BackupError("BACKUP_NOT_CONNECTED");return parsed.data;};
export async function measureStream(stream:ReadableStream<Uint8Array>){
  let size=0;
  const digest=new crypto.DigestStream("SHA-256");
  const [,hash]=await Promise.all([stream.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,c){size+=chunk.byteLength;c.enqueue(chunk);}})).pipeTo(digest),digest.digest]);
  return {sizeBytes:size,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")};
}
async function compressed(fetcher:typeof fetch,url:string){
  const response=await fetcher(url,{redirect:"manual",signal:AbortSignal.timeout(60_000)});
  if(!response.ok||!response.body) throw new BackupError("BACKUP_DOWNLOAD_FAILED");
  let rawSize=0;
  return response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,c){rawSize+=chunk.byteLength;c.enqueue(chunk);},flush(){if(rawSize===0)throw new BackupError("BACKUP_EMPTY");}})).pipeThrough(new CompressionStream("gzip"));
}
export async function budgetBeforeUpload(env:BackupBindings,sizeBytes:number,now:Date,fetcher:typeof fetch=fetch){
  const usage=await fetchR2Usage(env,now,fetcher,true);
  // Account totals, including temporary new object before rotation. Observed
  // operations are a conservative ceiling check, not a billing hard cap.
  if(usage.account.storageBytes+sizeBytes>8_000_000_000||usage.account.classA+4>800_000||usage.account.classB+5>8_000_000) throw new BackupError("BACKUP_R2_BUDGET_PAUSED");
  return usage;
}
export async function exportPoll(env:BackupBindings,bookmark?:string,fetcher:typeof fetch=fetch){
  if(env.BACKUP_ENABLED!=="true"||!env.D1_REST_API_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID||!env.D1_DATABASE_ID||!/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ACCOUNT_ID)||!z.uuid().safeParse(env.D1_DATABASE_ID).success||env.D1_DATABASE_ID.startsWith("00000000-")) throw new BackupError("BACKUP_NOT_CONNECTED");
  const res=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}/export`,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${env.D1_REST_API_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({output_format:"polling",...(bookmark?{current_bookmark:bookmark}:{})})});
  if(!res.ok) throw new BackupError("BACKUP_EXPORT_FAILED");
  const data=z.object({success:z.literal(true),result:z.object({at_bookmark:z.string().min(1).optional(),status:z.enum(["active","complete","error"]).optional(),result:z.object({signed_url:z.url(),filename:z.string()}).optional()})}).parse(await res.json());
  if(data.result.status==="error") throw new BackupError("BACKUP_EXPORT_FAILED");
  if(data.result.at_bookmark&&bookmark&&data.result.at_bookmark!==bookmark) throw new BackupError("BACKUP_BOOKMARK_CHANGED");
  if(data.result.status==="complete"){
    if(!data.result.result) throw new BackupError("BACKUP_EXPORT_FAILED");
    const url=new URL(data.result.result.signed_url);
    // Trust the URL from the authenticated Cloudflare export response only;
    // never forward the API Authorization header to this separate download.
    if(url.protocol!=="https:"||url.username||url.password) throw new BackupError("BACKUP_DOWNLOAD_HOST_INVALID");
    return {bookmark:bookmark??data.result.at_bookmark??null,url:url.toString()};
  }
  return {bookmark:data.result.at_bookmark??bookmark??null,url:null};
}
export async function storeSqlBackup(env:BackupBindings,params:BackupParams,url:string,bookmark:string,now=new Date(),fetcher:typeof fetch=fetch){
  if(!env.BACKUP_BUCKET) throw new BackupError("BACKUP_NOT_CONNECTED");
  const key=`${envName(env)}/sql/${params.runId}.sql.gz`;
  const measured=await measureStream(await compressed(fetcher,url));
  if(measured.sizeBytes<=0) throw new BackupError("BACKUP_EMPTY");
  await budgetBeforeUpload(env,measured.sizeBytes,now,fetcher);
  const existing=await env.BACKUP_BUCKET.get(key);
  if(existing){const actual=await measureStream(existing.body);if(actual.sha256!==measured.sha256||actual.sizeBytes!==measured.sizeBytes) throw new BackupError("BACKUP_OBJECT_CONFLICT");}
  else {
    const fixed=new FixedLengthStream(measured.sizeBytes);
    const pump=(await compressed(fetcher,url)).pipeTo(fixed.writable);
    await Promise.all([pump,Promise.resolve().then(()=>env.BACKUP_BUCKET!.put(key,fixed.readable,{httpMetadata:{contentType:"application/gzip"},sha256:measured.sha256}))]);
  }
  const saved=await env.BACKUP_BUCKET.get(key);
  if(!saved) throw new BackupError("BACKUP_VERIFY_FAILED");
  const actual=await measureStream(saved.body);
  if(actual.sha256!==measured.sha256||actual.sizeBytes!==measured.sizeBytes||saved.size!==actual.sizeBytes) throw new BackupError("BACKUP_VERIFY_FAILED");
  await env.DB.prepare(`UPDATE backup_runs SET r2_object_key=?,size_bytes=?,sha256=?,source_d1_bookmark=?,status='verified',completed_at=?,error_code=NULL WHERE id=? AND status='running'`)
    .bind(key,actual.sizeBytes,actual.sha256,bookmark,now.toISOString(),params.runId).run();
  const row=await env.DB.prepare("SELECT status,sha256 FROM backup_runs WHERE id=?").bind(params.runId).first<{status:string;sha256:string}>();
  if(row?.status!=="verified"||row.sha256!==actual.sha256) throw new BackupError("BACKUP_RECORD_FAILED");
  return {sizeBytes:actual.sizeBytes,sha256:actual.sha256};
}
export function mergeDeletionManifests(older:SubmissionDeletionManifest,newer:SubmissionDeletionManifest):SubmissionDeletionManifest{
  const entries=new Map(older.entries.map(e=>[e.submissionId,e]));
  for(const entry of newer.entries){const old=entries.get(entry.submissionId);if(old&&JSON.stringify(old)!==JSON.stringify(entry))throw new BackupError("DELETION_MANIFEST_CONFLICT");entries.set(entry.submissionId,entry);}
  return submissionDeletionManifestSchema.parse({version:1,generatedAt:newer.generatedAt,entries:[...entries.values()].sort((a,b)=>a.auditId.localeCompare(b.auditId))});
}
export async function syncDeletionManifest(env:BackupBindings,params:BackupParams,now=new Date(),fetcher:typeof fetch=fetch){
  if(!env.BACKUP_BUCKET) throw new BackupError("BACKUP_NOT_CONNECTED");
  const key=`${envName(env)}/deletions/latest.json`,prior=await env.BACKUP_BUCKET.get(key);
  const fresh=await createSubmissionDeletionRetentionService(createDatabase(env.DB)).buildManifest(now.toISOString());
  const manifest=prior?mergeDeletionManifests(submissionDeletionManifestSchema.parse(await prior.json()),fresh):fresh;
  const content=JSON.stringify(manifest),bytes=new TextEncoder().encode(content);
  await budgetBeforeUpload(env,bytes.byteLength,now,fetcher);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  const immutable=`${envName(env)}/deletions/${params.runId}.json`;
  await env.BACKUP_BUCKET.put(immutable,bytes,{sha256:hash,httpMetadata:{contentType:"application/json"}});
  const object=await env.BACKUP_BUCKET.get(immutable);
  if(!object)throw new BackupError("DELETION_MANIFEST_VERIFY_FAILED");
  const verified=await measureStream(object.body);
  if(verified.sha256!==hash||verified.sizeBytes!==bytes.byteLength||object.size!==bytes.byteLength)throw new BackupError("DELETION_MANIFEST_VERIFY_FAILED");
  await env.BACKUP_BUCKET.put(key,bytes,{sha256:hash,httpMetadata:{contentType:"application/json"}});
  const latest=await env.BACKUP_BUCKET.get(key);
  if(!latest)throw new BackupError("DELETION_MANIFEST_VERIFY_FAILED");
  const latestVerified=await measureStream(latest.body);
  if(latestVerified.sha256!==hash||latestVerified.sizeBytes!==bytes.byteLength||latest.size!==bytes.byteLength)throw new BackupError("DELETION_MANIFEST_VERIFY_FAILED");
  // Latest pointer does not replace old deletion evidence; retain cumulative
  // current manifest independently of SQL's eight-object rotation.
  if(params.kind==="deletion_manifest") await env.DB.prepare(`UPDATE backup_runs SET status='verified',r2_object_key=?,size_bytes=?,sha256=?,completed_at=?,error_code=NULL WHERE id=? AND status='running'`)
    .bind(immutable,bytes.byteLength,hash,now.toISOString(),params.runId).run();
  const previous=await env.DB.prepare("SELECT id,r2_object_key objectKey FROM backup_runs WHERE environment=? AND kind='deletion_manifest' AND status='verified' AND id!=? AND started_at<?").bind(envName(env),params.runId,params.requestedAt).all<{id:string;objectKey:string}>();
  for(const row of previous.results){
    if(!row.objectKey.startsWith(`${envName(env)}/deletions/`)||row.objectKey===key) throw new BackupError("BACKUP_ROTATION_TARGET_INVALID");
    await env.BACKUP_BUCKET.delete(row.objectKey);
    await env.DB.prepare("UPDATE backup_runs SET status='rotated',rotated_at=? WHERE id=?").bind(now.toISOString(),row.id).run();
  }
  return {entries:manifest.entries.length,generatedAt:manifest.generatedAt};
}
export async function rotateSqlBackups(env:BackupBindings,now=new Date()){
  if(!env.BACKUP_BUCKET) throw new BackupError("BACKUP_NOT_CONNECTED");
  const excess=await env.DB.prepare(`SELECT id,r2_object_key objectKey FROM backup_runs WHERE environment=? AND status='verified' AND kind='weekly' ORDER BY completed_at DESC,id DESC LIMIT -1 OFFSET 8`).bind(envName(env)).all<{id:string;objectKey:string}>();
  for(const row of excess.results){
    if(!row.objectKey.startsWith(`${envName(env)}/sql/`)) throw new BackupError("BACKUP_ROTATION_TARGET_INVALID");
    await env.BACKUP_BUCKET.delete(row.objectKey);
    await env.BACKUP_BUCKET.delete(`${envName(env)}/deletions/${row.id}.json`);
    await env.DB.prepare("UPDATE backup_runs SET status='rotated',rotated_at=? WHERE id=? AND status='verified'").bind(now.toISOString(),row.id).run();
  }
  return {rotated:excess.results.length};
}
export async function registerBackupRun(env:BackupBindings,raw:unknown){
  const params=backupParamsSchema.parse(raw),environment=envName(env);
  await env.DB.prepare(`INSERT INTO backup_runs(id,environment,kind,status,started_at) VALUES(?,?,?,'queued',?) ON CONFLICT(id) DO NOTHING`).bind(params.runId,environment,params.kind,params.requestedAt).run();
  const row=await env.DB.prepare("SELECT environment,kind,status,started_at startedAt FROM backup_runs WHERE id=?").bind(params.runId).first<{environment:string;kind:string;status:string;startedAt:string}>();
  if(!row||row.environment!==environment||row.kind!==params.kind||row.startedAt!==params.requestedAt) throw new BackupError("BACKUP_REQUEST_CONFLICT");
  return params;
}
export async function requestBackup(env:BackupBindings,raw:unknown,now=new Date()){
  const request=backupRequestSchema.parse(raw);
  if(env.BACKUP_ENABLED!=="true"||!env.BACKUP_WORKFLOW) throw new BackupError("BACKUP_NOT_CONNECTED");
  const prior=await env.DB.prepare("SELECT kind,started_at startedAt,status FROM backup_runs WHERE id=?").bind(request.requestKey).first<{kind:string;startedAt:string;status:string}>();
  if(prior&&prior.kind!==request.kind) throw new BackupError("BACKUP_REQUEST_CONFLICT");
  const params=await registerBackupRun(env,{runId:request.requestKey,kind:request.kind,requestedAt:prior?.startedAt??now.toISOString()});
  try{
    // Check a prior dispatch before create: network loss never starts a second
    // export with a new ID. Workflow creation uses the same stable ID.
    if(prior){try{await (await env.BACKUP_WORKFLOW.get(params.runId)).status();return backupAcceptedSchema.parse({runId:params.runId,outcome:"replayed"});}catch{if(prior.status!=="queued") throw new BackupError("BACKUP_DISPATCH_UNCERTAIN");}}
    await env.BACKUP_WORKFLOW.create({id:params.runId,params});
  }catch(error){if(error instanceof BackupError)throw error;throw new BackupError("BACKUP_DISPATCH_UNCERTAIN");}
  return backupAcceptedSchema.parse({runId:params.runId,outcome:prior?"replayed":"started"});
}
export async function readBackups(env:BackupBindings){
  if(!env.OPERATIONS_ENVIRONMENT && env.BACKUP_ENABLED!=="true") return backupListSchema.parse({enabled:false,weeklyVerifiedCount:0,items:[],manifestUpdatedAt:null});
  const rows=await env.DB.prepare(`SELECT id,kind,status,started_at startedAt,completed_at completedAt,size_bytes sizeBytes,substr(sha256,1,12) checksumPrefix,error_code errorCode FROM backup_runs WHERE environment=? AND (id IN (SELECT id FROM backup_runs WHERE environment=? AND kind!='deletion_manifest' ORDER BY started_at DESC,id DESC LIMIT 32) OR id=(SELECT id FROM backup_runs WHERE environment=? AND kind='deletion_manifest' ORDER BY started_at DESC,id DESC LIMIT 1)) ORDER BY started_at DESC,id DESC`).bind(envName(env),envName(env),envName(env)).all();
  const manifest=await env.DB.prepare("SELECT MAX(completed_at) at FROM backup_runs WHERE environment=? AND kind='deletion_manifest' AND status='verified'").bind(envName(env)).first<{at:string|null}>();
  const count=await env.DB.prepare("SELECT COUNT(*) n FROM backup_runs WHERE environment=? AND kind='weekly' AND status='verified'").bind(envName(env)).first<{n:number}>();
  return backupListSchema.parse({weeklyVerifiedCount:count?.n??0,enabled:env.BACKUP_ENABLED==="true"&&!!env.BACKUP_WORKFLOW,items:rows.results,manifestUpdatedAt:manifest?.at??null});
}
export async function backupFailure(env:BackupBindings,params:BackupParams,error:unknown){
  const code=error instanceof BackupError?error.code:error instanceof OperationsError?error.code:"BACKUP_FAILED";
  // Never turn a committed verified backup into failed because rotation failed.
  await env.DB.prepare("UPDATE backup_runs SET status=CASE WHEN status='verified' THEN status ELSE 'failed' END,error_code=? WHERE id=?").bind(code,params.runId).run();
  return code;
}
