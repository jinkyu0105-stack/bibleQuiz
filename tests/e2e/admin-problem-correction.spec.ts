import { problemViewSchema,type ProblemView } from "../../shared/api/admin-problem-correction";
import { expect,test } from "@playwright/test";
import { generatePuzzle,PUZZLE_FIXTURES,serializePublicPuzzle } from "../../shared/puzzle";
import { revisionBodySchema, type RevisionContent } from "../../shared/api/admin-quiz-revision";
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

for(const nonRanked of [false,true]) test(`problem correction pauses, preserves the deadline and publishes ${nonRanked ? "without ranks":"before closing"}`,async({page},testInfo)=>{
 let view:ProblemView={editor:null,status:"ready",cycle:0,closesAt:"2026-09-28T00:00:00.000Z",notice:null,levels:[],variants:{child:"original-child",adult:"original-adult"},
 impact:[{difficulty:"child",variantId:"original-child",revision:1,visible:3,hidden:1,deleted:1,winners:0},{difficulty:"adult",variantId:"original-adult",revision:1,visible:2,hidden:0,deleted:0,winners:0}],nonRanked};
 const commands:Record<string,unknown>[]=[],seen=new Set<string>();let losePublish=true;
 await page.route("**/api/admin/published-quizzes",route=>route.fulfill({json:{data:{items:[{quizSetId:source.quizSetId,slug:source.review.slug,status:"published",revision:0,metadata:source.review.metadata,publishedAt:"2026-09-21T00:00:00.000Z",closesAt:view.closesAt}]}}}));
 await page.route("**/api/admin/withdrawn-quizzes",route=>route.fulfill({json:{data:{items:[]}}}));
 await page.route(`**/api/admin/quiz-sets/${source.quizSetId}/problem-corrections`,async route=>{
  if(route.request().method()==="GET")return route.fulfill({json:{data:problemViewSchema.parse(view)}});
  const cmd=route.request().postDataJSON() as Record<string,unknown>;commands.push(cmd);
  if(cmd.action==="trial")return route.fulfill({json:{data:{difficulty:cmd.difficulty,gridSize:5,seed:cmd.seed,layout:{grid,solution},issues:[]}}});
  if(!seen.has(String(cmd.requestKey))){seen.add(String(cmd.requestKey));
   if(cmd.action==="start")view={...view,status:"editing",cycle:1,levels:["child"],notice:"수정 확인 중",editor:{quizSetId:source.quizSetId,sessionId:"11111111-1111-4111-8111-111111111111",cycle:1,revision:1,state:"editing",body:structuredClone(baseBody),sourceEvidence:{},slug:source.review.slug,disclosure:source.review.disclosure,translation:"개역개정",bibleReadingUrl:source.review.bibleReadingUrl,issues:[],canPublish:false,savedAt:"2026-09-23T00:00:00.000Z",publication:null}};
   else if(cmd.action==="save"){view.editor!.body!.content=cmd.content as RevisionContent;view.editor!.body!.reviewed={summary:false,child:false,adult:false};view.editor!.revision++;}
   else if(cmd.action==="review"){view.editor!.body!.reviewed[cmd.area as "summary"|"child"|"adult"]=true;view.editor!.revision++;}
   else if(cmd.action==="layout"){view.editor!.body!.reviewed={summary:false,child:false,adult:false};view.editor!.revision++;}
   else if(cmd.action==="publish"){view.status="published";view.editor!.state="published";view.editor!.publication={publishedAt:"2026-09-24T00:00:00.000Z",closesAt:view.closesAt};}
   if(view.editor)view.editor.canPublish=view.status==="editing"&&Object.values(view.editor.body!.reviewed).every(Boolean);
  }
  if(cmd.action==="publish"&&losePublish){losePublish=false;return route.fulfill({status:503,json:{}});}
  return route.fulfill({json:{data:problemViewSchema.parse(view)}});
 });
 await page.goto("/admin/tools");const panel=page.getByRole("region",{name:"첫 제출 후 문제 오류 처리",exact:true});
 await panel.getByLabel("오류를 처리할 퀴즈",{exact:true}).selectOption(source.quizSetId);
 await expect(panel).toContainText("공개 3건 · 숨김 1건 · 삭제 1건");
 await panel.getByLabel("관리자 오류 확인 사유",{exact:true}).fill("단서 의미 오류 확인");await panel.getByLabel("공개 중지 안내",{exact:true}).fill("문제를 확인하고 있습니다.");
 await panel.getByRole("button",{name:"접수 중지와 영향 확인",exact:true}).click();await panel.getByRole("button",{name:"돌아가기",exact:true}).click();expect(commands).toHaveLength(0);
 await panel.getByRole("button",{name:"접수 중지와 영향 확인",exact:true}).click();await panel.getByRole("button",{name:"접수 중지하고 수정 시작",exact:true}).click();
 const editor=panel.getByRole("region",{name:"문제 오류 수정본 편집",exact:true});await expect(editor).toBeVisible();
 await expect(editor.getByRole("textbox",{name:"편집 요약",exact:true})).toBeDisabled();await expect(editor.getByRole("button",{name:"장년 무료 배치 시험",exact:true})).toBeDisabled();
 const level=editor.getByRole("group",{name:"어린이 문제 편집",exact:true});await level.locator("details").first().locator("summary").first().click();
 await level.getByRole("textbox",{name:"어린이 1 단서",exact:true}).fill("수정한 단서");await level.getByRole("textbox",{name:"어린이 1 수정 근거",exact:true}).fill("설교 의미와 일치함을 확인");
 await expect(editor.getByRole("button",{name:"재발행 확인",exact:true})).toBeDisabled();await editor.getByRole("button",{name:"편집본 저장",exact:true}).click();
 await page.reload();await panel.getByLabel("오류를 처리할 퀴즈",{exact:true}).selectOption(source.quizSetId);await expect(editor).toContainText("수정한 단서");
 for(const name of ["어린이 문제·정답·근거 검토 완료","장년 문제·정답·근거 검토 완료","설교 정보·요약 검토 완료"])await editor.getByRole("button",{name,exact:true}).click();
 await editor.getByRole("button",{name:"재발행 확인",exact:true}).click();
 await expect(editor).toContainText(nonRanked?"순위와 참여 기록 없이 공개":"기존 마감 시각을 유지");
 await expect(editor).not.toContainText("7일 뒤 마감");
 await page.getByLabel("화면 테마").selectOption("dark");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await editor.screenshot({path:testInfo.outputPath("problem-editor-dark.png")});
 await editor.getByRole("button",{name:"지금 재발행",exact:true}).click();await expect(editor.getByRole("alert")).toBeVisible();
 await editor.getByRole("button",{name:"같은 요청 재확인",exact:true}).click();await expect(panel).toContainText("수정본 발행을 완료했습니다");
 const publish=commands.filter(c=>c.action==="publish");expect(publish).toHaveLength(2);expect(publish[0]).toEqual(publish[1]);
});
