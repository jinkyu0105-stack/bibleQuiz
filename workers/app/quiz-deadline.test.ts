import { readQuizDeadline, previewQuizDeadline, changeQuizDeadline } from "../_shared/services/quiz-deadline";
import { env } from "cloudflare:workers";
import { createQuizFinalizationService } from "../_shared/services/quiz-finalization";
import { exports } from "cloudflare:workers";
import { createAccessFixture } from "./test/access-fixture";
import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
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
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
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
 const score=scoreSubmission({grid:quiz.variant.grid,...source!},source!.solution.cells);
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
const secret=(env as unknown as {SESSION_PEPPER:string}).SESSION_PEPPER;
const rows=async(sql:string,...args:string[])=>(await db.prepare(sql).bind(...args).all()).results;
const proposal={closesAt:"2026-09-30T00:00:00.000Z",reason:"참여 시간 조정"};
async function command(id:string,closesAt=proposal.closesAt,date=now) {
 const p=await previewQuizDeadline(db,id,{...proposal,closesAt},actor,secret,date);
 return {...proposal,closesAt,requestKey:crypto.randomUUID(),confirmationToken:p.confirmationToken,confirmation:p.immediate?"close_now":"change_deadline"};
}
async function protectedRows(excludeSnapshots=false) {
 const tables=await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name NOT IN ('quiz_sets','audit_logs') ORDER BY name");
 return Promise.all(tables.filter(t=>!excludeSnapshots || !String(t.name).startsWith('leaderboard_snapshot')).map(async t=>({name:t.name,rows:await rows(`SELECT * FROM ${t.name} ORDER BY 1`)})));
}
function withBeforeBatch(fn:()=>Promise<unknown>) {
 return new Proxy(db,{get(target,key){if(key==="batch")return async(s:D1PreparedStatement[])=>{await fn();return target.batch(s);};const v=Reflect.get(target,key);return typeof v==="function"?v.bind(target):v;}});
}
describe("P5-63 confirmed deadline change",()=>{
 it("previews without writes and preserves every protected table, other set and original publication times on extension and shortening",async()=>{
  const f=await submitted(),other=await fixture(),before=await protectedRows(),sets=await rows("SELECT * FROM quiz_sets WHERE id IN (?,?) ORDER BY id",f.id,other.id);
  const audit=await rows("SELECT * FROM audit_logs ORDER BY id");
  const p=await previewQuizDeadline(db,f.id,proposal,actor,secret,now);
  expect(p.impact).toMatchObject({total:1,visible:1});expect(p.requestedKst).toContain("9");expect(p.immediate).toBe(false);
  expect(await rows("SELECT * FROM audit_logs ORDER BY id")).toEqual(audit);
  for(const deadline of [proposal.closesAt,"2026-09-25T00:00:00.000Z"]) {
   expect(await changeQuizDeadline(db,f.id,await command(f.id,deadline),actor,secret,now)).toMatchObject({outcome:"changed",closesAt:deadline,archived:false});
   expect(await protectedRows()).toEqual(before);
  }
  const current=await rows("SELECT * FROM quiz_sets WHERE id IN (?,?) ORDER BY id",f.id,other.id);
  expect(current.map(s=>s.id===f.id?{...s,closes_at:sets.find(x=>x.id===f.id)!.closes_at,updated_at:sets.find(x=>x.id===f.id)!.updated_at}:s)).toEqual(sets);
  expect((await readQuizDeadline(db,f.id,now)).history).toHaveLength(2);
  expect(JSON.stringify(await readQuizDeadline(db,f.id,now))).not.toMatch(/actor|requestHash|solution|PRIVATE|sessionHash/u);
 });
 it("replays exact requests after later changes, and rejects altered token/actor/reason/time/key and duplicate racing mutations",async()=>{
  const f=await submitted(),cmd=await command(f.id);
  for(const c of [{...cmd,confirmationToken:cmd.confirmationToken+'x'},{...cmd,reason:"다른 사유"},{...cmd,closesAt:"2026-10-01T00:00:00.000Z"},{...cmd,confirmation:"close_now"},{...cmd,extra:true}])
   await expect(changeQuizDeadline(db,f.id,c,actor,secret,now)).rejects.toThrow();
  await expect(changeQuizDeadline(db,f.id,cmd,"other@example.invalid",secret,now)).rejects.toThrow();
  const rival={...cmd,requestKey:crypto.randomUUID()};
  const results=await Promise.allSettled([changeQuizDeadline(db,f.id,cmd,actor,secret,now),changeQuizDeadline(db,f.id,rival,actor,secret,now)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const accepted=results[0]!.status==="fulfilled"?cmd:rival;
  {
   await changeQuizDeadline(db,f.id,await command(f.id,"2026-09-29T00:00:00.000Z"),actor,secret,now);
   expect((await changeQuizDeadline(db,f.id,accepted,actor,secret,now)).outcome).toBe("replayed");
   expect((await readQuizDeadline(db,f.id,now)).closesAt).toBe("2026-09-29T00:00:00.000Z");
  }
 });
 it("uses finalization for past dates without removing old submissions and never reopens archived or elapsed sets",async()=>{
  const f=await submitted(),before=await protectedRows(true),cmd=await command(f.id,"2026-09-01T00:00:00.000Z");
  expect(await changeQuizDeadline(db,f.id,cmd,actor,secret,now)).toMatchObject({archived:true,closesAt:now.toISOString()});
  expect(await protectedRows(true)).toEqual(before);
  expect(await rows("SELECT * FROM leaderboard_snapshots WHERE quiz_variant_id IN (?,?)",f.id+'-child',f.id+'-adult')).toHaveLength(2);
  const snapshots=await rows("SELECT * FROM leaderboard_snapshot_entries ORDER BY 1,2");
  expect(await rows("SELECT e.rank FROM leaderboard_snapshot_entries e JOIN leaderboard_snapshots l ON l.id=e.snapshot_id WHERE l.quiz_variant_id=?",f.id+"-child")).toEqual([{rank:1}]);
  expect((await changeQuizDeadline(db,f.id,cmd,actor,secret,now)).outcome).toBe("replayed");
  expect(await rows("SELECT * FROM leaderboard_snapshot_entries ORDER BY 1,2")).toEqual(snapshots);
  expect((await readQuizDeadline(db,f.id,now)).changeable).toBe(false);
  await expect(command(f.id)).rejects.toThrow();
  const elapsed=await fixture(),stale=await command(elapsed.id);
  await expect(changeQuizDeadline(db,elapsed.id,stale,actor,secret,new Date("2026-09-28T00:00:00.000Z"))).rejects.toThrow();
  await expect(command(elapsed.id,proposal.closesAt,new Date("2026-09-28T00:00:00.000Z"))).rejects.toThrow();
  const crossing=await fixture(),future=await command(crossing.id,"2026-09-24T00:00:01.000Z");
  await expect(changeQuizDeadline(db,crossing.id,future,actor,secret,new Date("2026-09-24T00:00:02.000Z"))).rejects.toThrow();
 });
 it.each([false,true])("rolls back deadline, snapshots and audit on an audit failure (immediate=%s)",async immediate=>{
  const f=await submitted(),cmd=await command(f.id,immediate?"2026-09-01T00:00:00.000Z":proposal.closesAt),before=await rows("SELECT * FROM quiz_sets WHERE id=?",f.id),protectedBefore=await protectedRows();
  await db.exec("CREATE TRIGGER deadline_test_fail BEFORE INSERT ON audit_logs WHEN NEW.action IN ('deadline_changed','close_now') BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  try {await expect(changeQuizDeadline(db,f.id,cmd,actor,secret,now)).rejects.toThrow();}finally{await db.exec("DROP TRIGGER deadline_test_fail");}
  expect(await rows("SELECT * FROM quiz_sets WHERE id=?",f.id)).toEqual(before);expect(await protectedRows()).toEqual(protectedBefore);expect((await readQuizDeadline(db,f.id,now)).history).toEqual([]);
 });
 it("rejects submission/moderation/error-start changes at commit and preserves hidden/deleted records",async()=>{
  for(const status of ["hidden","deleted"] as const) {
   const f=await submitted(),cmd=await command(f.id);
   const change=async()=>status==="hidden"?db.prepare("UPDATE submissions SET status='hidden',hidden_at=? WHERE quiz_variant_id=?").bind(at,f.id+'-child').run():createSubmissionRepository(createDatabase(db)).deleteOwnSubmission(f.id+'-child',1,f.sessionHash,now.toISOString(),crypto.randomUUID());
   await expect(changeQuizDeadline(withBeforeBatch(change),f.id,cmd,actor,secret,now)).rejects.toThrow();
   const before=await protectedRows();
   await changeQuizDeadline(db,f.id,await command(f.id),actor,secret,now);expect(await protectedRows()).toEqual(before);
   expect((await readQuizDeadline(db,f.id,now)).impact[status]).toBe(1);
  }
  const f=await submitted(),cmd=await command(f.id);
  await expect(changeQuizDeadline(withBeforeBatch(()=>start(f.id)),f.id,cmd,actor,secret,now)).rejects.toThrow();
  expect((await readQuizDeadline(db,f.id,now)).history).toHaveLength(0);
 });
 it("keeps an error case paused, its captured deadline immutable and uses the new deadline when publishing its correction",async()=>{
  const f=await submitted();let v=await start(f.id);const cases=await rows("SELECT * FROM quiz_problem_cases WHERE quiz_set_id=?",f.id);
  await changeQuizDeadline(db,f.id,await command(f.id),actor,secret,now);
  expect((await readQuizDeadline(db,f.id,now)).paused).toBe(true);expect(await rows("SELECT * FROM quiz_problem_cases WHERE quiz_set_id=?",f.id)).toEqual(cases);
  v=await reviewed(f.id,v);await act(f.id,v,"publish",{confirmation:"publish"},new Date("2026-09-29T00:00:00.000Z"));
  expect((await readProblemCorrection(db,f.id,new Date("2026-09-29T00:00:00.000Z"))).nonRanked).toBe(false);
  expect((await readQuizDeadline(db,f.id,now)).closesAt).toBe(proposal.closesAt);
 });
 it("atomically rejects stale immediate confirmation when another writer extends the deadline",async()=>{
  const f=await submitted(),cmd=await command(f.id,"2026-09-01T00:00:00.000Z"),extension=await command(f.id);
  await expect(changeQuizDeadline(withBeforeBatch(()=>changeQuizDeadline(db,f.id,extension,actor,secret,now)),f.id,cmd,actor,secret,now)).rejects.toThrow();
  expect((await readQuizDeadline(db,f.id,now)).closesAt).toBe(proposal.closesAt);
  expect(await rows("SELECT * FROM leaderboard_snapshots WHERE quiz_variant_id=?",f.id+'-child')).toHaveLength(0);
 });
 it("rejects a new submission at commit, and rejects new submissions after immediate closure",async()=>{
  const f=await fixture(),cmd=await command(f.id),repo=createSubmissionRepository(createDatabase(db));
  const quiz=(await createPublicQuizRepository(createDatabase(db)).read({slug:f.slug},"child",now)).quiz!;
  const source=await repo.findScoringSolution(quiz.variant.id),score=scoreSubmission({grid:quiz.variant.grid,...source!},source!.solution.cells);
  const sessionHash="d".repeat(64);await db.prepare("INSERT OR IGNORE INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(sessionHash,at,at).run();
  const input={id:crypto.randomUUID(),quizVariantId:quiz.variant.id,quizRevision:1,sessionHash,idempotencyKey:"01924f8e-7b2a-7f1c-8f3a-123456789abc",requestHash:"e".repeat(64),displayName:"합성",comment:null,submittedAt:now.toISOString(),...score};
  await expect(changeQuizDeadline(withBeforeBatch(()=>repo.saveSubmission(input,now.toISOString())),f.id,cmd,actor,secret,now)).rejects.toThrow();
  expect((await readQuizDeadline(db,f.id,now)).impact.total).toBe(1);
  await changeQuizDeadline(db,f.id,await command(f.id,"2026-09-01T00:00:00.000Z"),actor,secret,now);
  const nextSession="f".repeat(64);await db.prepare("INSERT OR IGNORE INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(nextSession,at,at).run();
  expect(await repo.saveSubmission({...input,id:crypto.randomUUID(),sessionHash:nextSession},now.toISOString())).toEqual({outcome:"closed"});
  expect((await readQuizDeadline(db,f.id,now)).impact.total).toBe(1);
 });
 it("preserves a populated archived ranking and rejects a stale confirmation after scheduled finalization",async()=>{
  const f=await submitted(),cmd=await command(f.id),later=new Date("2026-09-28T00:00:01.000Z");
  await createQuizFinalizationService(createDatabase(db)).finalizeDueQuizSet(f.id,later);
  const before=await protectedRows();
  await expect(changeQuizDeadline(db,f.id,cmd,actor,secret,later)).rejects.toThrow();expect(await protectedRows()).toEqual(before);
 });
 it("rolls back the deadline audit and snapshots on a late finalizer audit failure",async()=>{
  const f=await submitted(),cmd=await command(f.id,"2026-09-01T00:00:00.000Z"),before=await protectedRows();
  await db.exec("CREATE TRIGGER deadline_late_fail BEFORE INSERT ON audit_logs WHEN NEW.action='close_now' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  try {await expect(changeQuizDeadline(db,f.id,cmd,actor,secret,now)).rejects.toThrow();}finally{await db.exec("DROP TRIGGER deadline_late_fail");}
  expect(await protectedRows()).toEqual(before);expect((await readQuizDeadline(db,f.id,now)).history).toEqual([]);
  expect((await readQuizDeadline(db,f.id,now)).closesAt).toBe("2026-09-28T00:00:00.000Z");
 });
 it("protects HTTP methods, Access, origin, request shape and privacy without a provider call",async()=>{
  const f=await fixture(),url=`https://example.com/api/admin/quiz-sets/${f.id}/closes-at`;
  for(const method of ["GET","POST","PATCH","DELETE"])expect((await exports.default.fetch(new Request(url,{method}))).status).toBe(401);
  const access=await createAccessFixture(new Date()),fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>Response.json(access.jwks));
  const headers={"Cf-Access-Jwt-Assertion":access.token,Origin:"https://example.com","Content-Type":"application/json"};
  const send=(method:string,body?:unknown,suffix="",origin="https://example.com")=>exports.default.fetch(new Request(url+suffix,{method,headers:{...headers,Origin:origin},...(body?{body:JSON.stringify(body)}:{})}));
  expect((await send("POST",proposal,"","https://foreign.invalid")).status).toBe(403);expect((await send("GET",undefined,"?extra=1")).status).toBe(409);expect((await send("DELETE")).status).toBe(405);
  expect((await send("POST",{...proposal,answer:"forbidden"})).status).toBe(409);expect((await send("PATCH",proposal)).status).toBe(409);
  const read=await send("GET");expect(read.status).toBe(200);expect(read.headers.get("Cache-Control")).toBe("private, no-store");expect(await read.text()).not.toMatch(/actor|requestHash|solution|PRIVATE/u);
  const preview=await send("POST",proposal);expect(preview.status).toBe(200);
  const data=(await preview.json() as {data:{confirmationToken:string}}).data;
  const saved=await send("PATCH",{...proposal,requestKey:crypto.randomUUID(),confirmationToken:data.confirmationToken,confirmation:"change_deadline"});expect(saved.status).toBe(200);
  expect(fetcher.mock.calls.every(([url])=>String(url).includes("cloudflareaccess.com"))).toBe(true);
 });
});
