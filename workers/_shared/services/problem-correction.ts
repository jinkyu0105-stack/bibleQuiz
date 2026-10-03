import { problemCommandSchema,problemViewSchema } from "../../../shared/api/admin-problem-correction";
import { revisionBodySchema,revisionCommandSchema,revisionViewSchema } from "../../../shared/api/admin-quiz-revision";
import { withdrawalReviewSchema } from "../../../shared/api/admin-withdraw";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { hashRevision,sourceToBody,checkRevisionBody,changeRevisionBody,revisionAudit } from "./quiz-revision";
import { revisionVariantStatements } from "./quiz-republication";
import { reviewSource } from "./quiz-withdrawal";
import { createQuizFinalizationService } from "./quiz-finalization";
import { createDatabase } from "../db/client";

type Case = {id:string;quiz_set_id:string;cycle:number;source_json:string;levels_json:string;review_revision:number;display_revision:number;closes_at:string;notice:string};
const latest = (db:D1Database,id:string) => db.prepare("SELECT * FROM quiz_problem_cases WHERE quiz_set_id=? ORDER BY cycle DESC LIMIT 1").bind(id).first<Case>();
const draft = (db:D1Database,id:string) => db.prepare("SELECT revision,body_json,body_sha256,created_at FROM quiz_problem_drafts WHERE case_id=? ORDER BY revision DESC LIMIT 1").bind(id).first<{revision:number;body_json:string;body_sha256:string;created_at:string}>();
export async function readProblemCorrection(db:D1Database,id:string,now=new Date()) {
 quizSetIdSchema.parse(id);
 const set=await db.prepare("SELECT status,closes_at FROM quiz_sets WHERE id=? AND status IN ('published','archived')").bind(id).first<{status:string;closes_at:string}>();
 if(!set) throw new Error("PROBLEM_UNAVAILABLE");
 const c=await latest(db,id),d=c ? await draft(db,c.id):null;
 const outcome=c ? await db.prepare("SELECT action,created_at FROM quiz_problem_outcomes WHERE case_id=?").bind(c.id).first<{action:string;created_at:string}>():null;
 const purged=c ? await db.prepare("SELECT 1 FROM quiz_problem_cleanup WHERE case_id=?").bind(c.id).first():null;
 const source=c ? withdrawalReviewSchema.parse(JSON.parse(c.source_json)):null;
 const body=d && !purged ? revisionBodySchema.parse(JSON.parse(d.body_json)):null;
 const status=outcome?.action==="publish" ? "published":outcome ? "cancelled":purged ? "expired":c ? "editing":"ready";
 const issues=body && source ? checkRevisionBody(body,source):[];
 const current=await db.prepare("SELECT id,difficulty FROM quiz_variants WHERE quiz_set_id=? AND lifecycle_status='active'").bind(id).all<{id:string;difficulty:string}>();
 const variants=Object.fromEntries(current.results.map(v=>[v.difficulty,v.id]));
 const impact=await db.prepare(`SELECT v.difficulty,v.id variantId,v.revision,
 (SELECT count(*) FROM submissions WHERE quiz_variant_id=v.id AND status='visible') visible,
 (SELECT count(*) FROM submissions WHERE quiz_variant_id=v.id AND status='hidden') hidden,
 (SELECT count(*) FROM submissions WHERE quiz_variant_id=v.id AND status='deleted') deleted,
 (SELECT count(*) FROM leaderboard_snapshot_entries e JOIN leaderboard_snapshots l ON l.id=e.snapshot_id WHERE l.quiz_variant_id=v.id) winners
 FROM quiz_variants v WHERE v.quiz_set_id=? AND (v.lifecycle_status='active' OR v.id IN (SELECT json_extract(value,'$.sourceVariantId') FROM json_each(?,'$.variants'))) ORDER BY v.difficulty,v.revision`).bind(id,c?.source_json ?? '{}').all();
 const editor=c && source ? revisionViewSchema.parse({quizSetId:id,sessionId:c.id,cycle:c.cycle,revision:d?.revision ?? 0,
 state:status==="published" ? "published":status==="expired" ? "expired":"editing",body,
 sourceEvidence:Object.fromEntries(source.variants.flatMap(v=>v.entries.map(e=>[e.id,e.grounding]))),slug:source.slug,disclosure:source.disclosure,translation:source.translation,bibleReadingUrl:source.bibleReadingUrl,
 issues,canPublish:status==="editing" && !!body && !issues.length && Object.values(body.reviewed).every(Boolean),savedAt:d?.created_at ?? null,
 publication:outcome?.action==="publish" ? {publishedAt:outcome.created_at,closesAt:set.closes_at}:null}):null;
 return problemViewSchema.parse({editor,cycle:c?.cycle ?? 0,status,closesAt:set.closes_at,notice:c?.notice ?? null,levels:c ? JSON.parse(c.levels_json):[],variants,impact:impact.results,
 nonRanked:set.status==="archived" || now.getTime()>=Date.parse(set.closes_at)});
}
export async function executeProblemCorrection(db:D1Database,id:string,raw:unknown,actorEmail:string,now=new Date()) {
 quizSetIdSchema.parse(id);
 const command=problemCommandSchema.parse(raw),at=now.toISOString(),actor=await hashRevision(actorEmail),hash=await hashRevision(command);
 // Finish the old period with the existing writer before any archived correction; never reopen it.
 const due=await db.prepare("SELECT status,closes_at FROM quiz_sets WHERE id=?").bind(id).first<{status:string;closes_at:string}>();
 if(due?.status==="published" && due.closes_at<=at) await createQuizFinalizationService(createDatabase(db)).finalizeDueQuizSet(id,now);
 if(command.action==="start") {
  // Narrow the shared editor command union to the correction start fields.
  if(!("levels" in command)) throw new Error("PROBLEM_INVALID");
  const prior=await db.prepare("SELECT quiz_set_id,request_sha256,actor_digest FROM quiz_problem_cases WHERE id=?").bind(command.requestKey).first<{quiz_set_id:string;request_sha256:string;actor_digest:string}>();
  if(prior) {if(prior.quiz_set_id!==id || prior.request_sha256!==hash || prior.actor_digest!==actor) throw new Error("PROBLEM_CONFLICT");return readProblemCorrection(db,id,now);}
  const view=await readProblemCorrection(db,id,now);
  if(view.cycle!==command.expectedCycle || view.status==="editing" || view.variants.child!==command.expectedVariants.child || view.variants.adult!==command.expectedVariants.adult) throw new Error("PROBLEM_STALE");
  const source=await db.prepare(reviewSource).bind("https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",id).first<{body:string}>();
  if(!source) throw new Error("PROBLEM_UNAVAILABLE");
  const parsed=withdrawalReviewSchema.parse(JSON.parse(source.body)),body=sourceToBody(parsed);
  const display=await db.prepare("SELECT coalesce(max(revision),0) revision FROM published_display_corrections WHERE quiz_set_id=?").bind(id).first<{revision:number}>();
  await db.batch([
   db.prepare(`INSERT INTO quiz_problem_cases(id,quiz_set_id,cycle,source_json,levels_json,review_revision,display_revision,closes_at,notice,reason,request_sha256,actor_digest,created_at)
   VALUES(?,?,?,(SELECT ? WHERE ?=(${reviewSource})),?,(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=?),?,?,?,?,?,?,?)`).bind(command.requestKey,id,view.cycle+1,source.body,source.body,"https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",id,JSON.stringify(command.levels),id,display!.revision,view.closesAt,command.notice,command.reason,hash,actor,at),
   problemDraft(db,command.requestKey,1,command.requestKey,hash,actor,"start",body,await hashRevision(body),at),
   revisionAudit(db,id,"problem_paused",actorEmail,at,{reason:command.reason,levels:command.levels}),
  ]);
  return readProblemCorrection(db,id,now);
 }
 const c=await latest(db,id);
 if(!c || c.id!==command.sessionId) throw new Error("PROBLEM_STALE");
 if(command.action!=="trial") {
  const prior=await db.prepare(`SELECT request_sha256,actor_digest FROM quiz_problem_drafts WHERE case_id=? AND request_key=?
   UNION ALL SELECT request_sha256,actor_digest FROM quiz_problem_outcomes WHERE case_id=? AND request_key=?`).bind(c.id,command.requestKey,c.id,command.requestKey).first<{request_sha256:string;actor_digest:string}>();
  if(prior) {if(prior.request_sha256!==hash || prior.actor_digest!==actor) throw new Error("PROBLEM_CONFLICT");return readProblemCorrection(db,id,now);}
 }
 const view=await readProblemCorrection(db,id,now),d=await draft(db,c.id);
 if(!d || view.editor?.revision!==command.expectedRevision || !["editing",...(command.action==="cancel" ? ["expired"]:[])].includes(view.status)) throw new Error("PROBLEM_STALE");
 const source=withdrawalReviewSchema.parse(JSON.parse(c.source_json)),body=view.editor?.body;
 if(command.action==="publish" || command.action==="cancel") {
  if(command.action==="publish" && (!view.editor?.canPublish || !body)) throw new Error("PROBLEM_NOT_REVIEWED");
  const statements:D1PreparedStatement[]=[];
  if(command.action==="publish" && body) {
   for(const level of view.levels) {
    const old=source.variants.find(v=>v.difficulty===level)!;
    statements.push(db.prepare("UPDATE quiz_variants SET lifecycle_status='superseded',results_status='invalidated',lifecycle_reason=?,lifecycle_changed_at=? WHERE id=? AND revision=? AND lifecycle_status='active'").bind(c.notice,at,old.sourceVariantId,old.sourceRevision));
   }
   const winners=await db.prepare("SELECT difficulty,winner_count FROM quiz_variants WHERE quiz_set_id=? AND id IN (SELECT json_extract(value,'$.sourceVariantId') FROM json_each(?,'$.variants'))").bind(id,c.source_json).all<{difficulty:string;winner_count:number}>();
   statements.push(...await revisionVariantStatements(db,id,body,source,command.requestKey,c.review_revision,at,view.levels,view.nonRanked ? "non_ranked_correction":"valid",Object.fromEntries(winners.results.map(v=>[v.difficulty,v.winner_count]))));
   for(const level of view.levels) statements.push(db.prepare("UPDATE quiz_variants SET replaces_variant_id=?,corrects_variant_id=? WHERE id=?")
    .bind(source.variants.find(v=>v.difficulty===level)!.sourceVariantId,view.nonRanked ? source.variants.find(v=>v.difficulty===level)!.sourceVariantId:null,`rev-${command.requestKey}-${level}`));
  }
  statements.push(db.prepare(`INSERT INTO quiz_problem_outcomes(case_id,action,draft_revision,request_key,request_sha256,actor_digest,reason,content_json,body_sha256,display_revision,non_ranked,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,(SELECT ? FROM quiz_sets WHERE id=? AND closes_at=?),?)`).bind(c.id,command.action,d.revision,command.requestKey,hash,actor,command.action==="cancel" ? command.reason:"검토한 수정본 발행",command.action==="publish" ? JSON.stringify(body!.content):'null',d.body_sha256,c.display_revision,view.nonRanked ? 1:0,id,view.closesAt,at));
  statements.push(revisionAudit(db,id,`problem_${command.action}`,actorEmail,at,{caseId:c.id,reason:command.action==="cancel" ? command.reason:c.notice,nonRanked:view.nonRanked}));
  await db.batch(statements);
  return readProblemCorrection(db,id,now);
 }
 if(!body) throw new Error("PROBLEM_EXPIRED");
 const parsed=revisionCommandSchema.parse(command);
 if(parsed.action==="start" || parsed.action==="publish") throw new Error("PROBLEM_INVALID");
 // Unaffected difficulty and shared metadata stay identical when correcting only one difficulty.
 if(parsed.action==="save" && view.levels.length===1) {
  const base=sourceToBody(source).content,other=view.levels[0]==="child" ? "adult":"child";
  if(JSON.stringify({...parsed.content,child:[],adult:[]})!==JSON.stringify({...base,child:[],adult:[]}) || JSON.stringify(parsed.content[other])!==JSON.stringify(base[other])) throw new Error("PROBLEM_SCOPE");
 }
 if((parsed.action==="layout" || parsed.action==="trial") && !view.levels.includes(parsed.difficulty)) throw new Error("PROBLEM_SCOPE");
 const trial=changeRevisionBody(body,source,parsed);if(parsed.action==="trial") return trial!;
 await db.batch([problemDraft(db,c.id,d.revision+1,parsed.requestKey,hash,actor,parsed.action,body,await hashRevision(body),at),revisionAudit(db,id,`problem_${parsed.action}`,actorEmail,at,{caseId:c.id,revision:d.revision+1})]);
 return readProblemCorrection(db,id,now);
}
function problemDraft(db:D1Database,id:string,revision:number,key:string,hash:string,actor:string,kind:string,body:unknown,bodyHash:string,at:string) {
 return db.prepare("INSERT INTO quiz_problem_drafts VALUES(?,?,?,?,?,?,?,?,?)").bind(id,revision,key,hash,actor,kind,JSON.stringify(body),bodyHash,at);
}

export async function readProblemRecords(db:D1Database,id:string) {
 quizSetIdSchema.parse(id);
 const {problemRecordsSchema}=await import("../../../shared/api/admin-problem-correction");
 const rows=await db.prepare("SELECT c.id,c.created_at,c.notice,c.reason,c.source_json,coalesce(o.action,'pending') outcome FROM quiz_problem_cases c LEFT JOIN quiz_problem_outcomes o ON o.case_id=c.id WHERE c.quiz_set_id=? ORDER BY c.cycle DESC").bind(id)
 .all<{id:string;created_at:string;notice:string;reason:string;source_json:string;outcome:string}>();
 return problemRecordsSchema.parse({items:rows.results.map(r=>({caseId:r.id,createdAt:r.created_at,notice:r.notice,reason:r.reason,outcome:r.outcome,source:sourceToBody(withdrawalReviewSchema.parse(JSON.parse(r.source_json)))}))});
}
