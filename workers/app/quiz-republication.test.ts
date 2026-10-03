import { createSubmissionRepository, type VisibleSubmissionWrite } from "../_shared/repositories/submission-repository";
import { afterEach,describe,it,expect,vi } from "vitest";
import { exports } from "cloudflare:workers";
import { generationDb as db } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createAccessFixture } from "./test/access-fixture";
import { createDatabase } from "../_shared/db/client";
import { generatePuzzle,PUZZLE_FIXTURES,serializePublicPuzzle,cellId } from "../../shared/puzzle";
import { withdrawPublishedQuiz,readWithdrawalReview } from "../_shared/services/quiz-withdrawal";
import { executeQuizRevision,readQuizRevision } from "../_shared/services/quiz-revision";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { correctPublishedDisplayText,readPublishedDisplayText } from "../_shared/services/published-display-text";
import { purgeExpiredDraft,listDraftCleanup } from "../_shared/services/draft-cleanup";
import { saveWithdrawalEdits } from "../_shared/services/withdrawal-edits";
import { revisionViewSchema,revisionTrialSchema,type RevisionView } from "../../shared/api/admin-quiz-revision";
const actor="synthetic@example.invalid";
const at = "2026-09-23T00:00:00.000Z", publishedAt = "2026-09-21T00:00:00.000Z";
const generated = generatePuzzle({ ...PUZZLE_FIXTURES.fiveByFive,
  candidates: PUZZLE_FIXTURES.fiveByFive.candidates.map((candidate, index) => ({ ...candidate, id: `entry-${index}` })) });
if (!generated.ok) throw new Error("synthetic fixture failed");
const puzzle = generated.puzzle, grid = serializePublicPuzzle(puzzle);
afterEach(() => vi.restoreAllMocks());
async function fixture(withdraw = true) {
  const id = crypto.randomUUID(), sermonId = crypto.randomUUID(), slug = `2026-09-20-${id.slice(0, 6)}`;
  await seedMetadataSermon(createDatabase(db), sermonId);
  await db.prepare("UPDATE sermons SET slug=?,ai_summary='합성 요약',ai_summary_disclosure='아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.' WHERE id=?").bind(slug, sermonId).run();
  await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
    VALUES(?,?,'published','synthetic',?,?,?,?, '2026-09-28T00:00:00.000Z')`).bind(id, sermonId, publishedAt, publishedAt, publishedAt, publishedAt).run();
  for (const difficulty of ["child", "adult"]) {
    const variantId = `${id}-${difficulty}`;
    const stored = { size: 5, cells: Array.from({ length: 25 }, (_, index) => {
      const row = Math.floor(index / 5), column = index % 5, starts = grid.entries.filter(e => e.start.row === row && e.start.column === column);
      return { row, column, isBlocked: !grid.cells.some(c => c.id === cellId({ row, column })),
        ...(starts.some(e => e.direction === "across") ? { acrossNumber: starts[0]!.number } : {}),
        ...(starts.some(e => e.direction === "down") ? { downNumber: starts[0]!.number } : {}) };
    }) };
    await db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at)
      VALUES(?,?,?,1,5,?,?,?,?,?,?)`).bind(variantId, id, difficulty, JSON.stringify(stored), grid.entries.length, grid.cells.length, puzzle.report.crossingCellCount,
        JSON.stringify({ errors: [], warnings: [], generatedAt: publishedAt }), publishedAt).run();
    for (const [index, entry] of grid.entries.entries()) await db.prepare("INSERT INTO quiz_entries_public VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(`${variantId}-${entry.id}`, variantId, entry.number, entry.direction, entry.start.row, entry.start.column, entry.length, entry.clue!, '{"source":"SYNTHETIC_PRIVATE_GROUNDING"}', index).run();
    await db.prepare("INSERT INTO quiz_solutions VALUES(?,?,?,?,?)").bind(variantId, JSON.stringify(grid.cells.map(c => c.id)), JSON.stringify(puzzle.solution.cells),
      JSON.stringify(Object.fromEntries(Object.entries(puzzle.solution.entries).map(([key, value]) => [`${variantId}-${key}`, value]))), "a".repeat(64)).run();
  }
  if (withdraw) await withdrawPublishedQuiz(db, id, { requestKey: crypto.randomUUID(), expectedPublishedAt: publishedAt, expectedDisplayRevision: 0,
    reason: "합성 철회", confirmation: "withdraw" }, "synthetic@example.invalid", new Date(at));
  return { id, sermonId, slug, entryId: `${id}-child-${grid.entries[0]!.id}` };
}

