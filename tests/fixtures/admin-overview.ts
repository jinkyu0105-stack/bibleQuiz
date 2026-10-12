import type { Page } from "@playwright/test";
import { weeklyDashboardSchema } from "../../shared/api/admin-weekly";
export const overviewTime="2026-10-12T09:00:00.000Z";
const draft={quizSetId:"demo-draft",sermonId:"demo-sermon",title:"[체험 초안] 이웃에게 전하는 작은 친절",sermonDate:"2026-10-12",slug:null,status:"draft",submissionStatus:"open",closesAt:null,updatedAt:overviewTime,featured:false,expired:false,stage:null,jobStatus:null,visibleCount:0,totalCount:0};
export const overview=weeklyDashboardSchema.parse({items:[draft,
 {...draft,quizSetId:"demo-live",title:"[체험 퀴즈] 서로 돕는 마음",slug:"2026-10-12-demo01",status:"published",closesAt:"2099-10-26T14:59:59.000Z"},
 {...draft,quizSetId:"demo-past1",title:"[체험 지난 퀴즈] 함께 걸어요",sermonDate:"2026-10-05",slug:"2026-10-05-demo02",status:"archived",closesAt:"2026-10-11T14:59:59.000Z",visibleCount:6,totalCount:6,childVisibleCount:3,adultVisibleCount:3},
 {...draft,quizSetId:"demo-past2",title:"[체험 지난 퀴즈] 감사하는 하루",sermonDate:"2026-09-28",slug:"2026-09-28-demo03",status:"archived",closesAt:"2026-10-04T14:59:59.000Z",visibleCount:6,totalCount:6,childVisibleCount:3,adultVisibleCount:3}],unansweredCount:2,homeQuiz:{quizSetId:"demo-live",selection:"automatic"}});
export async function mockOverview(page:Page) {
 const writes:string[]=[];
 await page.route("**/api/admin/**",route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()!=="GET"){writes.push(path);return route.fulfill({status:405,json:{error:{message:"읽기 시험"}}});}
  if(path.endsWith("/dashboard"))return route.fulfill({json:{data:overview}});
  if(path.endsWith("/workspace"))return route.fulfill({json:{data:overview.items[2]}});
  if(path.endsWith("/privacy-requests"))return route.fulfill({json:{data:{items:[{id:"11111111-1111-4111-8111-111111111111",requestType:"delete_submission",quizSlug:"2026-10-05-demo02",submittedName:"연습 참가자 하늘",message:"테스트로 남긴 제 이름과 답안을 삭제해 주세요.",status:"received",adminResponse:null,createdAt:overviewTime,updatedAt:overviewTime}]}}});
  if(path.endsWith("/submissions"))return route.fulfill({json:{data:{items:[{id:"demo-person",difficulty:"child",revision:1,status:"visible",displayName:"연습 참가자 봄",comment:"함께 생각하며 풀어서 더 재미있었어요.",submittedAt:overviewTime,scorePercent:100,answers:{r0c0:"사",r0c1:"랑"},actions:[]}]}}});
  return route.fulfill({json:{data:{items:[]}}});
 });
 return writes;
}
