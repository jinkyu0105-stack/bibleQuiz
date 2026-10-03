import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSermonDraft, readSermonDraft } from "../_shared/services/sermon-drafts";
import { readWeeklyDashboard, readWinnerSettings, saveWinnerSettings, createAdminPolicy, patchAdminPolicy, testAdminPolicy, listAdminPolicy, listAdminSubmissions, replyPrivacyRequest, listPrivacyRequests } from "../_shared/services/admin-weekly";
import { submitPrivacyRequest, readPrivacyRequest } from "../_shared/services/privacy-requests";
import { createAccessFixture } from "./test/access-fixture";
const bindings = env as Env, db = bindings.DB, actor = "synthetic@example.invalid";
const at = "2026-10-01T00:00:00.000Z";
afterEach(()=>vi.restoreAllMocks());
async function draft() {
  const result = await registerSermonDraft(db,{video:crypto.randomUUID().replaceAll('-','').slice(0,11),title:'주간 합성 초안',sermonDate:'2026-10-01',referenceInput:'요 3:16',confirmed:true},actor);
  return {...result,quizSetId:(await readSermonDraft(db,result.sermonId)).quizSetId};
}
async function variant(id:string,level='child') {
  const v=crypto.randomUUID();
  await db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at) VALUES(?,?,?,1,5,'{"size":5,"cells":[]}',1,2,0,'{"errors":[],"warnings":[]}',?)`).bind(v,id,level,at).run();
  return v;
}
function beforeBatch(fn:()=>Promise<unknown>) {return new Proxy(db,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{await fn();return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}
function inquiry(){return {requestKey:crypto.randomUUID(),requestType:'delete_submission',quizSlug:'2026-10-01-synthetic',submittedName:'합성 이름',message:'합성 제출을 삭제해 주세요.',turnstileToken:'synthetic-challenge'};}
const verified = (action='privacy_request',hostname='example.com')=>vi.fn(async()=>Response.json({success:true,action,hostname,challenge_ts:new Date().toISOString()}));
describe('P5-72 weekly operations',()=>{
  it('dashboard reads stored work, activity, counts and requests without any AI call',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('external forbidden'));
    const f=await draft();
    // The activity must be newer than the stored quiz, regardless of today's date.
    await db.prepare('UPDATE quiz_sets SET updated_at=? WHERE id=?').bind(at,f.quizSetId).run();
    await db.prepare('INSERT INTO draft_activity VALUES(?,?) ON CONFLICT(sermon_id) DO UPDATE SET updated_at=excluded.updated_at').bind(f.sermonId,'2026-10-02T00:00:00.000Z').run();
    const view=await readWeeklyDashboard(db);
    expect(view.items.find(q=>q.quizSetId===f.quizSetId)).toMatchObject({title:'주간 합성 초안',sermonId:f.sermonId,updatedAt:'2026-10-02T00:00:00.000Z',totalCount:0,visibleCount:0,expired:false});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists different Top N per difficulty before variants exist, then updates active variants with CAS and audit',async()=>{
    const f=await draft(), initial=await readWinnerSettings(db,f.quizSetId);
    const first=await saveWinnerSettings(db,f.quizSetId,{child:2,adult:5,expectedRevision:initial.revision,reason:'주간 설정'},actor);
    expect(first).toMatchObject({child:2,adult:5,editable:true});
    await expect(saveWinnerSettings(db,f.quizSetId,{child:4,adult:4,expectedRevision:initial.revision,reason:'오래된 저장'},actor)).rejects.toMatchObject({code:'CONFLICT'});
    const child=await variant(f.quizSetId),adult=await variant(f.quizSetId,'adult');
    const current=await readWinnerSettings(db,f.quizSetId);
    await saveWinnerSettings(db,f.quizSetId,{child:2,adult:5,expectedRevision:current.revision,reason:'발행 설정'},actor);
    expect((await db.prepare('SELECT winner_count n FROM quiz_variants WHERE id IN (?,?) ORDER BY difficulty').bind(child,adult).all()).results.map(row=>row.n)).toEqual([5,2]);
    expect((await db.prepare("SELECT * FROM audit_logs WHERE entity_id=? AND action='winner_count_changed'").bind(f.quizSetId).all()).results).toHaveLength(2);
  });
  it('locks finalized or expired rankings and rechecks exact deadline at commit without partial settings or audit',async()=>{
    const f=await draft(),initial=await readWinnerSettings(db,f.quizSetId);
    const concurrent=beforeBatch(()=>db.prepare('UPDATE quiz_sets SET closes_at=? WHERE id=?').bind('2099-10-01T00:00:00.000Z',f.quizSetId).run());
    await expect(saveWinnerSettings(concurrent,f.quizSetId,{child:1,adult:1,expectedRevision:initial.revision,reason:'충돌 검사'},actor)).rejects.toMatchObject({code:'CONFLICT'});
    expect(await db.prepare("SELECT * FROM audit_logs WHERE entity_id=? AND action='winner_count_changed'").bind(f.quizSetId).first()).toBeNull();
    await db.prepare('UPDATE quiz_sets SET closes_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z',f.quizSetId).run();
    expect((await readWinnerSettings(db,f.quizSetId)).editable).toBe(false);
    await db.prepare('UPDATE quiz_sets SET closes_at=NULL WHERE id=?').bind(f.quizSetId).run();
    const v=await variant(f.quizSetId);await db.prepare('INSERT INTO leaderboard_snapshots VALUES(?,?,3,?)').bind(crypto.randomUUID(),v,at).run();
    await expect(saveWinnerSettings(db,f.quizSetId,{child:1,adult:1,expectedRevision:initial.revision,reason:'확정 검사'},actor)).rejects.toMatchObject({code:'LOCKED'});
  });
  it('edits normalized alias groups, rules and exact exceptions; tests real baseline checks without writes',async()=>{
    await createAdminPolicy(db,{kind:'reserved',label:'합성 보호 인물',aliases:['테스트 목사','테스트목사','테스트쌤']},actor);
    const aliases=(await listAdminPolicy(db)).items.filter(i=>i.kind==='reserved');
    expect(aliases).toHaveLength(2);expect(new Set(aliases.map(i=>i.groupId)).size).toBe(1);
    expect(await testAdminPolicy(db,{scope:'name',value:'테스트 목사'})).toMatchObject({blocked:true,matchedRuleId:aliases.find(i=>i.value==='테스트목사')!.id});
    expect(await testAdminPolicy(db,{scope:'name',value:'은'})).toMatchObject({blocked:true,matchedRuleId:'input:INVALID_NAME'});
    const items=(await createAdminPolicy(db,{kind:'term',scope:'comment',value:'금지어',matchMode:'contains'},actor)).items,rule=items.find(i=>i.kind==='term')!;
    expect(await testAdminPolicy(db,{scope:'comment',value:'금 지 어'})).toMatchObject({blocked:true,matchedRuleId:rule.id});
    await createAdminPolicy(db,{kind:'exception',scope:'comment',value:'좋은 금지어',reason:'합성 문맥 허용',acknowledged:true},actor);
    expect(await testAdminPolicy(db,{scope:'comment',value:'좋은 금지어'})).toMatchObject({blocked:false});
    expect(await testAdminPolicy(db,{scope:'comment',value:'아주 좋은 금지어'})).toMatchObject({blocked:true});
    expect(await testAdminPolicy(db,{scope:'comment',value:'test@example.invalid'})).toMatchObject({blocked:true,matchedRuleId:'input:CONTENT_BLOCKED'});
    await patchAdminPolicy(db,'term',rule.id,{enabled:false,expectedUpdatedAt:rule.updatedAt,reason:'비활성 검사'},actor);
    await expect(patchAdminPolicy(db,'term',rule.id,{enabled:true,expectedUpdatedAt:rule.updatedAt,reason:'낡은 변경'},actor)).rejects.toMatchObject({code:'CONFLICT'});
    expect(await testAdminPolicy(db,{scope:'comment',value:'금지어'})).toMatchObject({blocked:false});
  });
  it('shows actual submissions and audit; deleted payload is absent, scores remain and private session fields stay out',async()=>{
    const f=await draft(),v=await variant(f.quizSetId),session='a'.repeat(64),id=crypto.randomUUID();
    await db.prepare('INSERT INTO anonymous_sessions VALUES(?,?,?,?)').bind(session,at,at,'2099-01-01T00:00:00.000Z').run();
    await db.prepare(`INSERT INTO submissions(id,quiz_variant_id,quiz_revision,session_hash,idempotency_key,request_hash,display_name,comment,answers_json,correctness_mask,correct_cells,total_cells,correct_words,total_words,score_basis_points,is_fully_correct,submitted_at) VALUES(?,?,1,?,'01924f8e-7b2a-7f1c-8f3a-123456789abc',?,'합성 참여자','합성 소감','{"r0c0":"가","r0c1":"나"}','11',2,2,1,1,10000,1,?)`).bind(id,v,session,'b'.repeat(64),at).run();
    expect((await listAdminSubmissions(db,f.quizSetId)).items[0]).toMatchObject({displayName:'합성 참여자',scorePercent:100,answers:{r0c0:'가',r0c1:'나'}});
    expect((await readWeeklyDashboard(db)).items.find(q=>q.quizSetId===f.quizSetId)).toMatchObject({visibleCount:1,totalCount:1});
    await db.prepare("UPDATE quiz_variants SET results_status='invalidated' WHERE id=?").bind(v).run();
    expect((await readWeeklyDashboard(db)).items.find(q=>q.quizSetId===f.quizSetId)).toMatchObject({visibleCount:0,totalCount:1});
    await db.prepare("UPDATE submissions SET status='deleted',display_name=NULL,comment=NULL,answers_json=NULL,deleted_at=? WHERE id=?").bind(at,id).run();
    const result=await listAdminSubmissions(db,f.quizSetId);expect(result.items[0]).toMatchObject({displayName:null,comment:null,answers:null,status:'deleted',scorePercent:100});
    expect(JSON.stringify(result)).not.toContain(session);expect(JSON.stringify(result)).not.toContain('request_hash');
  });
  it('stores only receipt hash, replays a lost-response request without rechecking challenge, returns minimal own status',async()=>{
    const challenge=verified(),raw=inquiry(),b={...bindings,TURNSTILE_SITEVERIFY_FETCH:challenge};
    const receipt=await submitPrivacyRequest(b,raw);expect(receipt.lookupToken).toMatch(/^PRV-[a-f0-9]{64}$/u);
    const row=await db.prepare('SELECT * FROM privacy_requests WHERE id=?').bind(raw.requestKey).first();expect(JSON.stringify(row)).not.toContain(receipt.lookupToken);expect(String(row!.lookup_token_hash)).toHaveLength(64);
    expect(await submitPrivacyRequest(b,{...raw,turnstileToken:'fresh'})).toEqual(receipt);expect(challenge).toHaveBeenCalledTimes(1);
    await expect(submitPrivacyRequest(b,{...raw,message:'다른 설명'})).rejects.toMatchObject({code:'CONFLICT'});
    const publicView=await readPrivacyRequest(db,receipt.lookupToken);expect(Object.keys(publicView).sort()).toEqual(['adminResponse','createdAt','requestType','status']);
    expect(JSON.stringify(publicView)).not.toContain(raw.submittedName);expect(JSON.stringify(publicView)).not.toContain(raw.message);
    await expect(readPrivacyRequest(db,`PRV-${'0'.repeat(64)}`)).rejects.toMatchObject({code:'NOT_FOUND'});
    const admin=(await listPrivacyRequests(db)).items.find(i=>i.id===raw.requestKey)!;
    await replyPrivacyRequest(db,raw.requestKey,{status:'resolved',adminResponse:'합성 답변',expectedUpdatedAt:admin.updatedAt},actor);
    expect(await readPrivacyRequest(db,receipt.lookupToken)).toMatchObject({status:'resolved',adminResponse:'합성 답변'});
    await expect(replyPrivacyRequest(db,raw.requestKey,{status:'rejected',adminResponse:'낡은 변경',expectedUpdatedAt:admin.updatedAt},actor)).rejects.toMatchObject({code:'CONFLICT'});
  });
  it.each([['quiz_submission','example.com'],['privacy_request','other.invalid']])('rejects challenge action/host mismatch without storing %s/%s',async(action,host)=>{
    const raw=inquiry();await expect(submitPrivacyRequest({...bindings,TURNSTILE_SITEVERIFY_FETCH:verified(action,host)},raw)).rejects.toThrow('PRIVACY_CHALLENGE');
    expect(await db.prepare('SELECT id FROM privacy_requests WHERE id=?').bind(raw.requestKey).first()).toBeNull();
  });
  it('requires Access and same-origin JSON; rejects unexpected query and methods without affecting existing public APIs',async()=>{
    const access=await createAccessFixture(new Date());vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{if(String(input).startsWith('https://test-team.cloudflareaccess.com/'))return Response.json(access.jwks);throw new Error('external forbidden');});
    const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>exports.default.fetch(new Request(`https://example.com${path}`,{method,headers:{'Cf-Access-Jwt-Assertion':access.token,Origin:'https://example.com','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}));
    expect((await call('/api/admin/dashboard','GET',undefined,{'Cf-Access-Jwt-Assertion':''})).status).toBe(401);
    expect((await call('/api/admin/dashboard?extra=1')).status).toBe(400);
    const response=await call('/api/admin/dashboard');expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await call('/api/admin/moderation-test','POST',{scope:'name',value:'은혜'},{Origin:'https://evil.invalid'})).status).toBe(403);
    expect((await call('/api/admin/moderation-test','POST',{scope:'name',value:'은혜'},{'Content-Type':'text/plain'})).status).toBe(415);
    expect((await call('/api/privacy-requests','GET')).status).toBe(405);
    expect((await call('/api/privacy-requests','POST',{...inquiry(),phone:'010'})).status).toBe(400);
    expect((await call('/api/privacy-requests','POST',{...inquiry(),message:'test@example.invalid'})).status).toBe(400);
    expect((await call('/api/quizzes/current?difficulty=child')).status).not.toBe(400);
  });
});
