import {expect,test} from "@playwright/test";
import {publicResponse} from "../fixtures/public-response";
import {problemHistorySchema} from "../../shared/api/problem-history";
test("shows old answers separately from the correction, retries and preserves deleted tombstones",async({page},testInfo)=>{
 const data=publicResponse("child",2),quiz=data.data.quiz!,grid=quiz.variant.grid;
 quiz.correction={nonRanked:false,notice:"이전 오류본의 결과와 순위는 무효 처리되었습니다."};
 const ids=grid.cells.map(c=>c.id);
 let history=problemHistorySchema.parse({items:[{notice:"문제 의미 오류",grid,submission:{status:"submitted",quizVariantId:"old-child",quizRevision:1,answers:{[ids[0]!]:"가"},
 result:{submissionId:"old-submission",submittedAt:"2026-09-01T05:30:00.000Z",correctCells:1,totalCells:ids.length,correctWords:0,totalWords:grid.entries.length,
 scoreBasisPoints:Math.round(10000/ids.length),correctnessMask:"1"+"0".repeat(ids.length-1),canRevealAnswer:true,solution:{cells:Object.fromEntries(ids.map(id=>[id,"가"])),entries:Object.fromEntries(grid.entries.map(e=>[e.id,"가".repeat(e.length)]))}}}}]});
 let first=true;
 await page.route("**/api/quizzes/**",route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith("/problem-history")){if(first){first=false;return route.fulfill({status:503,json:{}});}return route.fulfill({json:{data:history}});}
  if(url.pathname.endsWith("/problem-history/old-child")&&route.request().method()==="DELETE"){
   history=problemHistorySchema.parse({items:[{notice:"문제 의미 오류",grid:null,submission:{status:"deleted",quizVariantId:"old-child",quizRevision:1,deletedAt:"2026-09-23T00:00:00.000Z"}}]});return route.fulfill({json:{data:{submission:history.items[0]!.submission}}});}
  if(url.pathname.endsWith("/me"))return route.fulfill({json:{data:{submission:null}}});
  return route.fulfill({json:data});
 });
 await page.goto(`/quiz/${quiz.slug}`);await expect(page.getByText("문제 수정본",{exact:true})).toBeVisible();
 const panel=page.getByRole("region",{name:"이전 오류본 본인 기록",exact:true});
 await panel.getByRole("button",{name:"이전 오류본의 내 제출 기록",exact:true}).click();await expect(panel.getByRole("alert")).toBeVisible();
 await panel.getByRole("button",{name:"이전 오류본의 내 제출 기록",exact:true}).click();await expect(panel.getByRole("heading",{name:"문제 오류로 종료된 버전 1"})).toBeVisible();
 await expect(panel.getByTestId("result-answer-grid")).toBeVisible();await expect(panel.getByTestId("result-solution-grid")).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.screenshot({path:testInfo.outputPath("problem-history.png")});
 await panel.getByRole("button",{name:"이전 제출 삭제",exact:true}).click();await panel.getByRole("button",{name:"취소",exact:true}).click();await expect(panel.getByTestId("result-answer-grid")).toBeVisible();
 await panel.getByRole("button",{name:"이전 제출 삭제",exact:true}).click();await panel.getByRole("button",{name:"이전 제출 삭제 확인",exact:true}).click();
 await expect(panel).toContainText("삭제한 제출입니다");await expect(panel.getByTestId("result-answer-grid")).toHaveCount(0);
 await expect(page.getByRole("grid",{name:/낱말/u}).first()).toBeVisible();
});
