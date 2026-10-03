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
 await expect(dialog.getByRole('button',{name:'백업 요청',exact:true})).toBeDisabled();await dialog.locator('summary').filter({hasText:'Cloudflare R2'}).click();await expect(dialog.locator('details[open]').getByText('자동 조회 미연결 · 관리 화면에서 확인 필요',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'이번 달 확인 완료',exact:true})).toBeDisabled();
 for(const checkbox of await dialog.getByRole('checkbox').all()){if(await checkbox.isEnabled())await checkbox.check();}
 await dialog.getByRole('button',{name:'이번 달 확인 완료',exact:true}).click();await expect.poll(()=>confirmations).toBe(1);
 await expect(page.getByText('이번 달 요금 정책 확인 필요',{exact:false})).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'80%'})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'최근 백업·삭제 기록에 실패'})).toBeVisible();
 await page.screenshot({path:`/tmp/p8-operations-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'비용·백업 상세 열기'})).toBeFocused();
});
test('protected manual displays service dictionary, repository text and future guide without executing HTML',async({page})=>{
 await page.route('**/api/admin/manual**',async route=>route.fulfill({json:{data:{markdown:'# 합성 매뉴얼\n\n## 10. 백업·복구\n\n<svg onload="window.__unsafe=true">원문</svg>',updatedAt:'2026-10-01',verification:'로컬 합성 검증',deployment:'local'}}}));
 await page.goto('/admin/manual');await expect(page.getByRole('heading',{name:'10. 백업·복구',exact:true})).toBeVisible();
 await expect(page.getByText('<svg onload="window.__unsafe=true">원문</svg>',{exact:true})).toBeVisible();expect(await page.evaluate(()=>Object.hasOwn(window,'__unsafe'))).toBe(false);
 await expect(page.getByText('서비스 사전',{exact:true})).toBeVisible();await page.getByRole('link',{name:'향후 회원 로그인·교회 계정 연동 검토'}).click();await expect(page).toHaveURL(/\/admin\/manual\/future\/member-auth$/u);await expect(page.getByRole('link',{name:'운영 매뉴얼로 돌아가기'})).toBeVisible();
});