const now=new Date("2026-09-24T00:00:00.000Z");
async function act(id: string,view: RevisionView,action: string,fields: object={},date=now,database=db) {
 return executeQuizRevision(database,id,{ action,requestKey:crypto.randomUUID(),sessionId:view.sessionId,expectedRevision:view.revision,...fields },actor,date).then(v=>revisionViewSchema.parse(v));
}
async function start(id: string,cycle=0,date=now) {
 return revisionViewSchema.parse(await executeQuizRevision(db,id,{ action:"start",requestKey:crypto.randomUUID(),expectedCycle:cycle },actor,date));
}
async function reviewed(id: string,view: RevisionView,date=now) {
 for (const area of ["summary","child","adult"]) view=await act(id,view,"review",{area,confirmed:true},date);
 return view;
}
async function snapshot(id: string) {
 return { old: await db.prepare("SELECT * FROM quiz_withdrawals WHERE quiz_set_id=?").bind(id).all().then(r=>r.results),
 variants: await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? AND revision=1 ORDER BY difficulty").bind(id).all().then(r=>r.results),
 entries: await db.prepare("SELECT e.* FROM quiz_entries_public e JOIN quiz_variants v ON v.id=e.quiz_variant_id WHERE v.quiz_set_id=? AND v.revision=1 ORDER BY e.id").bind(id).all().then(r=>r.results),
 solutions: await db.prepare("SELECT s.* FROM quiz_solutions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=? AND v.revision=1 ORDER BY s.quiz_variant_id").bind(id).all().then(r=>r.results) };
}
describe("P5-60 complete withdrawal editing lifecycle",()=>{
 it("edits, trials, reviews, republishes at the permanent slug, corrects and withdraws again without changing original rows",async()=>{
  const f=await fixture(),before=await snapshot(f.id);
  let view=await start(f.id);
  expect(view.body).not.toBeNull(); expect(view.issues).toEqual([]);
  const content=structuredClone(view.body!.content); content.metadata.title="새 발행 제목"; content.metadata.sermonDate="2026-09-22"; content.summary="수정된 설교 요약";
  content.child[0]!.answer+="힣";content.child[0]!.clue="사람이 수정한 단서"; content.child[0]!.evidence="설교의 원래 의미를 확인한 관리자 근거";
  view=await act(f.id,view,"save",{content});
  expect(view.body!.layouts.child).toBeNull();
  const trial=revisionTrialSchema.parse(await executeQuizRevision(db,f.id,{action:"trial",sessionId:view.sessionId,expectedRevision:view.revision,difficulty:"child",gridSize:6,seed:"revision-six"},actor,now));
  expect(trial.layout?.grid.gridSize).toBe(6);
  view=await act(f.id,view,"layout",{difficulty:"child",gridSize:6,seed:"revision-six"});
  await expect(act(f.id,view,"publish",{confirmation:"publish"})).rejects.toThrow();
  view=await reviewed(f.id,view); expect(view.canPublish).toBe(true);
  const publish={action:"publish",requestKey:crypto.randomUUID(),sessionId:view.sessionId,expectedRevision:view.revision,confirmation:"publish"};
  const published=revisionViewSchema.parse(await executeQuizRevision(db,f.id,publish,actor,now));
  expect(published.state).toBe("published"); expect(published.publication?.closesAt).toBe("2026-10-01T00:00:00.000Z");
  expect(revisionViewSchema.parse(await executeQuizRevision(db,f.id,publish,actor,now))).toEqual(published);
  const publicView=await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now);
  expect(publicView.quiz?.sermon.title).toBe(content.metadata.title); expect(publicView.quiz?.sermon.summary?.text).toBe(content.summary);
  expect(publicView.quiz?.variant.revision).toBe(2);
  expect(JSON.stringify(publicView)).not.toMatch(/SYNTHETIC_PRIVATE_GROUNDING|관리자 근거|"solution"|actorDigest/u);
  const display=await readPublishedDisplayText(db,f.id);
  await correctPublishedDisplayText(db,f.id,{requestKey:crypto.randomUUID(),expectedRevision:display.quiz.revision,before:display.quiz.metadata,after:{...display.quiz.metadata,title:"재발행 뒤 표시 정정"},reason:"표시 정정"},actor,new Date("2026-09-25T00:00:00.000Z"));
  const cmd={requestKey:crypto.randomUUID(),expectedPublishedAt:published.publication!.publishedAt,expectedDisplayRevision:1,reason:"두 번째 철회",confirmation:"withdraw"};
  await withdrawPublishedQuiz(db,f.id,cmd,actor,new Date("2026-09-26T00:00:00.000Z"));
  expect((await withdrawPublishedQuiz(db,f.id,cmd,actor,new Date("2026-09-26T00:00:00.000Z"))).outcome).toBe("replayed");
  expect((await readWithdrawalReview(db,f.id)).review.metadata.title).toBe("재발행 뒤 표시 정정");
  view=await readQuizRevision(db,f.id); expect(view.cycle).toBe(2); expect(view.body!.content.summary).toBe(content.summary);
  expect(revisionViewSchema.parse(await executeQuizRevision(db,f.id,publish,actor,now)).state).toBe("editing");
  expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz).toBeNull();
  view=await reviewed(f.id,view,new Date("2026-09-26T01:00:00.000Z"));
  view=await act(f.id,view,"publish",{confirmation:"publish"},new Date("2026-09-26T02:00:00.000Z"));
  expect(view.state).toBe("published");
  expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"adult",new Date("2026-09-27T00:00:00.000Z"))).quiz?.variant.revision).toBe(3);
  expect(await snapshot(f.id)).toEqual(before);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
 });
 it("carries earlier saved edits, invalidates reviews on any save and blocks stale writers, forged IDs and incomplete geometry",async()=>{
  const f=await fixture();
  await saveWithdrawalEdits(db,f.id,{requestKey:crypto.randomUUID(),expectedReviewRevision:2,expectedEditRevision:0,edits:[{difficulty:"child",entryId:f.entryId,clue:"이전 저장 단서"}]},actor,new Date(at));
  let view=await start(f.id);expect(view.body!.content.child.find(e=>e.id===f.entryId)?.clue).toBe("이전 저장 단서");
  expect(view.canPublish).toBe(false);expect(view.issues.join()).toContain("근거");
  const content=structuredClone(view.body!.content);content.child.find(e=>e.id===f.entryId)!.evidence="확인한 근거";
  view=await act(f.id,view,"save",{content});view=await reviewed(f.id,view);
  const old=view;content.summary="새 요약";view=await act(f.id,view,"save",{content});
  expect(Object.values(view.body!.reviewed)).toEqual([false,false,false]);
  await expect(act(f.id,old,"publish",{confirmation:"publish"})).rejects.toThrow();
  await expect(act(f.id,old,"save",{content})).rejects.toThrow();
  const forged=structuredClone(content);forged.child[0]!.id="foreign";
  await expect(act(f.id,view,"save",{content:forged})).rejects.toThrow();
  content.child[0]!.answer="가나다라아자차";content.child[0]!.evidence="길이 변경 근거";
  view=await act(f.id,view,"save",{content});expect(view.body!.layouts.child).toBeNull();
  await expect(act(f.id,view,"review",{area:"child",confirmed:true})).rejects.toThrow();
  const attempts=await Promise.allSettled([act(f.id,view,"save",{content}),act(f.id,view,"save",{content})]);
  expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 });
 it("expires the complete editing work, restarts explicitly, and switches the deadline to republication while preserving public content",async()=>{
  const f=await fixture();
  await saveWithdrawalEdits(db,f.id,{requestKey:crypto.randomUUID(),expectedReviewRevision:2,expectedEditRevision:0,edits:[{difficulty:"adult",entryId:`${f.id}-adult-${grid.entries[0]!.id}`,clue:"같은 단서"}]},actor,new Date(at));
  let view=await start(f.id);const source=(await readWithdrawalReview(db,f.id)).review;
  expect(await purgeExpiredDraft(db,f.sermonId,"2026-09-30T23:59:59.999Z")).toEqual({outcome:"not_due"});
  expect((await listDraftCleanup(db,"2026-09-30T00:00:00.000Z")).items.find(i=>i.sermonId===f.sermonId)?.state).toBe("scheduled");
  expect(await purgeExpiredDraft(db,f.sermonId,"2026-10-01T00:00:00.000Z")).toEqual({outcome:"purged"});
  expect((await readQuizRevision(db,f.id)).state).toBe("expired");
  expect((await db.prepare("SELECT edits_json body FROM withdrawal_edit_revisions WHERE quiz_set_id=?").bind(f.id).first())?.body).toBe("[]");
  await expect(act(f.id,view,"save",{content:view.body!.content})).rejects.toThrow("DRAFT_EXPIRED");
  view=await start(f.id,1,new Date("2026-10-02T00:00:00.000Z"));
  expect(view.body!.content.summary).toBe(source.summary);expect(view.cycle).toBe(2);
  view=await reviewed(f.id,view,new Date("2026-10-02T00:00:00.000Z"));
  await act(f.id,view,"publish",{confirmation:"publish"},new Date("2026-10-03T00:00:00.000Z"));
  const before=await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",new Date("2026-10-04T00:00:00.000Z"));
  expect(await purgeExpiredDraft(db,f.sermonId,"2026-10-09T23:59:59.999Z")).toEqual({outcome:"not_due"});
  expect(await purgeExpiredDraft(db,f.sermonId,"2026-10-10T00:00:00.000Z")).toEqual({outcome:"purged"});
  expect((await readQuizRevision(db,f.id)).body).toBeNull();
  expect(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",new Date("2026-10-04T00:00:00.000Z"))).toEqual(before);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
 });
});

