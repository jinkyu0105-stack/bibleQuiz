import { expect, test, type Page } from '@playwright/test';
import { parseBibleReference } from '../../shared/bible-reference';
import { adminContentViewSchema, type AdminContentView } from '../../shared/api/admin-content-generation';
const at='2026-10-01T00:00:00.000Z';
const quiz={quizSetId:'weekly',sermonId:'sermon-weekly',title:'이번 주 합성 설교',sermonDate:'2026-10-01',slug:null,status:'draft',submissionStatus:'open',closesAt:null,updatedAt:at,featured:false,expired:false,stage:'content_review',jobStatus:'awaiting_content_review',visibleCount:0,totalCount:0};
const hash='a'.repeat(64),binding={sourceId:'source',sourceRevision:1,sourceSha256:hash,revisionId:'source',transcriptSha256:hash,checksumFormat:'sha256:utf8-working-text:v1',confirmationId:'confirmed',version:2};
const evidence=[{segmentId:null,start:null,duration:null,from:0,to:8,quote:'서로 사랑하세요'}];
function content():AdminContentView {
  const fullBinding={transcript:binding,analysisId:'analysis',intentConfirmationId:'intent-confirmed'};
  return adminContentViewSchema.parse({enabled:false,quizSetId:'weekly',jobId:'job',version:2,status:'awaiting_content_review',stage:'content_review',
    content:{state:'present',intent:{selectedId:'analysis',rootAnalysisId:'analysis',confirmation:{id:'intent-confirmed'}},summary:{id:'summary',review:null},child:{id:'child',review:null},adult:{id:'adult',review:null}},
    snapshots:[{kind:'summary',value:{id:'summary',binding:fullBinding,draft:{paragraphs:[{id:'paragraph',text:'서로 사랑하는 삶',intentClaimIds:['claim'],evidence}]}}},...(['child','adult'] as const).map(difficulty=>({kind:'candidate',value:{id:difficulty,difficulty,binding:fullBinding,statuses:{word:'use'},draft:{candidates:[{id:'word',displayAnswer:'사랑',gridAnswer:'사랑',clue:'서로 아끼는 마음',phraseDescription:'설교의 핵심',selectionReason:'중심 메시지',sermonImportance:'핵심',difficultyReason:'익숙한 단어',grounding:{origin:'transcript',intentClaimIds:['claim'],evidence}}]}}}))],
    weekCostMicroUsd:0,weekUnknownCalls:0,jobCostMicroUsd:0,jobUnknownCalls:0,preview:null});
}
async function workspace(page:Page,edit:(body:Record<string,unknown>,view:AdminContentView)=>void|false){
  const view=content(),mutations:string[]=[];
  const reference=parseBibleReference('요 3:16');if(!reference.ok)throw new Error('synthetic reference');
  await page.route('**/api/admin/**',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(req.method()!=='GET'){
      mutations.push(p);
      if(p.endsWith('/generation/job/review')){
        const body=req.postDataJSON();if(edit(body,view)===false)return route.fulfill({status:409,json:{error:{code:'INPUT_CONFLICT',message:'다른 저장이 처리됐습니다. 입력을 보존했습니다.',requestId:'11111111-1111-4111-8111-111111111111'}}});
        return route.fulfill({json:{data:{outcome:'saved'}}});
      }
      throw new Error(`unexpected mutation: ${p}`);
    }
    const data=p.endsWith('/dashboard')?{items:[quiz],unansweredCount:2}:p.endsWith('/workspace')?quiz:p.endsWith('/draft-cleanup')?{items:[{sermonId:quiz.sermonId,title:quiz.title,dueAt:'2026-10-08T00:00:00.000Z',state:'scheduled',reason:null}]}:
      p.endsWith('/sermon-drafts')?{items:[{...quiz,expired:false}].map(({sermonId,quizSetId,title,sermonDate,status,expired})=>({sermonId,quizSetId,title,sermonDate,status,expired}))}:
      p.endsWith('/sermon-drafts/sermon-weekly')?{sermonId:quiz.sermonId,quizSetId:'weekly',youtubeUrl:'https://youtu.be/abcdefghijk',metadataRevision:1,title:quiz.title,sermonDate:quiz.sermonDate,bibleReference:reference.value,referenceLabel:reference.value.canonicalLabel,slugPreview:'2026-10-01-abc234'}:
      p.endsWith('/ai-costs')?{quizSetId:'weekly',knownCostMicroUsd:0,unknownCalls:0,totalCalls:0,models:[],calls:[]}:
      p.endsWith('/input/history')?{history:{head:{version:2,sourceType:'caption_plain',sourceId:'source',documentId:'source',confirmationId:'confirmed'},events:[{eventId:'source',version:1,kind:'source',documentId:'source',parentDocumentId:null,relatedId:null,createdAt:at},{eventId:'confirmed',version:2,kind:'confirm',documentId:'source',parentDocumentId:'source',relatedId:null,createdAt:at}]}}:
      p.endsWith('/input')?{input:{version:2,sourceType:'caption_plain',sourceId:'source',documentId:'source',documentSha256:hash,confirmationId:'confirmed',source:{sourceMode:'manual_paste',manualSourceKind:'youtube_visible_transcript',sourceCoverage:'full_transcript'},content:{format:'plain_text',text:'서로 사랑하세요 그리고 이웃을 도우세요'}}}:
      p.endsWith('/generation/correction')?{enabled:false,quizSetId:'weekly',latestJobId:null}:p.includes('/generation/')?view:null;
    if(data===null)return route.fulfill({status:404,json:{error:{message:'시험 대상 밖'}}});
    return route.fulfill({json:{data}});
  });
  return {view,mutations};
}
test('dashboard resumes one existing weekly work and new-work URL reuses it without any write',async({page},testInfo)=>{
  const f=await workspace(page,()=>{throw new Error('no mutations');});
  await page.goto('/admin');await expect(page.getByRole('link',{name:'계속 작업하기',exact:true})).toHaveAttribute('href','/admin/quiz/weekly');
  await expect(page.getByRole('link',{name:'답변할 문의·삭제 요청 2건'})).toBeVisible();
  await page.screenshot({path:`/tmp/p5-72-dashboard-${testInfo.project.name}.png`,fullPage:true});
  await page.goto('/admin/new');await expect(page).toHaveURL(/\/admin\/quiz\/weekly$/u);
  await expect(page.getByRole('heading',{name:'요약과 문제',exact:true})).toBeVisible();
  await expect(page.getByLabel('설교 ID',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^격자 배치/u})).toBeDisabled();
  await page.getByRole('button',{name:/^설교 의도/u}).click();await expect(page).toHaveURL(/step=2/u);
  await page.reload();await expect(page.getByRole('heading',{name:'설교 의도',exact:true})).toBeVisible();
  expect(f.mutations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('two edited snapshots autosave sequentially without losing the second draft and survive reload',async({page})=>{
  const saved:string[]=[];
  const f=await workspace(page,(body,view)=>{
    expect(body.expectedVersion).toBe(view.version);view.version++;
    const outer=body.operation as {family:string;operation:{kind:string;draft:unknown;baseSummaryId?:string;basePoolId?:string;difficulty?:'child'|'adult'}};
    expect(outer.operation.kind).toBe('edit');const op=outer.operation,key=outer.family==='summary'?'summary':op.difficulty!;
    const base=view.snapshots.find(s=>s.value.id===(op.baseSummaryId??op.basePoolId))!;
    const next=structuredClone(base);next.value.id=`${key}-edited`;
    if(next.kind==='summary')next.value.draft=op.draft as typeof next.value.draft;
    else if(next.kind==='candidate')next.value.draft=op.draft as typeof next.value.draft;
    if(view.content.state==='present'){const slot=view.content[key as 'summary'|'child'|'adult'];if(slot){slot.id=next.value.id;slot.review=null;}}
    view.snapshots.push(next);saved.push(key);
  });
  await page.goto('/admin/quiz/weekly?step=3');
  const summary=page.getByRole('textbox',{name:'요약 문단 1',exact:true}),child=page.locator('article').filter({has:page.getByRole('heading',{name:'어린이 문제',exact:true})}).getByRole('textbox',{name:'단서 1',exact:true});
  await summary.fill('자동 저장한 합성 요약');
  await page.getByRole('group',{name:'검수할 내용'}).getByRole('button',{name:/어린이 문제/u}).click();
  await child.fill('함께 살아가는 마음');
  await expect.poll(()=>saved.length).toBe(2);expect(saved).toEqual(['summary','child']);
  await page.reload();await expect(summary.last()).toHaveValue('자동 저장한 합성 요약');
  await page.getByRole('group',{name:'검수할 내용'}).getByRole('button',{name:/어린이 문제/u}).click();
  await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'어린이 문제',exact:true})}).getByRole('textbox',{name:'단서 1',exact:true}).last()).toHaveValue('함께 살아가는 마음');
  expect(f.mutations.every(p=>p.endsWith('/review'))).toBe(true);
});
test('autosave conflict keeps the draft, avoids automatic retry, and guards navigation until acknowledged',async({page})=>{
  const f=await workspace(page,()=>false);await page.goto('/admin/quiz/weekly?step=3');
  const field=page.getByRole('textbox',{name:'요약 문단 1',exact:true});await field.fill('충돌에도 남아야 하는 합성 초안');
  await expect(page.getByText('다른 저장이 처리됐습니다. 입력을 보존했습니다.',{exact:true})).toBeVisible();
  await expect(field).toHaveValue('충돌에도 남아야 하는 합성 초안');
  if (!await page.getByRole('link',{name:'이름·문구 필터',exact:true}).isVisible()) await page.locator('summary').filter({hasText:'관리자 운영 메뉴'}).click();
  await page.getByRole('link',{name:'이름·문구 필터',exact:true}).click();await expect(page.getByText('저장되지 않은 편집이 있습니다. 이 화면에서 저장을 확인해 주세요.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'작업 계속하기',exact:true}).click();await expect(page).toHaveURL(/\/admin\/quiz\/weekly/u);expect(f.mutations).toHaveLength(1);
});
test('submission operations confirm the selected quiz, refresh records and remove deleted payload',async({page})=>{
  const published={...quiz,status:'published',slug:'2026-10-01-abc234',totalCount:1,visibleCount:1};
  let status='visible';const actions:Array<{action:string;reason:string;createdAt:string}>=[];
  await page.route('**/api/admin/**',async route=>{
    const req=route.request(),p=new URL(req.url()).pathname;
    if(req.method()==='GET')return route.fulfill({json:{data:p.endsWith('/dashboard')?{items:[published],unansweredCount:0}:{items:[{id:'submission',difficulty:'child',revision:1,status,displayName:status==='deleted'?null:'합성 참여자',comment:status==='deleted'?null:'합성 소감',submittedAt:at,scorePercent:100,answers:status==='deleted'?null:{r0c0:'가'},actions}]}}});
    const body=req.postDataJSON();status=req.method()==='DELETE'?'deleted':body.action==='hide'?'hidden':'visible';actions.push({action:req.method()==='DELETE'?'delete':body.action,reason:body.reason,createdAt:at});
    return route.fulfill({json:{data:{outcome:'changed',status,submissionId:'submission',...(status==='deleted'?{deletedAt:at}:{})}}});
  });
  page.on('dialog',async dialog=>{expect(dialog.message()).toContain('이번 주 합성 설교');expect(dialog.message()).toContain('어린이');await dialog.accept();});
  await page.goto('/admin/submissions?quiz=weekly');await page.getByLabel('조치 사유').fill('합성 운영 조치');await page.getByRole('button',{name:'영향 확인·조치'}).click();
  await expect(page.getByText(/버전 1 · 숨김/u)).toBeVisible();await page.getByRole('button',{name:'영향 확인·조치'}).click();await expect(page.getByText(/버전 1 · 공개/u)).toBeVisible();
  await page.getByLabel('제출 조치').selectOption('delete');await page.getByRole('button',{name:'영향 확인·조치'}).click();
  await expect(page.getByRole('heading',{name:'삭제된 제출',exact:true})).toBeVisible();await expect(page.getByText('합성 소감',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'영향 확인·조치'})).toHaveCount(0);
});
test('Top N shows lock reason and saves configured values with expected revision',async({page})=>{
  let settings={child:3,adult:3,editable:true,revision:'first'};
  await page.route('**/api/admin/**',async route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/winner-settings')){if(route.request().method()==='PATCH'){const b=route.request().postDataJSON();expect(b.expectedRevision).toBe('first');settings={child:b.child,adult:b.adult,editable:false,revision:'second'};}return route.fulfill({json:{data:settings}});}return route.fulfill({json:{data:p.endsWith('/workspace')?{...quiz,status:'published',slug:'2026-10-01-abc234',closesAt:'2099-10-01T00:00:00.000Z'}:{items:[]}}});});
  await page.goto('/admin/quiz/weekly?operation=winners');await page.getByLabel('어린이 Top N').fill('2');await page.getByLabel('장년 Top N').fill('5');await page.getByLabel('설정 변경 사유').fill('주간 인원 설정');await page.getByRole('button',{name:'Top N 설정 저장'}).click();
  await expect(page.getByLabel('어린이 Top N')).toHaveValue('2');await expect(page.getByLabel('장년 Top N')).toHaveValue('5');await expect(page.getByRole('button',{name:'Top N 설정 저장'})).toBeDisabled();
});
test('public receipt survives reload and only its processing status is shown; admin replies with version guard',async({page})=>{
  const token=`PRV-${'a'.repeat(64)}`;await page.addInitScript(value=>localStorage.setItem('bq:privacy-receipts:v1',JSON.stringify([value])),token);
  let status='received',response:string|null=null,version=at;
  await page.route('**/api/**privacy-requests**',async route=>{const p=new URL(route.request().url()).pathname;if(p.startsWith('/api/admin/')){if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();expect(body.expectedUpdatedAt).toBe(version);status=body.status;response=body.adminResponse;version='2026-10-02T00:00:00.000Z';}return route.fulfill({json:{data:{items:[{id:'11111111-1111-4111-8111-111111111111',requestType:'delete_submission',quizSlug:'2026-10-01-abc234',submittedName:'합성 요청자',message:'합성 비공개 설명',status,adminResponse:response,createdAt:at,updatedAt:version}]}}});}return route.fulfill({json:{data:{requestType:'delete_submission',createdAt:at,status,adminResponse:response}}});});
  await page.goto('/privacy-requests');await page.getByRole('button',{name:'내 문의 1 처리 상태 보기'}).click();await expect(page.getByText('아직 관리자 답변이 없습니다.',{exact:true})).toBeVisible();await expect(page.getByText('합성 비공개 설명')).toHaveCount(0);
  await page.goto('/admin/privacy-requests');await page.getByLabel('처리 상태').selectOption('resolved');await page.getByLabel('관리자 답변').fill('요청한 조치를 확인했습니다.');await page.getByRole('button',{name:'상태·답변 저장'}).click();
  await page.goto('/privacy-requests');await page.getByRole('button',{name:'내 문의 1 처리 상태 보기'}).click();await expect(page.getByText('요청한 조치를 확인했습니다.',{exact:true})).toBeVisible();await expect(page.getByText('합성 요청자')).toHaveCount(0);
});
test('public intake retries the same lost-response request, stores receipt and restores it after reload',async({page})=>{
  await page.addInitScript(()=>{window.__BIBLEQUIZ_TEST_TURNSTILE__=()=>({outcome:'ready',token:'synthetic-challenge'});});
  const bodies:Array<{requestKey:string;message:string}>=[],token=`PRV-${'b'.repeat(64)}`;
  await page.route('**/api/privacy-requests',async route=>{bodies.push(route.request().postDataJSON());if(bodies.length===1)return route.abort('failed');return route.fulfill({json:{data:{lookupToken:token}}});});
  await page.route('**/api/privacy-requests/PRV-*',route=>route.fulfill({json:{data:{requestType:'privacy_question',createdAt:at,status:'received',adminResponse:null}}}));
  await page.goto('/privacy-requests');await page.getByLabel('문의 종류').selectOption('privacy_question');await page.getByLabel('짧은 설명').fill('합성 개인정보 문의입니다.');
  await page.getByRole('button',{name:'문의 접수',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'문의 접수',exact:true}).click();
  await expect(page.getByRole('heading',{name:'문의가 접수되었습니다.',exact:true})).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[0]!.requestKey).toBe(bodies[1]!.requestKey);
  expect(await page.evaluate(()=>localStorage.getItem('bq:privacy-receipts:v1'))).toContain(token);
  await page.reload();await page.getByRole('button',{name:'내 문의 1 처리 상태 보기'}).click();await expect(page.getByText('아직 관리자 답변이 없습니다.',{exact:true})).toBeVisible();
});
test('filter management registers aliases, warns before exceptions and tests text without changing rules',async({page},testInfo)=>{
  let items:Array<{id:string;kind:string;groupId:string|null;label:string;value:string;scope:string;matchMode:string;enabled:boolean;updatedAt:string}>=[];
  let testCalls=0,creates=0;
  await page.route('**/api/admin/**',async route=>{
    const p=new URL(route.request().url()).pathname,method=route.request().method(),kind=p.includes('reserved')?'reserved':p.includes('exceptions')?'exception':'term';
    if(p.endsWith('/moderation-test')){testCalls++;return route.fulfill({json:{data:{normalizedValue:'금지어',blocked:true,matchedRuleId:'rule'}}});}
    if(method==='GET')return route.fulfill({json:{data:{items:items.filter(i=>i.kind===kind)}}});
    const b=route.request().postDataJSON();creates++;
    items=[...items,{id:`rule-${creates}`,kind,groupId:kind==='reserved'?'group':null,label:b.label??b.reason??b.value,value:b.aliases?.[0]??b.value,scope:b.scope??'name',matchMode:b.matchMode??'exact',enabled:true,updatedAt:at}];
    return route.fulfill({json:{data:{items}}});
  });
  await page.goto('/admin/moderation');await page.getByLabel('보호 대상 표시명').fill('합성 보호 인물');await page.getByLabel('이름·별칭 (한 줄에 하나)').fill('합성 목사\n합성목사');await page.getByRole('button',{name:'필터 등록',exact:true}).click();
  await expect(page.getByRole('heading',{name:'합성 보호 인물',exact:true})).toBeVisible();
  await page.getByLabel('등록 종류').selectOption('exception');await page.getByLabel('필터 문구').fill('합성 허용 문구');await page.getByLabel('예외 사유').fill('설교 문맥 허용');
  await expect(page.getByText('예외는 해당 범위의 정규화된 전체 문구가 정확히 같을 때만 금지 규칙을 건너뜁니다. 연락처·입력 형식·보호 이름 검사는 유지됩니다.',{exact:true})).toBeVisible();
  await page.getByLabel('이 문구가 기존 금지 규칙을 건너뛰는 영향을 확인했습니다.').check();await page.getByRole('button',{name:'필터 등록',exact:true}).click();
  await page.getByLabel('시험 문구',{exact:true}).fill('금 지 어');await page.getByRole('button',{name:'저장 없이 시험'}).click();await expect(page.getByText('차단 · 정규화: 금지어 · 일치 규칙: rule',{exact:true})).toBeVisible();expect(creates).toBe(2);expect(testCalls).toBe(1);
  await page.getByLabel('화면 테마').selectOption('dark');await page.screenshot({path:`/tmp/p5-72-policy-${testInfo.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('review targets preserve a failed draft and every candidate control without triggering generation', async ({page}) => {
  const f = await workspace(page, () => false);
  await page.goto('/admin/quiz/weekly?step=3');
  const field = page.getByRole('textbox', {name:'요약 문단 1', exact:true});
  await field.fill('전환 뒤에도 보존할 검수 초안');
  await expect(page.getByText('다른 저장이 처리됐습니다. 입력을 보존했습니다.', {exact:true})).toBeVisible();
  const targets = page.getByRole('group', {name:'검수할 내용'});
  for (const name of ['어린이 문제', '장년 문제']) {
    await targets.getByRole('button', {name:new RegExp(name)}).click();
    await expect(page.getByRole('textbox', {name:'답 1', exact:true})).toBeVisible();
    await expect(page.getByRole('textbox', {name:'단서 1', exact:true})).toBeVisible();
    await expect(page.getByRole('combobox', {name:'배치에 사용할지 선택'})).toBeVisible();
    await page.locator('summary:visible').filter({hasText:'원문 근거 확인 (1)'}).click();
    await expect(page.getByRole('button', {name:'원문 위치 보기', exact:true})).toBeVisible();
  }
  await targets.getByRole('button', {name:/요약/u}).click();
  await expect(field).toHaveValue('전환 뒤에도 보존할 검수 초안');
  expect(f.mutations).toHaveLength(1);
  expect(f.mutations[0]).toMatch(/review$/u);
});

test('weekly header exposes review status and keyboard navigation at narrow widths',async({page})=>{
  const f=await workspace(page,()=>{throw new Error('navigation must not mutate');});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/admin/quiz/weekly?step=3');
  await expect(page.getByText('내용 검수 대기',{exact:true}).first()).toBeVisible();
  const jump=page.getByRole('link',{name:'검수할 내용 선택',exact:true});
  await expect(jump).toBeInViewport();
  const menu=page.locator('summary').filter({hasText:'관리자 운영 메뉴'});
  const manual=page.getByRole('link',{name:'운영 매뉴얼',exact:true});
  await expect(manual).toBeHidden();
  await menu.focus();await page.keyboard.press('Enter');await expect(manual).toBeVisible();
  await menu.focus();await page.keyboard.press('Enter');await expect(manual).toBeHidden();
  await jump.click();await expect(page.getByRole('button',{name:/^어린이 문제/})).toBeInViewport();
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1366,height:768});await expect(manual).toBeVisible();
  expect(f.mutations).toEqual([]);
});
