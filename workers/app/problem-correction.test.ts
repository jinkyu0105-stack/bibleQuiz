import { afterEach,describe,it,expect,vi } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createDatabase } from "../_shared/db/client";
import { generatePuzzle,PUZZLE_FIXTURES,serializePublicPuzzle,cellId } from "../../shared/puzzle";
import { withdrawPublishedQuiz } from "../_shared/services/quiz-withdrawal";
import { executeProblemCorrection,readProblemCorrection } from "../_shared/services/problem-correction";
import { problemViewSchema,type ProblemView } from "../../shared/api/admin-problem-correction";
import { createSubmissionRepository } from "../_shared/repositories/submission-repository";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { scoreSubmission } from "../_shared/services/submission-scoring";
const actor="synthetic@example.invalid";
const at = "2026-09-23T00:00:00.000Z", publishedAt = "2026-09-21T00:00:00.000Z";
const generated = generatePuzzle({ ...PUZZLE_FIXTURES.fiveByFive,
  candidates: PUZZLE_FIXTURES.fiveByFive.candidates.map((candidate, index) => ({ ...candidate, id: `entry-${index}` })) });
if (!generated.ok) throw new Error("synthetic fixture failed");
const puzzle = generated.puzzle, grid = serializePublicPuzzle(puzzle);
afterEach(() => vi.restoreAllMocks());
async function fixture(withdraw = false) {
  const id = crypto.randomUUID(), sermonId = crypto.randomUUID(), slug = `2026-09-20-${id.slice(0, 6)}`;
  await seedMetadataSermon(createDatabase(db), sermonId);
  await db.prepare("UPDATE sermons SET slug=?,ai_summary='합성 요약',ai_summary_disclosure='아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.' WHERE id=?").bind(slug, sermonId).run();
  await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
    VALUES(?,?,'published','synthetic',?,?,?,?, '2026-09-28T00:00:00.000Z')`).bind(id, sermonId, publishedAt, publishedAt, publishedAt, publishedAt).run();
  await db.prepare(`INSERT INTO sermon_transcripts(id,sermon_id,source_revision,language,source_mode,source_coverage,is_auto_generated,raw_text,raw_sha256,confirmed_text,confirmed_sha256,status,confirmed_by,confirmed_at,fetched_at)
    VALUES(?,?,1,'ko','public_unofficial','full_transcript',1,'합성','synthetic','합성','synthetic','confirmed','synthetic',?,?)`).bind(sermonId,sermonId,publishedAt,publishedAt).run();
  await db.prepare("UPDATE quiz_sets SET confirmed_transcript_id=? WHERE id=?").bind(sermonId,id).run();
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
async function submitted() {
 const f=await fixture(),repository=createSubmissionRepository(createDatabase(db));
 const quiz=(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz!;
 const source=await repository.findScoringSolution(quiz.variant.id);
 const score=scoreSubmission({grid:quiz.variant.grid,...source!},{[grid.cells[0]!.id]:"가"});
 const sessionHash="b".repeat(64);
 await db.prepare("INSERT OR IGNORE INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(sessionHash,at,at).run();
 await repository.saveSubmission({id:crypto.randomUUID(),quizVariantId:quiz.variant.id,quizRevision:1,sessionHash,idempotencyKey:"01924f8e-7b2a-7f1c-8f3a-123456789abc",requestHash:"c".repeat(64),displayName:"합성 참여자",comment:null,submittedAt:now.toISOString(),...score},now.toISOString());
 return {...f,sessionHash};
}
async function start(id:string,levels:("child"|"adult")[]=["child"],date=now) {
 const view=await readProblemCorrection(db,id,date);
 return problemViewSchema.parse(await executeProblemCorrection(db,id,{action:"start",requestKey:crypto.randomUUID(),expectedCycle:view.cycle,expectedVariants:view.variants,levels,reason:"문제 의미 오류 확인",notice:"문제를 수정하고 있습니다."},actor,date));
}
async function act(id:string,v:ProblemView,action:string,fields:object={},date=now,database=db) {
 return problemViewSchema.parse(await executeProblemCorrection(database,id,{action,requestKey:crypto.randomUUID(),sessionId:v.editor!.sessionId,expectedRevision:v.editor!.revision,...fields},actor,date));
}
async function reviewed(id:string,v:ProblemView,date=now) {
 for(const area of ["summary","child","adult"]) v=await act(id,v,"review",{area,confirmed:true},date);
 return v;
}
describe("P5-61 problem correction",()=>{
 it("pauses, checks, replaces one level, preserves previous submissions and permits a new submission",async()=>{
 const f=await submitted(),before=await db.prepare("SELECT * FROM submissions WHERE quiz_variant_id=?").bind(f.id+"-child").all();
 const oldSolutions=await db.prepare("SELECT * FROM quiz_solutions WHERE quiz_variant_id IN (?,?) ORDER BY quiz_variant_id").bind(f.id+"-child",f.id+"-adult").all();
 let v=await start(f.id);expect(v.status).toBe("editing");expect(v.impact[1]?.visible ?? v.impact[0]?.visible).toBe(1);
 expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz?.acceptingSubmissions).toBe(false);
 await expect(db.prepare("UPDATE quiz_sets SET submission_state='open' WHERE id=?").bind(f.id).run()).rejects.toThrow();
 await expect(act(f.id,v,"publish",{confirmation:"publish"})).rejects.toThrow();
 const content=structuredClone(v.editor!.body!.content);content.child[0]!.clue="사람이 확인한 새 단서";content.child[0]!.evidence="의미를 직접 확인함";
 v=await act(f.id,v,"save",{content});v=await reviewed(f.id,v);v=await act(f.id,v,"publish",{confirmation:"publish"});
 expect(v.status).toBe("published");expect(v.closesAt).toBe("2026-09-28T00:00:00.000Z");
 const q=(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz!;
 expect(q.variant.revision).toBe(2);expect(q.acceptingSubmissions).toBe(true);expect(q.submissionCount).toBe(0);
 expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"adult",now)).quiz?.variant.id).toBe(f.id+"-adult");
 expect((await db.prepare("SELECT * FROM submissions WHERE quiz_variant_id=?").bind(f.id+"-child").all()).results).toEqual(before.results);
 expect((await db.prepare("SELECT * FROM quiz_solutions WHERE quiz_variant_id IN (?,?) ORDER BY quiz_variant_id").bind(f.id+"-child",f.id+"-adult").all()).results).toEqual(oldSolutions.results);
 expect(await db.prepare("SELECT lifecycle_status,results_status FROM quiz_variants WHERE id=?").bind(f.id+"-child").first()).toEqual({lifecycle_status:"superseded",results_status:"invalidated"});
 });
 it("publishes a non-ranked archive when the deadline passes during correction",async()=>{
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);
 v=await act(f.id,v,"publish",{confirmation:"publish"},new Date("2026-09-29T00:00:00.000Z"));
 expect(v.nonRanked).toBe(true);expect(v.status).toBe("published");
 const q=(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",new Date("2026-09-29T00:00:00.000Z"))).quiz!;
 expect(q.mode).toBe("practice");expect(q.acceptingSubmissions).toBe(false);
 expect(await db.prepare("SELECT count(*) n FROM leaderboard_snapshots WHERE quiz_variant_id=?").bind(f.id+"-child").first()).toEqual({n:1});
 });
});

it("requires a historical success including hidden/deleted, preserves scope, and explicitly cancels without changing a variant",async()=>{
 const empty=await fixture();await expect(start(empty.id)).rejects.toThrow();
 for(const state of ["visible","hidden","deleted"]) {
  const f=await submitted();
  if(state==="hidden") await db.prepare("UPDATE submissions SET status='hidden',hidden_at=? WHERE quiz_variant_id=?").bind(at,f.id+"-child").run();
  if(state==="deleted") await createSubmissionRepository(createDatabase(db)).deleteOwnSubmission(f.id+"-child",1,f.sessionHash,now.toISOString(),crypto.randomUUID());
  const before=(await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(f.id).all()).results;
  let v=await start(f.id);const content=structuredClone(v.editor!.body!.content);content.adult[0]!.clue="범위 밖 수정";
  await expect(act(f.id,v,"save",{content})).rejects.toThrow();
  const cancel={action:"cancel",sessionId:v.editor!.sessionId,expectedRevision:v.editor!.revision,requestKey:crypto.randomUUID(),reason:"의미 오류가 아님을 확인",confirmation:"not_an_error_resume"};
  v=problemViewSchema.parse(await executeProblemCorrection(db,f.id,cancel,actor,now));expect(v.status).toBe("cancelled");
  expect(await executeProblemCorrection(db,f.id,cancel,actor,now)).toEqual(v);
  expect((await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(f.id).all()).results).toEqual(before);
  expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz?.acceptingSubmissions).toBe(true);
 }
});
it("rolls back a failed audit/publication and serializes competing draft writes without losing pause",async()=>{
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);
 const before=(await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(f.id).all()).results;
 await db.prepare("CREATE TRIGGER synthetic_problem_audit BEFORE INSERT ON audit_logs WHEN NEW.action='problem_publish' BEGIN SELECT RAISE(ABORT,'synthetic'); END").run();
 try {await expect(act(f.id,v,"publish",{confirmation:"publish"})).rejects.toThrow();} finally {await db.prepare("DROP TRIGGER synthetic_problem_audit").run();}
 expect((await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(f.id).all()).results).toEqual(before);
 expect((await readProblemCorrection(db,f.id,now)).status).toBe("editing");
 const race=new Proxy(db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{await act(f.id,v,"save",{content:v.editor!.body!.content});return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 await expect(act(f.id,v,"publish",{confirmation:"publish"},now,race)).rejects.toThrow();
 expect((await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(f.id).all()).results).toEqual(before);
 expect((await readProblemCorrection(db,f.id,now)).editor!.canPublish).toBe(false);
});
it("retains original owner results across replacement, denies other sessions and allows a fresh submission",async()=>{
 const {readProblemHistory}=await import("../_shared/services/problem-history");
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"});
 const history=await readProblemHistory(db,f.slug,"child",f.sessionHash,now.toISOString());
 expect(history.items).toHaveLength(1);expect(history.items[0]!.submission.quizRevision).toBe(1);
 expect(JSON.stringify(history)).not.toMatch(/sessionHash|requestHash|actor|SYNTHETIC_PRIVATE_GROUNDING|합성 참여자/u);
 expect(await readProblemHistory(db,f.slug,"child","f".repeat(64),now.toISOString())).toEqual({items:[]});
 expect(await readProblemHistory(db,f.slug,"adult",f.sessionHash,now.toISOString())).toEqual({items:[]});
 const repository=createSubmissionRepository(createDatabase(db)),q=(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz!;
 const solution=await repository.findScoringSolution(q.variant.id),score=scoreSubmission({grid:q.variant.grid,...solution!},{[q.variant.grid.cells[0]!.id]:"가"});
 const saved=await repository.saveSubmission({id:crypto.randomUUID(),quizVariantId:q.variant.id,quizRevision:q.variant.revision,sessionHash:f.sessionHash,idempotencyKey:"01924f8e-7b2a-7f1c-8f3a-123456789abd",requestHash:"d".repeat(64),displayName:"새 합성",comment:null,submittedAt:now.toISOString(),...score},now.toISOString());
 expect(saved.outcome).toBe("inserted");
 await repository.deleteOwnSubmission(f.id+"-child",1,f.sessionHash,now.toISOString(),crypto.randomUUID());
 const deleted=await readProblemHistory(db,f.slug,"child",f.sessionHash,now.toISOString());expect(deleted.items[0]!.submission.status).toBe("deleted");expect(deleted.items[0]!.grid).toBeNull();expect(JSON.stringify(deleted)).not.toMatch(/answers|solution/u);
 expect(await repository.findSubmission(q.variant.id,f.sessionHash)).toBeDefined();
});
it("cleans only expired editable bodies, keeps pause/source/results, and starts a new explicit cycle",async()=>{
 const {purgeExpiredDraft,listDraftCleanup}=await import("../_shared/services/draft-cleanup");
 const f=await submitted();let v=await start(f.id);
 const source=await db.prepare("SELECT * FROM quiz_problem_cases WHERE id=?").bind(v.editor!.sessionId).first();
 const before=(await db.prepare("SELECT * FROM submissions WHERE quiz_variant_id=?").bind(f.id+"-child").all()).results;
 expect(await purgeExpiredDraft(db,f.sermonId,"2026-09-30T23:59:59.999Z")).toEqual({outcome:"not_due"});
 expect((await listDraftCleanup(db,"2026-09-30T00:00:00.000Z")).items.find(i=>i.sermonId===f.sermonId)?.state).toBe("scheduled");
 expect(await purgeExpiredDraft(db,f.sermonId,"2026-10-01T00:00:00.000Z")).toEqual({outcome:"purged"});
 expect((await readProblemCorrection(db,f.id,now)).status).toBe("expired");
 expect(await db.prepare("SELECT * FROM quiz_problem_cases WHERE id=?").bind(v.editor!.sessionId).first()).toEqual(source);
 expect((await db.prepare("SELECT * FROM submissions WHERE quiz_variant_id=?").bind(f.id+"-child").all()).results).toEqual(before);
 await expect(act(f.id,v,"save",{content:v.editor!.body!.content})).rejects.toThrow();
 v=await start(f.id,["child"],new Date("2026-10-02T00:00:00.000Z"));expect(v.cycle).toBe(2);expect(v.nonRanked).toBe(true);
 const restore=db.prepare("UPDATE quiz_problem_drafts SET body_json='{}' WHERE case_id=?").bind(source!.id);
 await expect(restore.run()).rejects.toThrow();
});
it("protects the complete API with Access, same-origin strict JSON, no-store and method boundaries",async()=>{
 const {exports}=await import("cloudflare:workers"),{createAccessFixture}=await import("./test/access-fixture");
 const f=await submitted(),url=`https://example.com/api/admin/quiz-sets/${f.id}/problem-corrections`;
 expect((await exports.default.fetch(new Request(url))).status).toBe(401);
 const access=await createAccessFixture(new Date());vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json(access.jwks));
 const headers={"Cf-Access-Jwt-Assertion":access.token,Origin:"https://example.com","Content-Type":"application/json"};
 const v=await readProblemCorrection(db,f.id),command={action:"start",requestKey:crypto.randomUUID(),expectedCycle:0,expectedVariants:v.variants,levels:["child"],reason:"오류 확인",notice:"잠시 중지"};
 for(const [method,target,body,origin,status] of [["POST",url,command,"https://bad.invalid",403],["DELETE",url,undefined,"https://example.com",405],["GET",url+"?x=1",undefined,"https://example.com",409],["POST",url,{...command,private:"PRIVATE_CANARY"},"https://example.com",409]] as const) {
  const r=await exports.default.fetch(new Request(target,{method,headers:{...headers,Origin:origin},...(body?{body:JSON.stringify(body)}:{})}));expect(r.status).toBe(status);expect(r.headers.get("Cache-Control")).toBe("private, no-store");expect(await r.text()).not.toMatch(/PRIVATE_CANARY|SELECT|D1_ERROR/u);
 }
 const r=await exports.default.fetch(new Request(url,{method:"POST",headers,body:JSON.stringify(command)}));expect(r.status).toBe(200);expect(problemViewSchema.parse((await r.json() as {data:unknown}).data).status).toBe("editing");
});
it("serves old results only to their exact owner and deletes them without touching the replacement",async()=>{
 const {exports,env}=await import("cloudflare:workers"),{generateSessionToken,hashSessionToken}=await import("../_shared/services/session");
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"});
 const token=generateSessionToken(),sessionHash=await hashSessionToken(token,(env as Env & {SESSION_PEPPER:string}).SESSION_PEPPER);
 await db.prepare("INSERT INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(sessionHash,publishedAt,publishedAt).run();
 await db.prepare("UPDATE submissions SET session_hash=? WHERE quiz_variant_id=?").bind(sessionHash,f.id+"-child").run();
 const url=`https://example.com/api/quizzes/${f.slug}/child/problem-history`;
 for(const cookie of ["",`__Host-bq_session=${generateSessionToken()}`]) {
  const r=await exports.default.fetch(new Request(url,{headers:{Cookie:cookie}}));expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{items:[]}});
 }
 const headers={Cookie:`__Host-bq_session=${token}`};
 const r=await exports.default.fetch(new Request(url,{headers}));expect(r.status).toBe(200);expect(r.headers.get("Cache-Control")).toBe("private, no-store");
 const text=await r.text();expect(text).toContain('"quizRevision":1');expect(text).not.toMatch(/SYNTHETIC_PRIVATE|session_hash|actor|합성 참여자/u);
 const wrong=await exports.default.fetch(new Request(url.replace("/child/","/adult/"),{headers}));expect(await wrong.json()).toEqual({data:{items:[]}});
 const denied=await exports.default.fetch(new Request(url+`/${f.id}-child`,{method:"DELETE",headers:{...headers,Origin:"https://bad.invalid","Content-Type":"application/json"},body:"{}"}));expect(denied.status).toBe(403);
 const deleted=await exports.default.fetch(new Request(url+`/${f.id}-child`,{method:"DELETE",headers:{...headers,Origin:"https://example.com","Content-Type":"application/json"},body:"{}"}));expect(deleted.status).toBe(200);
 const after=await exports.default.fetch(new Request(url,{headers}));const body=await after.text();expect(body).toContain('"status":"deleted"');expect(body).not.toMatch(/answers|solution/u);
});
it("corrects both levels and shared content, preserves display ordering, and supports another correction cycle",async()=>{
 const {readPublishedDisplayText,correctPublishedDisplayText}=await import("../_shared/services/published-display-text");
 const {readProblemRecords}=await import("../_shared/services/problem-correction");
 const f=await submitted();let v=await start(f.id,["child","adult"]);const content=structuredClone(v.editor!.body!.content);
 content.metadata.title="두 난이도 수정 제목";content.summary="사람이 확인한 요약";
 v=await act(f.id,v,"save",{content});v=await reviewed(f.id,v);
 const command={action:"publish",requestKey:crypto.randomUUID(),sessionId:v.editor!.sessionId,expectedRevision:v.editor!.revision,confirmation:"publish"};
 const published=await executeProblemCorrection(db,f.id,command,actor,now);expect(await executeProblemCorrection(db,f.id,command,actor,now)).toEqual(published);
 expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"adult",now)).quiz?.sermon.summary?.text).toBe(content.summary);
 const display=await readPublishedDisplayText(db,f.id);expect(display.quiz.metadata.title).toBe(content.metadata.title);
 await correctPublishedDisplayText(db,f.id,{requestKey:crypto.randomUUID(),expectedRevision:0,before:display.quiz.metadata,after:{...display.quiz.metadata,title:"수정본 표시 정정"},reason:"오탈자 정정"},actor,now);
 v=await start(f.id,["adult"]);expect(v.editor!.body!.content.metadata.title).toBe("수정본 표시 정정");
 v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"});
 expect((await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"adult",now)).quiz?.variant.revision).toBe(3);
 const records=await readProblemRecords(db,f.id);expect(records.items).toHaveLength(2);expect(records.items[1]!.source.content.metadata.title).toBe("TEST_ONLY_PUBLIC_ORIGINAL");
});
it("rejects cleanup/save races and late publication after a display change",async()=>{
 const {purgeExpiredDraft}=await import("../_shared/services/draft-cleanup");
 const {readPublishedDisplayText,correctPublishedDisplayText}=await import("../_shared/services/published-display-text");
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);
 const proxy=new Proxy(db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{await act(f.id,v,"save",{content:v.editor!.body!.content},new Date("2026-09-30T00:00:00.000Z"));return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 await expect(purgeExpiredDraft(proxy,f.sermonId,"2026-10-01T00:00:00.000Z")).rejects.toThrow();
 v=await readProblemCorrection(db,f.id,now);expect(v.status).toBe("editing");
 v=await reviewed(f.id,v,new Date("2026-09-30T00:00:00.000Z"));
 const display=await readPublishedDisplayText(db,f.id);
 await correctPublishedDisplayText(db,f.id,{requestKey:crypto.randomUUID(),expectedRevision:0,before:display.quiz.metadata,after:{...display.quiz.metadata,title:"다른 관리자 정정"},reason:"제목 오탈자"},actor,new Date("2026-09-30T00:00:00.000Z"));
 await expect(act(f.id,v,"publish",{confirmation:"publish"},new Date("2026-09-30T00:00:00.000Z"))).rejects.toThrow();
 expect((await db.prepare("SELECT submission_state FROM quiz_sets WHERE id=?").bind(f.id).first())?.submission_state).toBe("paused");
});
it("switches to a non-ranked correction after the existing close-now action changes the deadline",async()=>{
 const {createQuizFinalizationService}=await import("../_shared/services/quiz-finalization");
 const f=await submitted();let v=await start(f.id);v=await reviewed(f.id,v);
 const closedAt=new Date("2026-09-25T00:00:00.000Z");
 await createQuizFinalizationService(createDatabase(db)).closeQuizSetNow(f.id,{actorEmail:actor,auditId:crypto.randomUUID(),reason:"당시 마감 확인"},closedAt);
 const snapshots=(await db.prepare("SELECT l.* FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=? ORDER BY l.id").bind(f.id).all()).results;
 v=await act(f.id,v,"publish",{confirmation:"publish"},closedAt);
 expect(v.status).toBe("published");expect(v.nonRanked).toBe(true);expect(v.closesAt).toBe(closedAt.toISOString());
 expect((await db.prepare("SELECT l.* FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=? ORDER BY l.id").bind(f.id).all()).results).toEqual(snapshots);
});
it("does not copy a stale source if display metadata changes between source capture and revision lookup",async()=>{
 const {readPublishedDisplayText,correctPublishedDisplayText}=await import("../_shared/services/published-display-text");
 const f=await submitted(),view=await readProblemCorrection(db,f.id,now),display=await readPublishedDisplayText(db,f.id);
 const proxy=new Proxy(db,{get(target,key){
  if(key==="prepare")return (sql:string)=>{
   const statement=target.prepare(sql);
   if(!sql.startsWith("SELECT coalesce(max(revision),0) revision FROM published_display_corrections"))return statement;
   return new Proxy(statement,{get(st,k){if(k==="bind")return (...args:unknown[])=>{
    const bound=st.bind(...args);
    return new Proxy(bound,{get(b,method){if(method==="first")return async()=>{
     await correctPublishedDisplayText(db,f.id,{requestKey:crypto.randomUUID(),expectedRevision:0,before:display.quiz.metadata,after:{...display.quiz.metadata,title:"동시에 정정된 제목"},reason:"동시 표시 정정"},actor,now);
     return b.first();
    };const value=Reflect.get(b,method);return typeof value==="function"?value.bind(b):value;}});
   };const value=Reflect.get(st,k);return typeof value==="function"?value.bind(st):value;}});
  };
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(executeProblemCorrection(proxy,f.id,{action:"start",requestKey:crypto.randomUUID(),expectedCycle:view.cycle,expectedVariants:view.variants,levels:["child"],reason:"의미 오류 확인",notice:"문제 확인 중"},actor,now)).rejects.toThrow();
 expect((await readPublishedDisplayText(db,f.id)).quiz.metadata.title).toBe("동시에 정정된 제목");
 expect((await readProblemCorrection(db,f.id,now)).status).toBe("ready");
 expect((await db.prepare("SELECT submission_state FROM quiz_sets WHERE id=?").bind(f.id).first())?.submission_state).toBe("open");
});
