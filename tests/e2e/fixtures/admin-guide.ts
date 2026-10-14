import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseBibleReference } from '../../../shared/bible-reference';
import { adminContentViewSchema, type AdminContentView } from '../../../shared/api/admin-content-generation';
import { serviceIds, pricingVersion } from '../../../src/config/service-registry';
const at='2026-10-11T00:00:00.000Z';
export const guideQuiz={quizSetId:'weekly',sermonId:'sermon-weekly',title:'서로 돕는 한 주 · 연습',sermonDate:'2026-10-11',slug:null,status:'draft',submissionStatus:'open',closesAt:null,updatedAt:at,featured:false,expired:false,stage:'content_review',jobStatus:'awaiting_content_review',visibleCount:0,totalCount:0};
const hash='a'.repeat(64),binding={sourceId:'source',sourceRevision:1,sourceSha256:hash,revisionId:'source',transcriptSha256:hash,checksumFormat:'sha256:utf8-working-text:v1',confirmationId:'confirmed',version:2};
const evidence=[{segmentId:null,start:null,duration:null,from:0,to:8,quote:'서로 사랑하세요'}];
export function guideContent():AdminContentView {
  const fullBinding={transcript:binding,analysisId:'analysis',intentConfirmationId:'intent-confirmed'};
  return adminContentViewSchema.parse({enabled:false,quizSetId:'weekly',jobId:'job',version:2,status:'awaiting_content_review',stage:'content_review',
    content:{state:'present',intent:{selectedId:'analysis',rootAnalysisId:'analysis',confirmation:{id:'intent-confirmed'}},summary:{id:'summary',review:null},child:{id:'child',review:null},adult:{id:'adult',review:null}},
    snapshots:[{kind:'summary',value:{id:'summary',binding:fullBinding,draft:{paragraphs:[{id:'paragraph',text:'서로 사랑하는 삶',intentClaimIds:['claim'],evidence}]}}},...(['child','adult'] as const).map(difficulty=>({kind:'candidate',value:{id:difficulty,difficulty,binding:fullBinding,statuses:{word:'use'},draft:{candidates:[{id:'word',displayAnswer:'사랑',gridAnswer:'사랑',clue:'서로 아끼는 마음',phraseDescription:'설교의 핵심',selectionReason:'중심 메시지',sermonImportance:'핵심',difficultyReason:'익숙한 단어',grounding:{origin:'transcript',intentClaimIds:['claim'],evidence}}]}}}))],
    weekCostMicroUsd:0,weekUnknownCalls:0,jobCostMicroUsd:0,jobUnknownCalls:0,preview:null});
}

const quiz = guideQuiz;

