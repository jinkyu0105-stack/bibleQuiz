import { WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep } from "cloudflare:workers";
import { backupParamsSchema } from "../../shared/api/admin-operations";
import { BackupError,backupFailure,exportPoll,registerBackupRun,rotateSqlBackups,storeSqlBackup,syncDeletionManifest,type BackupBindings,type BackupParams } from "../_shared/services/backup-storage";

export async function runBackup(env:BackupBindings,event:WorkflowEvent<BackupParams>,step:WorkflowStep){
  const params=backupParamsSchema.parse(event.payload);
  if(env.BACKUP_ENABLED!=="true") throw new BackupError("BACKUP_DISABLED");
  try{
    await step.do("register and serialize backup",{retries:{limit:12,delay:"10 seconds",backoff:"constant"}},async()=>{
      await registerBackupRun(env,params);
      const row=await env.DB.prepare("UPDATE backup_runs SET status='running' WHERE id=? AND status IN ('queued','running')").bind(params.runId).run();
      if(row.meta.changes!==1) throw new BackupError("BACKUP_RUN_NOT_ACTIVE");
      return {runId:params.runId};
    });
    await step.do("persist cumulative deletion manifest",async()=>syncDeletionManifest(env,params));
    if(params.kind==="deletion_manifest") return {status:"verified" as const,kind:params.kind};
    // An uncertain start must not automatically start another export. Only poll
    // the original bookmark; SQL/signed URLs are never returned to step state.
    const started=await step.do("start D1 export",{retries:{limit:0,delay:"1 second"}},async()=>{
      const result=await exportPoll(env);
      if(!result.bookmark) throw new BackupError("BACKUP_BOOKMARK_MISSING");
      return {bookmark:result.bookmark};
    });
    await step.do("poll compress store and verify SQL",{retries:{limit:12,delay:"5 seconds",backoff:"constant"},timeout:"15 minutes"},async()=>{
      const result=await exportPoll(env,started.bookmark);
      if(!result.url) throw new BackupError("BACKUP_EXPORT_PENDING");
      return storeSqlBackup(env,params,result.url,started.bookmark);
    });
    const rotation=await step.do("rotate only verified SQL copies",async()=>rotateSqlBackups(env));
    return {status:"verified" as const,kind:params.kind,...rotation};
  }catch(error){
    const code=await backupFailure(env,params,error);
    console.error(JSON.stringify({code,runId:params.runId}));throw new BackupError(code);
  }
}
export class BackupWorkflow extends WorkflowEntrypoint<BackupBindings,BackupParams>{
  override run(event:WorkflowEvent<BackupParams>,step:WorkflowStep){return runBackup(this.env,event,step);}
}
export async function scheduleBackup(controller:ScheduledController,env:BackupBindings){
  if(env.BACKUP_ENABLED!=="true"||!env.BACKUP_WORKFLOW) return {outcome:"disabled" as const};
  if(!["0 19 * * SUN","*/10 * * * *"].includes(controller.cron)) return {outcome:"ignored" as const};
  const requestedAt=new Date(controller.scheduledTime).toISOString();
  // Weekly schedule is a proposal only. Actual remote Cron remains absent.
  const kind=controller.cron==="0 19 * * SUN"?"weekly":"deletion_manifest";
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${env.OPERATIONS_ENVIRONMENT}/${kind}/${requestedAt}`)));
  bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;
  const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,"0")).join("");
  const runId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  await registerBackupRun(env,{runId,kind,requestedAt});
  try{await (await env.BACKUP_WORKFLOW.get(runId)).status();}catch{await env.BACKUP_WORKFLOW.create({id:runId,params:{runId,kind,requestedAt}});}
  return {outcome:"started" as const,runId};
}
export default {scheduled(controller,env,ctx){ctx.waitUntil(scheduleBackup(controller,env));}} satisfies ExportedHandler<BackupBindings>;
