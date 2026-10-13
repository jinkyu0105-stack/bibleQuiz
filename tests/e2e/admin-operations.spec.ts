import {expect,test} from '@playwright/test';
import {serviceIds,pricingVersion} from '../../src/config/service-registry';
const at='2026-10-01T00:00:00.000Z';
test('operations warning survives monthly confirmation; drawer supports keyboard and never exposes backup storage',async({page},info)=>{
 let checked=false,confirmations=0;
 const view=()=>({yearMonth:'2026-10',pricingVersion,policyCheckNeeded:!checked,checkedAt:checked?at:null,openAiModels:[],items:serviceIds.map(service=>({service,scope:'account',scopeId:'account',periodStart:at,periodEnd:at,fetchedAt:service==='workers'?at:null,source:'configured',metrics:service==='workers'?{requests:85_000}:{},status:service==='workers'?'warning':'delayed',errorCode:service==='workers'?null:'METRICS_NOT_CONNECTED'}))});
 await page.route('**/api/admin/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/api/admin/usage-summary')return route.fulfill({json:{data:view()}});
   if(p==='/api/admin/backups')return route.fulfill({json:{data:{enabled:false,weeklyVerifiedCount:0,items:[{id:"11111111-1111-4111-8111-111111111111",kind:"deletion_manifest",status:"failed",startedAt:at,completedAt:null,sizeBytes:null,checksumPrefix:null,errorCode:"BACKUP_FAILED"}],manifestUpdatedAt:null}}});
   if(p==='/api/admin/operations/monthly-check'){expect(route.request().postDataJSON().checkedServices.sort()).toEqual([...serviceIds].sort());checked=true;confirmations++;return route.fulfill({json:{data:view()}});}
   return route.fulfill({status:404,json:{error:{message:'synthetic-only scope'}}});
 });
 await page.goto('/admin/operations');await expect(page.getByRole('button',{name:'비용·백업 상세 열기'})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:'80%'})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'최근 백업·삭제 기록에 실패'})).toBeVisible();
 await page.getByRole('button',{name:'비용·백업 상세 열기'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await dialog.locator('summary').filter({hasText:'백업 관리'}).click();await expect(dialog.getByRole('button',{name:'백업 요청',exact:true})).toBeDisabled();await dialog.locator('summary').filter({hasText:'Cloudflare R2'}).click();await expect(dialog.locator('details[open]').getByText('자동 조회 미연결 · 관리 화면에서 확인 필요',{exact:true})).toBeVisible();
 await dialog.locator('summary').filter({hasText:'월간 요금 정책 확인'}).click();await expect(dialog.getByRole('button',{name:'이번 달 확인 완료',exact:true})).toBeDisabled();
 for(const checkbox of await dialog.getByRole('checkbox').all()){if(await checkbox.isEnabled())await checkbox.check();}
 await dialog.getByRole('button',{name:'이번 달 확인 완료',exact:true}).click();await expect.poll(()=>confirmations).toBe(1);
 await expect(page.getByText('이번 달 요금 정책 확인 필요',{exact:false})).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'80%'})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'최근 백업·삭제 기록에 실패'})).toBeVisible();
 await page.screenshot({path:`/tmp/p8-operations-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'비용·백업 상세 열기'})).toBeFocused();
});
test('protected manual displays service dictionary, repository text and future guide without executing HTML',async({page})=>{
 await page.route('**/api/admin/manual**',async route=>route.fulfill({json:{data:{markdown:'# 합성 매뉴얼\n\n## 10. 백업·복구\n\n<svg onload="window.__unsafe=true">원문</svg>',updatedAt:'2026-10-01',verification:'로컬 합성 검증',deployment:'local'}}}));
 await page.goto('/admin/manual');await expect(page.getByRole('heading',{name:'백업·복구',exact:true})).toBeVisible();
 await expect(page.getByText('<svg onload="window.__unsafe=true">원문</svg>',{exact:true})).toBeVisible();expect(await page.evaluate(()=>Object.hasOwn(window,'__unsafe'))).toBe(false);
 await expect(page.getByRole('heading',{name:'백업·복구',exact:true})).toBeVisible();await page.getByRole('link',{name:'향후 회원 로그인·교회 계정 연동 검토'}).click();await expect(page).toHaveURL(/\/admin\/manual\/future\/member-auth$/u);await expect(page.getByRole('link',{name:'운영 매뉴얼로 돌아가기'})).toBeVisible();
});

test('manual formats reading cues, explains services and retries only after a failed load', async ({page}) => {
 let failRead=true;
 await page.route('**/api/admin/manual', route => {
   return failRead ? route.fulfill({status:503,json:{error:{message:'temporary'}}}) : route.fulfill({json:{data:{
     markdown:'# 안내\n\n## 읽기 안내\n\n**저장 확인** 후 `퀴즈 설정`을 누르세요.  \n다음 줄입니다. 제출할 수  \n있습니다.\n\n> **주의** 삭제는 별도입니다.\n\n1. 내용을 읽습니다.\n2. `저장`을 누릅니다.\n\n<svg onload="window.__unsafe=true">원문</svg>',
     updatedAt:'2026-10-13',verification:'합성 검사 기록',deployment:'미연결 · version 미연결',
   }}});
 });
 await page.goto('/admin/manual');
 await expect(page.getByRole('button',{name:'안내문 다시 불러오기'})).toBeVisible();
 failRead=false;
 await page.getByRole('button',{name:'안내문 다시 불러오기'}).click();
 await expect(page.getByRole('button',{name:'안내문 다시 불러오기'})).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'자주 찾는 운영 작업'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'읽기 안내',exact:true})).toBeVisible();
 await expect(page.locator('code').filter({hasText:'퀴즈 설정'})).toBeVisible();
 await expect(page.locator('strong').filter({hasText:'저장 확인'})).toBeVisible();
 await expect(page.locator('ol > li')).toHaveCount(2);
 await expect(page.locator('p').filter({hasText:'다음 줄입니다.'}).locator('br')).toHaveCount(0);
 expect(await page.evaluate(()=>Object.hasOwn(window,'__unsafe'))).toBe(false);
 await expect(page.locator('span').filter({hasText:/^제출할 수 있습니다\.$/u})).toHaveCSS('white-space','nowrap');
 if (!await page.getByRole('combobox',{name:'읽을 주제'}).isVisible()) {
   const contents = page.getByRole('navigation',{name:'매뉴얼 주제'});
   await expect(contents).toHaveCSS('display','block');
   const topic = await contents.getByRole('button').first().boundingBox();
   expect(topic!.width).toBeGreaterThan(130);
 }
 if(await page.getByRole('combobox',{name:'읽을 주제'}).isVisible()) {
   await page.getByRole('combobox',{name:'읽을 주제'}).selectOption('service-openai');
 } else {
   await page.getByRole('navigation',{name:'매뉴얼 주제'}).locator('summary').filter({hasText:'서비스 사전'}).click();
   await page.getByRole('navigation',{name:'매뉴얼 주제'}).getByRole('button',{name:'OpenAI API',exact:true}).click();
 }
 await expect(page.getByRole('heading',{name:'OpenAI API',exact:true})).toBeFocused();
 await expect(page.getByText('언제 쓰나요?',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('등록한 설교 자료를 읽고, 내용을 정리하거나 퀴즈 문제의 초안을 만들어 주는 AI입니다. AI가 만든 내용을 확인하고 발행하는 사람은 관리자입니다.',{exact:true})).toBeVisible();
 await expect(page.locator('code').filter({hasText:'OPENAI_API_KEY'})).toBeHidden();
 await page.locator('summary').filter({hasText:'안내문 수정일과 서버 정보'}).click();
 await expect(page.getByText(/서비스 장애를 뜻하지는 않습니다/)).toBeVisible();
 await page.getByRole('button',{name:'밤',exact:true}).click();
 await expect(page.locator('body')).toHaveAttribute('data-time','night');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
