import { activeRateActor, publicRateResponse, PublicRateError } from "../_shared/services/public-rate-limit";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "./app";
import { success, failure } from "../../shared/api/envelope";
import { adminSubmissionIdSchema } from "../../shared/api/admin-submission-moderation";
import { MutationRequestError, readSameOriginJson } from "../_shared/http/mutation-request";
import { WeeklyError, readWeeklyDashboard, listAdminSubmissions, readWinnerSettings, saveWinnerSettings,
  listAdminPolicy, createAdminPolicy, patchAdminPolicy, testAdminPolicy, listPrivacyRequests, replyPrivacyRequest } from "../_shared/services/admin-weekly";
import { PrivacyChallengeError, readPrivacyRequest, submitPrivacyRequest } from "../_shared/services/privacy-requests";
export const weeklyRoutes=new Hono<AppEnvironment>();
const weeklyPaths = ['/api/admin/dashboard','/api/admin/quiz-sets/:id/workspace','/api/admin/submissions','/api/admin/quiz-sets/:id/winner-settings','/api/admin/reserved-names','/api/admin/reserved-names/:id','/api/admin/moderation-terms','/api/admin/moderation-terms/:id','/api/admin/moderation-exceptions','/api/admin/moderation-exceptions/:id','/api/admin/moderation-test','/api/admin/privacy-requests','/api/admin/privacy-requests/:id','/api/privacy-requests','/api/privacy-requests/:token'];
const isWeekly = (path: string) => weeklyPaths.some(pattern => new RegExp(`^${pattern.replace(/:[^/]+/gu, '[^/]+')}$`, 'u').test(path));
weeklyRoutes.use('*',async(c,next)=>{if(isWeekly(c.req.path)) c.header('Cache-Control','private, no-store');await next();});
function errorResponse(c:Context<AppEnvironment>,error:unknown) {
  if (error instanceof PublicRateError) {
    if(error.status===429) c.header("Retry-After","10");
    return c.json(failure({code:error.message,message:error.status===429?"요청이 몰렸습니다. 10초 후 다시 시도해 주세요.":"요청 제한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",requestId:c.get("requestId")}),error.status);
  }
  const invalid=error instanceof z.ZodError;
  const code=error instanceof MutationRequestError?error.code:error instanceof WeeklyError?error.code:invalid?'INVALID':error instanceof PrivacyChallengeError?'CHALLENGE':'UNAVAILABLE';
  const status=error instanceof MutationRequestError?error.status:code==='INVALID'?400:code==='NOT_FOUND'?404:code==='CONFLICT'||code==='LOCKED'?409:error instanceof PrivacyChallengeError&&!error.unavailable?403:503;
  return c.json(failure({code:`WEEKLY_${code}`,message:code==='CONFLICT'?'다른 저장이 처리됐습니다. 입력을 보존하고 최신 상태를 확인해 주세요.':code==='LOCKED'?'마감된 퀴즈의 확정 순위는 변경할 수 없습니다.':code==='INVALID'?'입력 형식·길이와 확인 내용을 살펴봐 주세요.':code==='NOT_FOUND'?'요청한 기록을 찾지 못했습니다.':code==='CHALLENGE'?'사람 확인을 다시 시도해 주세요.':'처리 결과를 확인하지 못했습니다. 다시 조회해 주세요.',requestId:c.get('requestId')}),status);
}
weeklyRoutes.use('*',async(c,next)=>{
  if(!isWeekly(c.req.path)) { await next(); return; }
  try {
    if(c.req.path!=='/api/admin/submissions' && new URL(c.req.url).search) throw new WeeklyError('INVALID');
    await next();}catch(error){return errorResponse(c,error);}
});
function id(value:string) {return adminSubmissionIdSchema.parse(value);}
weeklyRoutes.get('/api/admin/dashboard',async c=>c.json(success(await readWeeklyDashboard(c.env.DB))));
weeklyRoutes.get('/api/admin/quiz-sets/:id/workspace',async c=>{
  const quiz=(await readWeeklyDashboard(c.env.DB)).items.find(q=>q.quizSetId===id(c.req.param('id')));
  if(!quiz) throw new WeeklyError('NOT_FOUND'); return c.json(success(quiz));
});
weeklyRoutes.get('/api/admin/submissions',async c=>{
  const query=z.strictObject({quizSetId:adminSubmissionIdSchema}).parse(c.req.query());
  return c.json(success(await listAdminSubmissions(c.env.DB,query.quizSetId)));
});
weeklyRoutes.on(['GET','PATCH'],'/api/admin/quiz-sets/:id/winner-settings',async c=>{
  const quiz=id(c.req.param('id'));
  return c.json(success(c.req.method==='GET'?await readWinnerSettings(c.env.DB,quiz):await saveWinnerSettings(c.env.DB,quiz,await readSameOriginJson(c.req.raw),c.get('accessIdentity').email)));
});
for(const [path,kind] of [['reserved-names','reserved'],['moderation-terms','term'],['moderation-exceptions','exception']] as const) {
  weeklyRoutes.get(`/api/admin/${path}`,async c=>c.json(success({items:(await listAdminPolicy(c.env.DB)).items.filter(r=>r.kind===kind)})));
  weeklyRoutes.post(`/api/admin/${path}`,async c=>{
    const raw=await readSameOriginJson(c.req.raw);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||('kind' in raw&&raw.kind!==kind)) throw new WeeklyError('INVALID');
    return c.json(success(await createAdminPolicy(c.env.DB,{...raw,kind},c.get('accessIdentity').email)));
  });
  weeklyRoutes.patch(`/api/admin/${path}/:id`,async c=>c.json(success(await patchAdminPolicy(c.env.DB,kind,id(c.req.param('id')),await readSameOriginJson(c.req.raw),c.get('accessIdentity').email))));
}
weeklyRoutes.post('/api/admin/moderation-test',async c=>c.json(success(await testAdminPolicy(c.env.DB,await readSameOriginJson(c.req.raw)))));
weeklyRoutes.get('/api/admin/privacy-requests',async c=>c.json(success(await listPrivacyRequests(c.env.DB))));
weeklyRoutes.patch('/api/admin/privacy-requests/:id',async c=>c.json(success(await replyPrivacyRequest(c.env.DB,z.uuid().parse(c.req.param('id')),await readSameOriginJson(c.req.raw),c.get('accessIdentity').email))));
weeklyRoutes.post('/api/privacy-requests',async c=>c.json(success(await submitPrivacyRequest(c.env,await readSameOriginJson(c.req.raw),c.req.raw,c.env.PUBLIC_RATE_LIMIT_ENABLED === "true" ? await activeRateActor(c) : undefined))));
weeklyRoutes.get('/api/privacy-requests/:token',async c=>{
  const limited=await publicRateResponse(c,'privacy-read',c.env.PUBLIC_RATE_LIMIT_ENABLED === 'true' ? await activeRateActor(c) : undefined); if(limited) return limited;
  return c.json(success(await readPrivacyRequest(c.env.DB,c.req.param('token'))));
});

weeklyRoutes.onError((error,c)=>errorResponse(c,error));

for(const path of weeklyPaths) weeklyRoutes.all(path,c=>c.json(failure({code:'METHOD_NOT_ALLOWED',message:'지원하지 않는 요청 방식입니다.',requestId:c.get('requestId')}),405));
