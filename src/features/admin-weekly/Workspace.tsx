import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { weeklyDashboardSchema, weeklyQuizSchema } from "../../../shared/api/admin-weekly";
import { draftCleanupListSchema } from "../../../shared/api/admin-draft-cleanup";
import { AdminSermonInput } from "../admin-sermon-input/AdminSermonInput";
import { PublishedMetadata } from "../admin-sermon-input/PublishedMetadata";
import { WithdrawPublication } from "../admin-sermon-input/WithdrawPublication";
import { ProblemCorrection } from "../admin-sermon-input/ProblemCorrection";
import { QuizDeadline } from "../admin-sermon-input/QuizDeadline";
import { WinnerSettings } from "./WinnerSettings";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function Component(){
  const navigate=useNavigate();
  const [newChecked,setNewChecked]=useState(false);
  const {id}=useParams(),[query]=useSearchParams();
  const [quiz,setQuiz]=useState<ReturnType<typeof weeklyQuizSchema.parse>|null>(null),[message,setMessage]=useState(''),[attempt,setAttempt]=useState(0),[due,setDue]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();
    if(!id){void weeklyRequest('/api/admin/dashboard',weeklyDashboardSchema,'GET',undefined,controller.signal).then(data=>{
      if(controller.signal.aborted)return;
      const draft=data.items.find(q=>!q.expired&&!['published','archived'].includes(q.status));
      if(draft)navigate(`/admin/quiz/${draft.quizSetId}`,{replace:true});else setNewChecked(true);
    }).catch(()=>{if(!controller.signal.aborted)setMessage('기존 작업을 확인하지 못했습니다. 주간 운영 첫 화면에서 다시 확인해 주세요.');});return()=>controller.abort();}void weeklyRequest(`/api/admin/quiz-sets/${id}/workspace`,weeklyQuizSchema,'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted)setQuiz(next);}).catch(()=>{if(!controller.signal.aborted)setMessage('주간 작업을 불러오지 못했습니다.');});
    void weeklyRequest('/api/admin/draft-cleanup',draftCleanupListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setDue(data.items.find(item=>item.sermonId===quiz?.sermonId)?.dueAt??null);}).catch(()=>{});return()=>controller.abort();},[id,attempt,quiz?.sermonId,navigate]);
  const published=quiz&&['published','archived'].includes(quiz.status);
  return <div className={styles.page}>{message&&<p role="alert">{message}</p>}
    {!id?(newChecked?<AdminSermonInput weekly/>:<p role="status">기존 주간 작업을 확인하고 있습니다.</p>):!quiz?<p role="status">주간 작업을 확인하고 있습니다.</p>:<>
      <header className={styles.workspaceHeader}><h2>{quiz.title}</h2><p>{quiz.sermonDate} · {published?quiz.status==='archived'?'마감된 퀴즈':'발행된 퀴즈':'주간 초안'}</p><details><summary>저장·초안 보관 정보</summary><p>마지막 저장: {new Date(quiz.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국 시간) · 초안 본문 정리 예정: {due?new Date(due).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'초안 보관 현황에서 확인'}</p></details></header>
      {published?<>
        <div className={styles.actions}><Link to={`/quiz/${quiz.slug}`}>공개 화면 보기</Link><Link to={`/admin/submissions?quiz=${id}`}>제출 기록 관리</Link></div>
        {query.get('operation')==='deadline'?<QuizDeadline quizSetId={id} onSaved={()=>setAttempt(a=>a+1)}/>:query.get('operation')==='winners'?<WinnerSettings quizSetId={id}/>:<>
          <PublishedMetadata initialQuizSetId={id}/><WinnerSettings quizSetId={id}/>
          {quiz.totalCount===0?<WithdrawPublication initialQuizSetId={id}/>:<ProblemCorrection initialQuizSetId={id}/>}<QuizDeadline quizSetId={id} onSaved={()=>setAttempt(a=>a+1)}/>
        </>}
      </>:quiz.withdrawn?<WithdrawPublication initialReviewId={id}/>:quiz.expired?<p>초안 본문이 정리되었습니다. 기존 발행 기록과 비용은 보존됩니다.</p>:<><AdminSermonInput key={quiz.sermonId} initialSermonId={quiz.sermonId} quizSetId={id} weekly onSaved={()=>setAttempt(a=>a+1)}/></>}
    </>}
  </div>;
}
