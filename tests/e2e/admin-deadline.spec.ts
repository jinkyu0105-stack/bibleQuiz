import { expect, test, type Page } from "@playwright/test";
import type { DeadlineView } from "../../shared/api/admin-deadline";
async function fixture(page: Page, changeable = true, paused = false) {
 const quiz={quizSetId:"synthetic",slug:"2026-09-20-abc123",status:changeable?"published":"archived",revision:0,
  metadata:{title:"합성 설교",sermonDate:"2026-09-20"},publishedAt:"2026-09-21T00:00:00.000Z",closesAt:"2026-09-28T00:00:00.000Z"};
 const view:DeadlineView={quizSetId:"synthetic",closesAt:quiz.closesAt,closesAtKst:"2026년 9월 28일 오전 9시",changeable,paused,remainingSeconds:86400,
  impact:{total:3,visible:1,hidden:1,deleted:1},history:[]};
 await page.route("**/api/admin/published-quizzes",r=>r.fulfill({json:{data:{items:[quiz]}}}));
 await page.route("**/api/admin/quiz-sets/synthetic/display-text",r=>r.fulfill({json:{data:{quiz,history:[]}}}));
 return view;
}
async function open(page:Page) {
 await page.goto("/admin/tools");const parent=page.getByRole("region",{name:"발행 정보 정정",exact:true});
 await parent.getByLabel("정정할 퀴즈").selectOption("synthetic");await parent.getByRole("button",{name:"마감 일시 변경",exact:true}).click();
 return page.getByRole("region",{name:"일반 마감 변경",exact:true});
}
test("Korea time, impact confirmation invalidation, lost response retry and saved history",async({page},info)=>{
 const view=await fixture(page,true,true);let loadFail=true;const commits:Record<string,unknown>[]=[];
 await page.route("**/api/admin/quiz-sets/synthetic/closes-at",r=>{
  const method=r.request().method();if(method==="GET")return loadFail?r.fulfill({status:503,json:{}}):r.fulfill({json:{data:view}});
  const b=r.request().postDataJSON();
  if(method==="POST") {expect(b.closesAt).toBe("2026-09-30T00:00:00.000Z");return r.fulfill({json:{data:{quizSetId:"synthetic",previousClosesAt:view.closesAt,previousKst:view.closesAtKst,
   requestedClosesAt:b.closesAt,requestedKst:"2026년 9월 30일 오전 9시",remainingSeconds:86400,newRemainingSeconds:259200,immediate:false,paused:true,impact:view.impact,confirmationToken:"synthetic-confirmation"}}});}
  commits.push(b);
  if(commits.length===1){view.history.push({before:view.closesAt,requested:b.closesAt,after:b.closesAt,reason:b.reason,immediate:false,createdAt:"2026-09-23T00:00:00.000Z"});view.closesAt=b.closesAt;return r.fulfill({status:503,json:{}});}
  return r.fulfill({json:{data:{quizSetId:"synthetic",closesAt:b.closesAt,archived:false,outcome:"replayed"}}});
 });
 const panel=await open(page);await expect(panel.getByRole("alert")).toContainText("불러오지 못했습니다");loadFail=false;await panel.getByRole("button",{name:"최신 마감 불러오기"}).click();
 await expect(panel).toContainText("접수 중지 상태는 마감 변경 후에도 유지");await expect(panel.getByLabel("변경할 마감 (한국 시간)")).toHaveValue("2026-09-28T09:00");
 await panel.getByLabel("변경할 마감 (한국 시간)").fill("2026-09-30T09:00");await panel.getByLabel("마감 변경 사유").fill("참여 시간 연장");
 await panel.getByRole("button",{name:"변경 영향 다시 확인"}).click();await expect(panel).toContainText("영향을 받는 기존 제출 3건");
 await expect(panel.getByRole("button",{name:"마감 변경 저장"})).toBeDisabled();await panel.getByRole("checkbox").check();
 await panel.getByLabel("마감 변경 사유").fill("참여 시간 연장 확인");await expect(panel.getByRole("checkbox")).toHaveCount(0);
 await panel.getByRole("button",{name:"변경 영향 다시 확인"}).click();await panel.getByRole("checkbox").check();
 await page.getByLabel("화면 테마").selectOption(info.project.name==="chromium"?"light":"dark");await panel.screenshot({path:info.outputPath("deadline.png")});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.getByRole("button",{name:"마감 변경 저장"}).click();await expect(panel.getByRole("alert")).toContainText("입력은 유지됩니다");await expect(panel.getByLabel("마감 변경 사유")).toHaveValue("참여 시간 연장 확인");
 await panel.getByRole("button",{name:"마감 변경 저장"}).click();await expect(panel).toContainText("마감 일시를 변경했습니다");expect(commits).toHaveLength(2);expect(commits[0]).toEqual(commits[1]);
 await panel.getByText("마감 변경 이력 (1)",{exact:true}).click();await expect(panel).toContainText("사유: 참여 시간 연장 확인");
});
test("past date requires close-now confirmation, conflict keeps input and archived refresh locks editing",async({page})=>{
 const view=await fixture(page);let committed=false;
 await page.route("**/api/admin/quiz-sets/synthetic/closes-at",r=>{
  if(r.request().method()==="GET")return r.fulfill({json:{data:view}});
  const b=r.request().postDataJSON();if(r.request().method()==="POST")return r.fulfill({json:{data:{quizSetId:"synthetic",previousClosesAt:view.closesAt,previousKst:view.closesAtKst,requestedClosesAt:b.closesAt,requestedKst:"2026년 9월 1일 오전 9시",remainingSeconds:86400,newRemainingSeconds:0,immediate:true,paused:false,impact:view.impact,confirmationToken:"synthetic-confirmation"}}});
  expect(b.confirmation).toBe("close_now");committed=true;return r.fulfill({status:409,json:{}});
 });
 const panel=await open(page);await panel.getByLabel("변경할 마감 (한국 시간)").fill("2026-09-01T09:00");await panel.getByLabel("마감 변경 사유").fill("오늘 접수 종료");await panel.getByRole("button",{name:"변경 영향 다시 확인"}).click();
 await expect(panel).toContainText("과거로 소급해 제출을 삭제하지 않습니다");await expect(panel.getByRole("button",{name:"지금 마감 확정"})).toBeDisabled();await panel.getByRole("checkbox").check();await panel.getByRole("button",{name:"지금 마감 확정"}).click();
 await expect(panel.getByRole("alert")).toBeVisible();expect(committed).toBe(true);await expect(panel.getByLabel("마감 변경 사유")).toHaveValue("오늘 접수 종료");
 view.changeable=false;await panel.getByRole("button",{name:"최신 마감 불러오기"}).click();await expect(panel).toContainText("접수를 재개하지 않습니다");await expect(panel.getByLabel("변경할 마감 (한국 시간)")).toBeDisabled();
});
