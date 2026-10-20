import { AdminLabel } from "../../components/AdminHelp";
import { AdminConcepts, AdminEmoji } from "../../components/AdminHelp";
import { AdminScreenshots } from "../../components/AdminScreenshots";
import { AdminTool } from "../../components/AdminGuide";
import { Button, ButtonLink } from "../../components/Button";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { weeklyQuizSchema } from "../../../shared/api/admin-weekly";
import { draftCleanupListSchema } from "../../../shared/api/admin-draft-cleanup";
import { AdminSermonInput } from "../admin-sermon-input/AdminSermonInput";
import { PublishedMetadata } from "../admin-sermon-input/PublishedMetadata";
import { WithdrawPublication } from "../admin-sermon-input/WithdrawPublication";
import { ProblemCorrection } from "../admin-sermon-input/ProblemCorrection";
import { QuizDeadline } from "../admin-sermon-input/QuizDeadline";
import { WinnerSettings } from "./WinnerSettings";
import { WorkspaceMeta } from "./WorkspaceMeta";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function Component(){
  const {id}=useParams(),[query]=useSearchParams();
  const [quiz,setQuiz]=useState<ReturnType<typeof weeklyQuizSchema.parse>|null>(null),[message,setMessage]=useState(''),[attempt,setAttempt]=useState(0),[due,setDue]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();
    if(!id)return()=>controller.abort();void weeklyRequest(`/api/admin/quiz-sets/${id}/workspace`,weeklyQuizSchema,'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted)setQuiz(next);}).catch(()=>{if(!controller.signal.aborted)setMessage('퀴즈를 불러오지 못했습니다.');});
    void weeklyRequest('/api/admin/draft-cleanup',draftCleanupListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setDue(data.items.find(item=>item.sermonId===quiz?.sermonId)?.dueAt??null);}).catch(()=>{});return()=>controller.abort();},[id,attempt,quiz?.sermonId]);
  const published=quiz&&['published','archived'].includes(quiz.status);
  return <div className={`${styles.page} ${styles.workspace}`} data-admin-clear data-admin-workspace data-admin-tool-page={published || undefined}><Link className={styles.backLink} to="/admin">← 퀴즈 목록</Link>{message&&<div><p role="alert">{message}</p><Button onClick={()=>{setMessage('');setAttempt(a=>a+1);}}>다시 불러오기</Button></div>}
    {!id?<AdminSermonInput key="new" weekly/>:!quiz?!message&&<p role="status">퀴즈를 불러오고 있습니다.</p>:<>
      <header className={styles.workspaceHeader}><h2><AdminEmoji>🧩</AdminEmoji>{quiz.title}</h2><WorkspaceMeta quiz={quiz} due={due}/></header>
      {published?<>
        <details className={styles.workspaceHelp}><summary><AdminLabel text="용어·화면 안내"/></summary><div className={styles.quickHelp}><AdminConcepts terms={["발행", "접수 마감", "Top N"]}/>
        <AdminScreenshots ids={["settings"]} compact/></div></details>
        <div className={styles.settingsActions}>
        <p className={styles.hint}>{query.get('operation')==='deadline'?'참여자가 답안을 제출할 수 있는 마지막 시각을 관리합니다. 변경 내용을 확인한 뒤 저장하세요.':query.get('operation')==='winners'?'모든 문제를 맞힌 참여자 중 결과 화면과 출력물에 보여 줄 인원을 난이도별로 정합니다.':'수정할 항목을 선택하세요. 변경 전 확인 단계에서 영향을 안내합니다.'}</p>
        <div className={styles.actions}><ButtonLink to={`/quiz/${quiz.slug}`}>공개 화면 보기 ↗</ButtonLink><ButtonLink to={`/admin/submissions?quiz=${id}`}>참여 기록 {quiz.totalCount}건</ButtonLink></div>
        </div>
        {query.get('operation')==='deadline'?<div data-admin-sheet><QuizDeadline quizSetId={id} onSaved={()=>setAttempt(a=>a+1)}/></div>:query.get('operation')==='winners'?<div data-admin-sheet><WinnerSettings quizSetId={id}/></div>:<>
          <AdminTool id="quiz-metadata" title="발행 정보" tag="" description="제목·설교일·요약·단서의 표현을 수정합니다."><PublishedMetadata initialQuizSetId={id}/></AdminTool>
          <AdminTool id="quiz-deadline" title="접수 마감" tag="" description="참여자가 답안을 제출할 수 있는 마지막 시각을 정합니다."><QuizDeadline quizSetId={id} onSaved={()=>setAttempt(a=>a+1)}/></AdminTool>
          <AdminTool id="quiz-winners" title="결과·순위 표시" tag="" description="모든 문제를 맞힌 참여자 중 결과에 표시할 인원을 정합니다."><WinnerSettings quizSetId={id}/></AdminTool>
          {quiz.totalCount===0?<AdminTool id="quiz-withdrawal" title="발행 취소" tag="" description="아직 제출이 없는 퀴즈를 비공개로 돌리고 다시 준비합니다."><WithdrawPublication initialQuizSetId={id}/></AdminTool>:<AdminTool id="quiz-correction" title="문제·정답 수정" tag="" description="접수를 멈추고 문제 오류를 수정합니다. 기존 답안과 결과는 보존됩니다."><ProblemCorrection initialQuizSetId={id}/></AdminTool>}
        </>}
      </>:quiz.withdrawn?<div data-admin-sheet><WithdrawPublication initialReviewId={id}/></div>:quiz.expired?<p data-admin-sheet>초안 본문이 정리되었습니다. 기존 발행 기록과 비용은 보존됩니다.</p>:<><AdminSermonInput key={quiz.sermonId} initialSermonId={quiz.sermonId} quizSetId={id} weekly onSaved={()=>setAttempt(a=>a+1)}/></>}
    </>}
  </div>;
}
