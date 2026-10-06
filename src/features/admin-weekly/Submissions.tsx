import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { submissionListSchema, weeklyDashboardSchema } from "../../../shared/api/admin-weekly";
import { deletedSubmissionAsAdminDataSchema, moderatedSubmissionDataSchema } from "../../../shared/api/admin-submission-moderation";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function Component(){
  const [query,setQuery]=useSearchParams(),id=query.get('quiz')??'';
  const [quizzes,setQuizzes]=useState<ReturnType<typeof weeklyDashboardSchema.parse>['items']>([]),[result,setResult]=useState<{quizId:string;items:ReturnType<typeof submissionListSchema.parse>['items']}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[level,setLevel]=useState('all'),[state,setState]=useState('all');
  const items = result?.quizId === id ? result.items : null;
  const selected=quizzes.find(q=>q.quizSetId===id);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest('/api/admin/dashboard',weeklyDashboardSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setQuizzes(data.items);}).catch(()=>{if(!controller.signal.aborted)setMessage('퀴즈 목록을 불러오지 못했습니다.');});return()=>controller.abort();},[]);
  useEffect(()=>{if(!id)return;const controller=new AbortController();void weeklyRequest(`/api/admin/submissions?quizSetId=${encodeURIComponent(id)}`,submissionListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setResult({quizId:id,items:data.items});}).catch(()=>{if(!controller.signal.aborted)setMessage('제출 목록을 불러오지 못했습니다.');});return()=>controller.abort();},[id,attempt]);
  async function action(item:NonNullable<typeof items>[number],kind:string,reason:string){if(busy||!selected)return;
    const description=`${selected.sermonDate} · ${selected.title}\n${item.difficulty==='child'?'어린이':'장년'} · ${item.displayName??'삭제된 제출'}\n${kind==='delete'?'이름·답안·코멘트를 제거합니다. 복구할 수 없고 같은 난이도 재제출도 불가능합니다.':kind==='hide'?'공개 참여 현황과 Top N에서 숨깁니다.':'공개 참여 현황에 다시 표시합니다.'}\n사유: ${reason}`;
    if(!window.confirm(description))return;setBusy(true);setMessage('');try{
      if(kind==='delete')await weeklyRequest(`/api/admin/submissions/${item.id}`,deletedSubmissionAsAdminDataSchema,'DELETE',{confirmation:'delete',reason});
      else await weeklyRequest(`/api/admin/submissions/${item.id}`,moderatedSubmissionDataSchema,'PATCH',{action:kind,reason});
      setMessage('제출 조치를 저장했습니다.');setAttempt(a=>a+1);
    }catch(error){setMessage(error instanceof Error?error.message:'처리 결과를 확인하지 못했습니다.');}finally{setBusy(false);}}
  return <div className={styles.page}><header className={styles.hero}><h2>제출 기록 관리</h2><p>기존 성적과 확정 순위는 보존하고 공개 표시 또는 개인정보만 조치합니다.</p></header>{message&&<p role="status">{message}</p>}
    <div className={styles.fields}><label>관리할 퀴즈<select value={id} disabled={busy} onChange={e=>{setResult(null);setQuery({quiz:e.target.value});}}><option value="">퀴즈 선택</option>{quizzes.filter(q=>['published','archived'].includes(q.status)).map(q=><option key={q.quizSetId} value={q.quizSetId}>{q.sermonDate} · {q.title}</option>)}</select></label>
    <label>난이도 필터<select value={level} onChange={e=>setLevel(e.target.value)}><option value="all">모두</option><option value="child">어린이</option><option value="adult">장년</option></select></label><label>상태 필터<select value={state} onChange={e=>setState(e.target.value)}><option value="all">모두</option><option value="visible">공개</option><option value="hidden">숨김</option><option value="deleted">삭제</option></select></label><button disabled={busy} onClick={()=>setAttempt(a=>a+1)}>제출 목록 새로고침</button></div>
    {id&&items===null&&<p role="status">제출 기록을 불러오고 있습니다.</p>}{items&&items.length===0&&<p>이 퀴즈에는 제출이 없습니다.</p>}
    <ul className={styles.list}>{items?.filter(i=>(level==='all'||i.difficulty===level)&&(state==='all'||i.status===state)).map(item=><li key={item.id} className={styles.panel}><h3>{item.displayName??'삭제된 제출'}</h3><p>{item.difficulty==='child'?'어린이':'장년'} · 버전 {item.revision} · {item.status==='visible'?'공개':item.status==='hidden'?'숨김':'삭제·복구 불가'} · {item.scorePercent}%</p><p>{new Date(item.submittedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국 시간)</p>{item.comment&&<p>{item.comment}</p>}
      {item.answers&&<details><summary>실제 제출 답안</summary><dl>{Object.entries(item.answers).map(([cell,value])=><div key={cell}><dt>{cell}</dt><dd>{value||'빈칸'}</dd></div>)}</dl></details>}
      {item.status!=='deleted'&&<form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void action(item,String(fields.get('action')),String(fields.get('reason')));}}><div className={styles.fields}><label>제출 조치<select name="action"><option value={item.status==='visible'?'hide':'unhide'}>{item.status==='visible'?'숨김':'복원'}</option><option value="delete">개인정보 삭제 (복구 불가)</option></select></label><label>조치 사유<input name="reason" required minLength={2} maxLength={500}/></label><button disabled={busy||!selected}>영향 확인·조치</button></div></form>}
      <details><summary>조치 이력 ({item.actions.length})</summary>{item.actions.map((a,index)=><p key={index}>{a.createdAt} · {a.action} · {a.reason}</p>)}</details></li>)}</ul>
  </div>;
}
