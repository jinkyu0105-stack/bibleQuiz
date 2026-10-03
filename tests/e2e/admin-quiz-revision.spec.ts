import { expect,test } from "@playwright/test";
import { generatePuzzle,PUZZLE_FIXTURES,serializePublicPuzzle } from "../../shared/puzzle";
import { revisionBodySchema, type RevisionView, type RevisionContent } from "../../shared/api/admin-quiz-revision";
import type { WithdrawalView } from "../../shared/api/admin-withdraw";
const generated=generatePuzzle({...PUZZLE_FIXTURES.fiveByFive,candidates:PUZZLE_FIXTURES.fiveByFive.candidates.map((c,i)=>({...c,id:`entry-${i}`}))});
if(!generated.ok) throw new Error("fixture");
const grid=serializePublicPuzzle(generated.puzzle),solution=generated.puzzle.solution;
const baseBody=revisionBodySchema.parse({content:{metadata:{title:"합성 철회본",sermonDate:"2026-09-20"},churchName:"합성 교회",bibleReferenceLabel:"요한복음 3:16",summary:"보존된 설교 요약",
 child:grid.entries.map(e=>({id:e.id,answer:solution.entries[e.id],clue:e.clue,evidence:""})),adult:grid.entries.map(e=>({id:e.id,answer:solution.entries[e.id],clue:e.clue,evidence:""}))},
 layouts:{child:{grid,solution},adult:{grid,solution}},reviewed:{summary:false,child:false,adult:false}});
const source:WithdrawalView={quizSetId:"synthetic-revision",reviewRevision:2,withdrawnAt:"2026-09-23T00:00:00.000Z",reason:"합성 철회",review:{metadata:baseBody.content.metadata,
 slug:"2026-09-20-abc123",summary:baseBody.content.summary,disclosure:"아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.",churchName:baseBody.content.churchName,
 bibleReferenceLabel:baseBody.content.bibleReferenceLabel,translation:"개역개정",bibleReadingUrl:"https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
 variants:(["child","adult"] as const).map(difficulty=>({sourceVariantId:`synthetic-${difficulty}`,sourceRevision:1,difficulty,grid:{size:5,cells:[]},
 entries:grid.entries.map((e,i)=>({id:e.id,number:e.number,direction:e.direction,startRow:e.start.row,startCol:e.start.column,length:e.length,clue:e.clue!,grounding:{origin:"admin_context",note:"보존 근거"},displayOrder:i})),
 canonicalCellOrder:grid.cells.map(c=>c.id),solutionCells:solution.cells,entryAnswers:solution.entries,solutionSha256:"a".repeat(64)}))}};

