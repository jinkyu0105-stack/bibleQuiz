import type { Page } from '@playwright/test';
import { adminContentViewSchema } from '../../../shared/api/admin-content-generation';
import { searchCandidatePool } from '../../../shared/puzzle/pool-search';
import { presentPlacement } from '../../../workers/_shared/services/placement-presentation';
import { guideContent, guideQuiz, mockAdminGuide } from './admin-guide';

// Read-only examples for the real six-step workspace, never saved to the demo database.
export function workspaceContent() {
  const view=guideContent();
  const summary=view.snapshots.find(s=>s.kind==='summary')!;
  if(summary.kind!=='summary')throw new Error('Missing synthetic summary');
  const options={gridSizes:[5,6],targetWordCounts:[4],seed:'placement-test',maxTrials:16,searchBudgetPerTrial:3000};
  const candidates=['가나다','라마바','가사라','다아바','허호'].map((answer,index)=>({id:`entry-${index+1}`,displayAnswer:answer,gridAnswer:answer,clue:`연습 문제 ${index+1}`,status:'use' as const,phrase:'화면 확인용 가상 단어'}));
  const layouts=searchCandidatePool({...options,candidates}).layouts.map((layout,index)=>presentPlacement(layout,index,candidates));
  const layout=layouts[0];if(!layout)throw new Error('Missing synthetic layout');
  return adminContentViewSchema.parse({...view,status:'review_ready',stage:'finish',
    content:{state:'present',intent:{selectedId:'analysis',rootAnalysisId:'analysis',confirmation:{id:'intent-confirmed'}},summary:{id:'summary',review:{id:'summary-reviewed'}},child:{id:'child',review:{id:'child-reviewed'}},adult:{id:'adult',review:{id:'adult-reviewed'}}},
    snapshots:[{kind:'intent',value:{id:'analysis',kind:'analysis',binding:summary.value.binding.transcript,critiqueId:'critique',analysis:{centralMessage:[{id:'claim',origin:'transcript',text:'서로 사랑하며 이웃을 돕는 삶을 생각합니다.',evidence:summary.value.draft.paragraphs[0]!.evidence}],purpose:[],bibleRelationship:[],argumentFlow:[],repeatedEmphasis:[],illustrations:[],audienceResponse:[],warnings:[],uncertainties:[]}},critique:null},...view.snapshots],
    placement:{revision:1,metadataRevision:1,selected:true,current:true,selection:{child:{options,index:0},adult:{options,index:0}}},
    reviewLayouts:{child:layout,adult:layout},preview:{metadata:{title:guideQuiz.title,date:guideQuiz.sermonDate,bibleReferenceLabel:'요한복음 3:16',translation:'개역개정',bibleReadingUrl:'https://www.bskorea.or.kr/bible/korbibReadpage.php'},summary:{text:'서로 사랑하며 이웃을 돕는 삶을 생각합니다. 작은 친절을 실천하는 한 주를 준비합니다.',disclosure:'화면 검수를 위한 연습 자료입니다. 실제 설교나 AI 생성 결과가 아닙니다.'},variants:{child:layout.grid,adult:layout.grid}}
  });
}

export async function mockAdminWorkspace(page:Page) {
  const writes=await mockAdminGuide(page,workspaceContent());
  const published={quizSetId:'published-example',slug:'2026-10-01-abc234',status:'published',revision:0,metadata:{title:'함께 걷는 기쁨 · 연습',sermonDate:'2026-10-11'},publishedAt:'2026-10-11T00:00:00.000Z',closesAt:'2026-10-18T12:00:00.000Z'};
  await page.route('**/api/admin/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET'){writes.push(p);return route.abort('blockedbyclient');}
    const data=p.endsWith('/published-quizzes')?{items:[published]}:
      p.endsWith('/display-text')?{quiz:published,history:[]}:
      p.endsWith('/winner-settings')?{child:3,adult:3,revision:'0',editable:true}:
      p.endsWith('/closes-at')?{quizSetId:published.quizSetId,closesAt:published.closesAt,closesAtKst:'2026. 10. 18. 오후 9:00:00',changeable:true,paused:false,remainingSeconds:345600,impact:{total:7,visible:7,hidden:0,deleted:0},history:[]}:
      p.endsWith('/problem-corrections')?{status:'ready',cycle:0,nonRanked:false,closesAt:published.closesAt,variants:{child:'child-1',adult:'adult-1'},impact:[],editor:null,notice:null,levels:[]}:null;
    if(data===null)return route.fallback();
    return route.fulfill({json:{data}});
  });
  return writes;
}