export async function mockAdminGuide(page: Page, view=guideContent()) {
  const mutations:string[]=[];
  const reference=parseBibleReference('요 3:16'); if(!reference.ok) throw new Error('synthetic reference');
  const published={...quiz,quizSetId:'published-example',sermonId:'published-sermon',title:'함께 걷는 기쁨 · 연습',slug:'2026-10-01-abc234',status:'published',closesAt:'2026-10-18T12:00:00.000Z',stage:'finish',jobStatus:null,childVisibleCount:3,adultVisibleCount:4,visibleCount:7,totalCount:7};
  const archived={...published,quizSetId:'archived-example',title:'작은 친절을 나누어요 · 연습',status:'archived',submissionStatus:'closed',closesAt:'2026-10-04T12:00:00.000Z',sermonDate:'2026-09-27'};
  await page.route('**/api/admin/**', async route => {
    const p=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET') { mutations.push(p); return route.abort('blockedbyclient'); }
    const extra=p.endsWith('/dashboard')?{items:[quiz,published,archived],homeQuiz:{quizSetId:published.quizSetId,selection:'automatic'},unansweredCount:1}:
      p.endsWith('/workspace')?(p.includes('published-example')?published:quiz):
      p.endsWith('/submissions')?{items:[{id:'example-submission',difficulty:'child',revision:1,status:'visible',displayName:'연습 참여자',comment:'함께 풀어 보니 즐거웠어요.',submittedAt:at,scorePercent:100,answers:{'0,0':'연습'},actions:[]}]}:
      p.endsWith('/privacy-requests')?{items:[{id:'11111111-1111-4111-8111-111111111111',requestType:'delete_submission',quizSlug:published.slug,submittedName:'연습 요청자',message:'연습으로 제출한 기록을 지워 주세요.',status:'received',adminResponse:null,createdAt:at,updatedAt:at}]}:
      /(?:reserved-names|moderation-terms|moderation-exceptions)$/u.test(p)?{items:[]}:
      p.endsWith('/usage-summary')?{yearMonth:'2026-10',pricingVersion,policyCheckNeeded:true,checkedAt:null,openAiModels:[],items:serviceIds.map(service=>({service,scope:'account',scopeId:'account',periodStart:at,periodEnd:at,fetchedAt:service==='workers'?at:null,source:'configured',metrics:service==='workers'?{requests:1200}:{},status:service==='workers'?'comfortable':'delayed',errorCode:service==='workers'?null:'METRICS_NOT_CONNECTED'}))}:
      p.endsWith('/backups')?{enabled:false,weeklyVerifiedCount:1,manifestUpdatedAt:at,items:[{id:'22222222-2222-4222-8222-222222222222',kind:'weekly',status:'verified',startedAt:at,completedAt:at,sizeBytes:128000,checksumPrefix:'1234abcd1234',errorCode:null}]}:
      p.endsWith('/manual')?{markdown:readFileSync('docs/operations-manual.md','utf8'),updatedAt:'2026-10-13',verification:'연습 화면',deployment:'local'}:null;
    if(extra) return route.fulfill({json:{data:extra}});
    const data=p.endsWith('/draft-cleanup')?{items:[{sermonId:quiz.sermonId,title:quiz.title,dueAt:'2026-10-08T00:00:00.000Z',state:'scheduled',reason:null}]}:
      p.endsWith('/sermon-drafts')?{items:[{...quiz,expired:false}].map(({sermonId,quizSetId,title,sermonDate,status,expired})=>({sermonId,quizSetId,title,sermonDate,status,expired}))}:
      p.endsWith('/sermon-drafts/sermon-weekly')?{sermonId:quiz.sermonId,quizSetId:'weekly',youtubeUrl:'https://youtu.be/abcdefghijk',metadataRevision:1,title:quiz.title,sermonDate:quiz.sermonDate,bibleReference:reference.value,referenceLabel:reference.value.canonicalLabel,slugPreview:'2026-10-01-abc234'}:
      p.endsWith('/ai-costs')?{quizSetId:'weekly',knownCostMicroUsd:0,unknownCalls:0,totalCalls:0,models:[],calls:[]}:
      p.endsWith('/input/history')?{history:{head:{version:2,sourceType:'caption_plain',sourceId:'source',documentId:'source',confirmationId:'confirmed'},events:[{eventId:'source',version:1,kind:'source',documentId:'source',parentDocumentId:null,relatedId:null,createdAt:at},{eventId:'confirmed',version:2,kind:'confirm',documentId:'source',parentDocumentId:'source',relatedId:null,createdAt:at}]}}:
      p.endsWith('/input')?{input:{version:2,sourceType:'caption_plain',sourceId:'source',documentId:'source',documentSha256:hash,confirmationId:'confirmed',source:{sourceMode:'manual_paste',manualSourceKind:'youtube_visible_transcript',sourceCoverage:'full_transcript'},content:{format:'plain_text',text:'서로 사랑하세요 그리고 이웃을 도우세요'}}}:
      p.endsWith('/generation/correction')?{enabled:false,quizSetId:'weekly',latestJobId:null}:p.includes('/generation/')?view:null;
    if(data===null)return route.fulfill({status:404,json:{error:{message:'연습 화면 범위 밖'}}});
    return route.fulfill({json:{data}});
  });
  return mutations;
}