test("saves, restores, compares a free layout, reviews both difficulties and retries a lost republication response",async({page},testInfo)=>{
 let view:RevisionView={quizSetId:source.quizSetId,sessionId:null,cycle:0,revision:0,state:"not_started",body:null,sourceEvidence:{},slug:source.review.slug,disclosure:source.review.disclosure,
 translation:"개역개정",bibleReadingUrl:source.review.bibleReadingUrl,issues:[],canPublish:false,savedAt:null,publication:null};
 const commands:Record<string,unknown>[]=[],seen=new Set<string>();let losePublish=true;
 await page.route("**/api/admin/published-quizzes",route=>route.fulfill({json:{data:{items:[]}}}));
 await page.route("**/api/admin/withdrawn-quizzes",route=>route.fulfill({json:{data:{items:[{quizSetId:source.quizSetId,title:source.review.metadata.title,withdrawnAt:source.withdrawnAt,reviewRevision:2}]}}}));
 await page.route(`**/api/admin/quiz-sets/${source.quizSetId}/withdraw-to-review`,route=>route.fulfill({json:{data:source}}));
 await page.route(`**/api/admin/quiz-sets/${source.quizSetId}/revision`,async route=>{
  if(route.request().method()==="GET") return route.fulfill({json:{data:view}});
  const cmd=route.request().postDataJSON() as Record<string,unknown>;commands.push(cmd);
  if(cmd.action==="trial") return route.fulfill({json:{data:{difficulty:cmd.difficulty,gridSize:5,seed:cmd.seed,layout:{grid,solution},issues:[]}}});
  if(!seen.has(String(cmd.requestKey))){
   seen.add(String(cmd.requestKey));
   if(cmd.action==="start") view={...view,state:"editing",sessionId:"11111111-1111-4111-8111-111111111111",cycle:1,revision:1,body:structuredClone(baseBody),savedAt:"2026-09-23T01:00:00.000Z"};
   else if(cmd.action==="save") {view.body!.content=cmd.content as RevisionContent;view.body!.reviewed={summary:false,child:false,adult:false};view.revision++;}
   else if(cmd.action==="layout") {view.body!.reviewed={summary:false,child:false,adult:false};view.revision++;}
   else if(cmd.action==="review") {view.body!.reviewed[cmd.area as "summary"|"child"|"adult"]=true;view.revision++;}
   else if(cmd.action==="publish") view={...view,state:"published",publication:{publishedAt:"2026-09-24T00:00:00.000Z",closesAt:"2026-10-01T00:00:00.000Z"}};
   view.canPublish=view.state==="editing" && Object.values(view.body!.reviewed).every(Boolean);
  }
  if(cmd.action==="publish" && losePublish){losePublish=false;return route.fulfill({status:503,json:{}});}
  return route.fulfill({json:{data:view}});
 });
 await page.goto("/admin/tools");await page.getByLabel("철회한 퀴즈 검수 자료").selectOption(source.quizSetId);
 const panel=page.getByRole("region",{name:"철회본 편집과 재발행"});
 await panel.getByRole("button",{name:"새 편집 시작",exact:true}).click();
 await panel.getByRole("textbox",{name:"편집 요약",exact:true}).fill("새로 검토할 요약");
 await expect(panel.getByRole("button",{name:"설교 정보·요약 검토 완료",exact:true})).toBeDisabled();
 await panel.getByRole("button",{name:"편집본 저장",exact:true}).click();await expect(panel).toContainText("저장본 2");
 await page.reload();await page.getByLabel("철회한 퀴즈 검수 자료").selectOption(source.quizSetId);
 await expect(panel.getByRole("textbox",{name:"편집 요약",exact:true})).toHaveValue("새로 검토할 요약");
 await panel.getByRole("button",{name:"어린이 무료 배치 시험",exact:true}).click();
 await expect(panel.getByRole("grid",{name:"어린이 시험 격자",exact:true})).toBeVisible();
 await panel.getByRole("button",{name:"어린이 이 배치 사용",exact:true}).click();
 await panel.getByLabel("관리자 정답 보기",{exact:true}).check();
 for(const name of ["어린이 문제·정답·근거 검토 완료","장년 문제·정답·근거 검토 완료","설교 정보·요약 검토 완료"]) await panel.getByRole("button",{name,exact:true}).click();
 await expect(panel.getByRole("button",{name:"재발행 확인",exact:true})).toBeEnabled();
 await panel.getByLabel("편집 제목",{exact:true}).fill("저장 전 변경");
 await expect(panel.getByRole("button",{name:"재발행 확인",exact:true})).toBeDisabled();
 await panel.getByRole("button",{name:"저장본 다시 불러오기",exact:true}).click();
 await panel.getByRole("button",{name:"입력 유지",exact:true}).click();await expect(panel.getByLabel("편집 제목",{exact:true})).toHaveValue("저장 전 변경");
 await panel.getByRole("button",{name:"저장본 다시 불러오기",exact:true}).click();await panel.getByRole("button",{name:"입력 버리고 불러오기",exact:true}).click();
 await panel.screenshot({path:testInfo.outputPath("revision-light.png")});
 await page.getByLabel("화면 테마").selectOption("dark");await panel.screenshot({path:testInfo.outputPath("revision-dark.png")});
 await panel.getByRole("group",{name:"설교 정보와 요약",exact:true}).screenshot({path:testInfo.outputPath("revision-metadata-dark.png")});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.getByRole("button",{name:"재발행 확인",exact:true}).click();
 await panel.getByRole("button",{name:"재발행 취소",exact:true}).click();expect(commands.filter(c=>c.action==="publish")).toHaveLength(0);
 await panel.getByRole("button",{name:"재발행 확인",exact:true}).click();await panel.getByRole("button",{name:"지금 재발행",exact:true}).click();
 await expect(panel.getByRole("alert")).toContainText("입력은 유지");await panel.getByRole("button",{name:"같은 요청 재확인",exact:true}).click();
 const pubs=commands.filter(c=>c.action==="publish");expect(pubs).toHaveLength(2);expect(pubs[0]).toEqual(pubs[1]);
 await expect(panel.getByRole("link",{name:"발행한 퀴즈 열기"})).toHaveAttribute("href",`/quiz/${source.review.slug}`);
 await expect(panel).toContainText(/마감 2026.*10.*1.*오전 9:00/u);
});
