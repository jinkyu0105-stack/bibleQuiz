import { readPublishedWording, correctPublishedWording } from "../_shared/services/published-wording";
import { createQuizFinalizationService } from "../_shared/services/quiz-finalization";
import { exports } from "cloudflare:workers";
import { createAccessFixture } from "./test/access-fixture";
import { afterEach,describe,it,expect,vi } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createDatabase } from "../_shared/db/client";
import { generatePuzzle,PUZZLE_FIXTURES,serializePublicPuzzle,cellId } from "../../shared/puzzle";
import { withdrawPublishedQuiz, readWithdrawalReview } from "../_shared/services/quiz-withdrawal";
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
async function command(id:string,target="summary") {
 const view=await readPublishedWording(db,id),t=view.targets.find(t=>t.target===target)!;
 return {requestKey:crypto.randomUUID(),expectedRevision:view.revision,contentRevision:view.contentRevision,target,before:t.text,after:t.text+".",
 assessment:"non_semantic_typo",confirmation:"meaning_and_answer_unchanged",reason:"문장부호 오탈자 정정"};
}
const rows=async(sql:string,...args:string[])=>(await db.prepare(sql).bind(...args).all()).results;
async function protectedRows() {
 const tables=await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name NOT IN ('published_wording_corrections','audit_logs') ORDER BY name");
 return Promise.all(tables.map(t=>rows(`SELECT * FROM ${t.name} ORDER BY 1`)));
}
describe("P5-62 display-only wording",()=>{
 it.each([false,true])("preserves all original rows, answers and scores while changing public summary/clues (archive=%s)",async archive=>{
  const f=await submitted();
  if(archive) await createQuizFinalizationService(createDatabase(db)).finalizeDueQuizSet(f.id,new Date("2026-09-29T00:00:00.000Z"));
  const before=await protectedRows();
  const repo=createPublicQuizRepository(createDatabase(db));
  const old=(await repo.read({slug:f.slug},"child",now)).quiz!;
  for(const target of ["summary",f.entryId,`${f.id}-adult-${grid.entries[0]!.id}`]) {
   const cmd=await command(f.id,target);
   expect(await correctPublishedWording(db,f.id,cmd,actor,now)).toMatchObject({outcome:"changed"});
  }
  const current=(await repo.read({slug:f.slug},"child",now)).quiz!;
  expect(current.sermon.summary!.text).toBe(old.sermon.summary!.text+".");
  expect(current.variant.grid.entries[0]!.clue).toBe(old.variant.grid.entries[0]!.clue+".");
  expect({...current,sermon:old.sermon,variant:old.variant}).toEqual(old);
  expect({...current.variant,grid:old.variant.grid}).toEqual(old.variant);
  expect(await protectedRows()).toEqual(before);
  const view=await readPublishedWording(db,f.id);expect(view.history).toHaveLength(3);
  expect(JSON.stringify(view)).not.toMatch(/actor|digest|requestKey|SYNTHETIC_PRIVATE|solution|entryAnswers|sessionHash/u);
  expect(JSON.stringify(current)).not.toMatch(/SYNTHETIC_PRIVATE|solutionCells|actor_digest/u);
  const audits=await rows("SELECT * FROM audit_logs WHERE entity_id=? AND action='published_wording_corrected'",f.id);
  expect(audits).toHaveLength(3);expect(JSON.parse(audits[0]!.safe_metadata_json as string)).toMatchObject({before:"합성 요약",after:"합성 요약.",confirmation:"meaning_and_answer_unchanged"});
  for(const sql of ["UPDATE published_wording_corrections SET after_text='bad' WHERE quiz_set_id=?","DELETE FROM published_wording_corrections WHERE quiz_set_id=?"])
   await expect(db.prepare(sql).bind(f.id).run()).rejects.toThrow();
 });
 it("replays only exact requests, rejects stale heads/values/versions/foreign targets and admits one concurrent writer",async()=>{
  const f=await fixture(),other=await fixture(),cmd=await command(f.id);
  await correctPublishedWording(db,f.id,cmd,actor,now);
  await correctPublishedWording(db,f.id,await command(f.id,f.entryId),actor,now);
  expect((await correctPublishedWording(db,f.id,cmd,actor,now)).outcome).toBe("replayed");
  for(const change of [{after:"다른 문구"},{reason:"다른 사유"},{contentRevision:1},{target:f.entryId},{expectedRevision:1},{requestKey:crypto.randomUUID()}])
   await expect(correctPublishedWording(db,f.id,{...cmd,...change},actor,now)).rejects.toThrow();
  await expect(correctPublishedWording(db,f.id,cmd,"other@example.invalid",now)).rejects.toThrow();
  const next=await command(f.id);
  for(const change of [{target:other.entryId},{before:"stale"},{contentRevision:99}]) await expect(correctPublishedWording(db,f.id,{...next,...change},actor,now)).rejects.toThrow();
  const settled=await Promise.allSettled([correctPublishedWording(db,f.id,next,actor,now),correctPublishedWording(db,f.id,{...next,requestKey:crypto.randomUUID()},actor,now)]);
  expect(settled.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 });
 it("rolls back the entire change on audit failure and routes semantic/uncertain changes without writes",async()=>{
  const f=await fixture(),cmd=await command(f.id);
  for(const change of [{assessment:"semantic"},{assessment:"uncertain"},{confirmation:undefined},{answer:"정답"},{grid:{}}])
   await expect(correctPublishedWording(db,f.id,{...cmd,...change},actor,now)).rejects.toThrow("SEMANTIC_CORRECTION_REQUIRED");
  for(const change of [{after:cmd.before},{after:"\u0000bad"},{extra:"bad"}]) await expect(correctPublishedWording(db,f.id,{...cmd,...change},actor,now)).rejects.toThrow();
  const clue=await command(f.id,f.entryId);
  for(const after of ["가".repeat(2001),"😀".repeat(1001)]) await expect(correctPublishedWording(db,f.id,{...clue,after},actor,now)).rejects.toThrow();
  await db.exec("CREATE TRIGGER wording_test_fail BEFORE INSERT ON audit_logs WHEN NEW.action='published_wording_corrected' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  try {await expect(correctPublishedWording(db,f.id,cmd,actor,now)).rejects.toThrow();}finally{await db.exec("DROP TRIGGER wording_test_fail");}
  expect((await readPublishedWording(db,f.id)).history).toEqual([]);
 });
 it("carries displayed text into error review, blocks edits while pending, keeps unaffected clues and never revives an old summary overlay",async()=>{
  const f=await submitted();const adult=`${f.id}-adult-${grid.entries[0]!.id}`;
  for(const target of ["summary",f.entryId,adult]) await correctPublishedWording(db,f.id,await command(f.id,target),actor,now);
  const stale=await command(f.id),old=await protectedRows();
  let v=await start(f.id);expect(v.editor!.body!.content.summary).toBe("합성 요약.");
  expect(v.editor!.body!.content.child[0]!.clue).toBe(grid.entries[0]!.clue+".");
  expect((await readPublishedWording(db,f.id)).blocked).toBe(true);
  await expect(correctPublishedWording(db,f.id,stale,actor,now)).rejects.toThrow();
  const content=structuredClone(v.editor!.body!.content);content.child[0]!.clue="수정본 단서";content.child[0]!.evidence="사람 확인";
  v=await act(f.id,v,"save",{content});v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"});
  const view=await readPublishedWording(db,f.id);expect(view.blocked).toBe(false);expect(view.contentRevision).toBe(2);
  expect(view.targets.find(t=>t.target===adult)!.text).toBe(grid.entries[0]!.clue+".");
  expect(view.targets.some(t=>t.target===f.entryId)).toBe(false);
  await expect(correctPublishedWording(db,f.id,{...stale,requestKey:crypto.randomUUID()},actor,now)).rejects.toThrow();
  const summary=await command(f.id);await correctPublishedWording(db,f.id,summary,actor,now);
  v=await start(f.id,["child","adult"]);const next=structuredClone(v.editor!.body!.content);next.summary="새 의미 요약";
  v=await act(f.id,v,"save",{content:next});v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"});
  expect((await readPublishedWording(db,f.id)).targets.find(t=>t.target==="summary")!.text).toBe("새 의미 요약");
  expect(old.length).toBeGreaterThan(70);
  expect(await rows("SELECT revision FROM published_wording_corrections WHERE quiz_set_id=?",f.id)).toHaveLength(4);
 });
 it("carries corrections through withdrawal and refuses stale saves during review",async()=>{
  const f=await fixture();
  for(const target of ["summary",f.entryId]) await correctPublishedWording(db,f.id,await command(f.id,target),actor,now);
  const cmd=await command(f.id);
  await withdrawPublishedQuiz(db,f.id,{requestKey:crypto.randomUUID(),expectedPublishedAt:publishedAt,expectedDisplayRevision:0,reason:"합성 철회",confirmation:"withdraw"},actor,now);
  const view=await readWithdrawalReview(db,f.id);expect(view.review.summary).toBe("합성 요약.");expect(view.review.variants.find(v=>v.difficulty==="child")!.entries[0]!.clue).toBe(grid.entries[0]!.clue+".");
  await expect(correctPublishedWording(db,f.id,cmd,actor,now)).rejects.toThrow();
 });
 it("keeps HTTP auth/origin/strict/method/no-store boundaries and never calls a provider",async()=>{
  const f=await fixture(),url=`https://example.com/api/admin/quiz-sets/${f.id}/display-text/wording`,cmd=await command(f.id);
  for(const method of ["GET","PATCH","DELETE"]) expect((await exports.default.fetch(new Request(url,{method}))).status).toBe(401);
  const access=await createAccessFixture(new Date()),fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json(access.jwks));
  const headers={"Cf-Access-Jwt-Assertion":access.token,Origin:"https://example.com","Content-Type":"application/json"};
  const send=(method:string,body?:unknown,suffix="",origin="https://example.com")=>exports.default.fetch(new Request(url+suffix,{method,headers:{...headers,Origin:origin},...(body?{body:JSON.stringify(body)}:{})}));
  expect((await send("PATCH",cmd,"","https://foreign.invalid")).status).toBe(403);
  expect((await send("GET",undefined,"?extra=1")).status).toBe(409);expect((await send("DELETE")).status).toBe(405);
  const semantic=await send("PATCH",{...cmd,assessment:"semantic"});expect(semantic.status).toBe(409);expect(await semantic.json()).toMatchObject({error:{code:"SEMANTIC_CORRECTION_REQUIRED"}});
  const saved=await send("PATCH",cmd);expect(saved.status).toBe(200);expect(saved.headers.get("Cache-Control")).toBe("private, no-store");
  const read=await send("GET");expect(read.status).toBe(200);expect(read.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await read.text()).not.toMatch(/actor_digest|request_key|SYNTHETIC_PRIVATE|solutionCells/u);
  expect(fetcher.mock.calls.every(([url])=>String(url).includes("cloudflareaccess.com"))).toBe(true);
 });
});

it("rejects an error-review source captured before a concurrent wording correction",async()=>{
 const f=await submitted(),view=await readProblemCorrection(db,f.id,now),cmd=await command(f.id);
 const proxy=new Proxy(db,{get(target,key){
  if(key==="batch")return async(statements:D1PreparedStatement[])=>{await correctPublishedWording(db,f.id,cmd,actor,now);return target.batch(statements);};
  const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
 }});
 await expect(executeProblemCorrection(proxy,f.id,{action:"start",requestKey:crypto.randomUUID(),expectedCycle:view.cycle,expectedVariants:view.variants,levels:["child"],reason:"의미 오류 확인",notice:"문제 확인 중"},actor,now)).rejects.toThrow();
 expect((await readProblemCorrection(db,f.id,now)).status).toBe("ready");
 expect((await readPublishedWording(db,f.id)).targets.find(t=>t.target==="summary")!.text).toBe(cmd.after);
});
it("rejects wording that races a newly started error case, while preserving hidden and deleted submissions",async()=>{
 for(const status of ["hidden","deleted"]) {
  const f=await submitted();
  if(status==="hidden") await db.prepare("UPDATE submissions SET status='hidden',hidden_at=? WHERE quiz_variant_id=?").bind(at,f.id+"-child").run();
  else await createSubmissionRepository(createDatabase(db)).deleteOwnSubmission(f.id+"-child",1,f.sessionHash,now.toISOString(),crypto.randomUUID());
  const original=await rows("SELECT * FROM submissions WHERE quiz_variant_id=?",f.id+"-child");
  const cmd=await command(f.id);
  const proxy=new Proxy(db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{await start(f.id);return target.batch(statements);};
   const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  await expect(correctPublishedWording(proxy,f.id,cmd,actor,now)).rejects.toThrow();
  expect((await readPublishedWording(db,f.id)).history).toEqual([]);
  expect(await rows("SELECT * FROM submissions WHERE quiz_variant_id=?",f.id+"-child")).toEqual(original);
 }
});