describe("P5-60 commit and API boundaries",()=>{
 it("rolls back publication and cleanup with their audit, and rejects edits that change after publication checks",async()=>{
  const f=await fixture();let view=await reviewed(f.id,await start(f.id));
  const before=await snapshot(f.id);
  await db.exec("CREATE TRIGGER republication_test_audit BEFORE INSERT ON audit_logs WHEN NEW.action='quiz_republished' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  try {await expect(act(f.id,view,"publish",{confirmation:"publish"})).rejects.toThrow();}
  finally {await db.exec("DROP TRIGGER republication_test_audit");}
  expect((await readQuizRevision(db,f.id)).state).toBe("editing");expect(await snapshot(f.id)).toEqual(before);
  expect((await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? AND revision>1").bind(f.id).all()).results).toEqual([]);
  const proxy=new Proxy(db,{get(target,key){
   if(key==="batch") return async(statements:D1PreparedStatement[])=>{
    const content=structuredClone(view.body!.content);content.summary="경합으로 바뀐 요약";
    await act(f.id,view,"save",{content});return target.batch(statements);
   };
   const value=Reflect.get(target,key);return typeof value==="function" ? value.bind(target):value;
  }});
  await expect(act(f.id,view,"publish",{confirmation:"publish"},now,proxy)).rejects.toThrow();
  expect((await readQuizRevision(db,f.id)).body!.content.summary).toBe("경합으로 바뀐 요약");
  expect((await db.prepare("SELECT * FROM quiz_republications WHERE quiz_set_id=?").bind(f.id).all()).results).toEqual([]);
  view=await readQuizRevision(db,f.id);
  await db.exec("CREATE TRIGGER revision_cleanup_test_audit BEFORE INSERT ON audit_logs WHEN NEW.action='quiz_revisions_purged' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  try {await expect(purgeExpiredDraft(db,f.sermonId,"2026-10-01T00:00:00.000Z")).rejects.toThrow();}
  finally {await db.exec("DROP TRIGGER revision_cleanup_test_audit");}
  expect(await readQuizRevision(db,f.id)).toEqual(view);
  const cleanupProxy=new Proxy(db,{get(target,key){
   if(key==="batch") return async(statements:D1PreparedStatement[])=>{await act(f.id,view,"save",{content:view.body!.content},new Date("2026-09-30T00:00:00.000Z"));return target.batch(statements);};
   const value=Reflect.get(target,key);return typeof value==="function" ? value.bind(target):value;
  }});
  await expect(purgeExpiredDraft(cleanupProxy,f.sermonId,"2026-10-01T00:00:00.000Z")).rejects.toThrow();
  expect((await readQuizRevision(db,f.id)).state).toBe("editing");
 });
 it("keeps review records immutable and rejects direct revival or fabricated approvals",async()=>{
  const f=await fixture(),view=await start(f.id);
  await expect(db.prepare("UPDATE quiz_sets SET status='published' WHERE id=?").bind(f.id).run()).rejects.toThrow();
  await expect(db.prepare("UPDATE quiz_revision_sessions SET reason='forged' WHERE id=?").bind(view.sessionId).run()).rejects.toThrow();
  await expect(db.prepare("UPDATE quiz_revision_drafts SET body_json='null' WHERE session_id=?").bind(view.sessionId).run()).rejects.toThrow();
  const forged=structuredClone(view.body!);forged.reviewed={summary:true,child:true,adult:true};
  await expect(db.prepare(`INSERT INTO quiz_revision_drafts SELECT session_id,revision+1,?,request_sha256,actor_digest,'save',?,body_sha256,created_at FROM quiz_revision_drafts WHERE session_id=?`)
   .bind(crypto.randomUUID(),JSON.stringify(forged),view.sessionId).run()).rejects.toThrow();
  await expect(db.prepare("DELETE FROM quiz_revision_drafts WHERE session_id=?").bind(view.sessionId).run()).rejects.toThrow();
  expect(await readQuizRevision(db,f.id)).toEqual(view);
 });
 it("enforces Access, same-origin, bounded strict JSON, methods, no-store and safe errors for the complete private editor",async()=>{
  const f=await fixture(),url=`https://example.com/api/admin/quiz-sets/${f.id}/revision`;
  for(const method of ["GET","POST","DELETE"]) expect((await exports.default.fetch(new Request(url,{method}))).status).toBe(401);
  const access=await createAccessFixture(new Date()),network=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json(access.jwks));
  const headers={"Cf-Access-Jwt-Assertion":access.token,Origin:"https://example.com","Content-Type":"application/json"};
  const command={action:"start",requestKey:crypto.randomUUID(),expectedCycle:0};
  for(const origin of ["https://bad.invalid","null",""]) expect((await exports.default.fetch(new Request(url,{method:"POST",headers:{...headers,Origin:origin},body:JSON.stringify(command)}))).status).toBe(403);
  for(const [target,method,body,status] of [[url,"DELETE",undefined,405],[url+"?x=1","GET",undefined,409],[url,"POST",{...command,solution:"PRIVATE_CANARY"},409],
   [url,"POST",{body:"x".repeat(2*1_048_576+4096)},413]] as const){
   const response=await exports.default.fetch(new Request(target,{method,headers,...(body ? {body:JSON.stringify(body)}:{})}));
   expect(response.status).toBe(status);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(await response.text()).not.toMatch(/PRIVATE_CANARY|SELECT|D1_ERROR/u);
  }
  expect((await exports.default.fetch(new Request(url,{method:"POST",headers,body:"{"}))).status).toBe(400);
  expect((await exports.default.fetch(new Request(url,{method:"POST",headers:{...headers,"Content-Type":"text/plain"},body:"{}"}))).status).toBe(415);
  const response=await exports.default.fetch(new Request(url,{method:"POST",headers,body:JSON.stringify(command)}));expect(response.status).toBe(200);
  const view=revisionViewSchema.parse((await response.json() as {data:unknown}).data);
  expect(view.state).toBe("editing");
  const read=await exports.default.fetch(new Request(url,{headers}));expect(read.status).toBe(200);expect(read.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await read.text()).not.toMatch(/actor_digest|request_sha256|example.invalid/u);
  expect(network.mock.calls.every(([input])=>String(input).includes("cloudflareaccess.com"))).toBe(true);
 });
});

 it("serializes a new revision submission against repeat withdrawal and retains hidden/deleted successes",async()=>{
  for(const mode of ["submit","withdraw","race","hidden","deleted"]) {
   const f=await fixture();let view=await reviewed(f.id,await start(f.id));view=await act(f.id,view,"publish",{confirmation:"publish"});
   const variant=await db.prepare("SELECT id FROM quiz_variants WHERE quiz_set_id=? AND difficulty='adult' AND lifecycle_status='active'").bind(f.id).first<{id:string}>();
   const sessionHash=crypto.randomUUID().replaceAll("-","").repeat(2),submittedAt="2026-09-24T01:00:00.000Z";
   await db.prepare("INSERT INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(sessionHash,publishedAt,publishedAt).run();
   const value:VisibleSubmissionWrite={id:crypto.randomUUID(),quizVariantId:variant!.id,quizRevision:2,sessionHash,idempotencyKey:"01924f8e-7b2a-7f1c-8f3a-123456789abc",requestHash:"c".repeat(64),displayName:"합성 이름",comment:"합성",
    answers:{[grid.cells[0]!.id]:"가"},correctnessMask:"1"+"0".repeat(grid.cells.length-1),correctCells:1,totalCells:grid.cells.length,correctWords:0,totalWords:grid.entries.length,
    scoreBasisPoints:Math.floor(10000/grid.cells.length),isFullyCorrect:false,submittedAt};
   const command={requestKey:crypto.randomUUID(),expectedPublishedAt:view.publication!.publishedAt,expectedDisplayRevision:0,reason:"반복 철회 시험",confirmation:"withdraw"};
   const submit=()=>createSubmissionRepository(createDatabase(db)).saveSubmission(value,submittedAt);
   if(mode==="withdraw") {await withdrawPublishedQuiz(db,f.id,command,actor,new Date(submittedAt));expect(await submit()).toEqual({outcome:"closed"});}
   else if(mode==="race") {
    const proxy=new Proxy(db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{await submit();return target.batch(statements);};const v=Reflect.get(target,key);return typeof v==="function"?v.bind(target):v;}});
    await expect(withdrawPublishedQuiz(proxy,f.id,command,actor,new Date(submittedAt))).rejects.toThrow();
   } else {
    await submit();
    if(mode==="hidden") await db.prepare("UPDATE submissions SET status='hidden',hidden_at=? WHERE id=?").bind(submittedAt,value.id).run();
    if(mode==="deleted") await db.prepare("UPDATE submissions SET status='deleted',display_name=NULL,comment=NULL,answers_json=NULL,deleted_at=? WHERE id=?").bind(submittedAt,value.id).run();
    const before=await db.prepare("SELECT * FROM submissions WHERE id=?").bind(value.id).first();
    await expect(withdrawPublishedQuiz(db,f.id,command,actor,new Date(submittedAt))).rejects.toThrow();
    expect(await db.prepare("SELECT * FROM submissions WHERE id=?").bind(value.id).first()).toEqual(before);
   }
   const saved=await db.prepare("SELECT count(*) n FROM submissions WHERE id=?").bind(value.id).first<{n:number}>();
   const sessions=await db.prepare("SELECT count(*) n FROM quiz_revision_sessions WHERE quiz_set_id=? AND kind='withdraw'").bind(f.id).first<{n:number}>();
   expect(saved!.n+sessions!.n).toBe(1);
  }
 });
