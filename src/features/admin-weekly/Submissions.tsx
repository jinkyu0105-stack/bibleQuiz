import { AdminLabel } from "../../components/AdminHelp";
import { AdminSteps } from "../../components/AdminGuide";
import { AdminBoardHeader, AdminRefreshButton } from "../../components/AdminListTools";
import { AdminRecord } from "../../components/AdminRecord";
import record from "./records.module.css";
import { Button } from "../../components/Button";
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
      setMessage('참여 기록의 처리 결과를 저장했습니다.');setAttempt(a=>a+1);
    }catch(error){setMessage(error instanceof Error?error.message:'처리 결과를 확인하지 못했습니다.');}finally{setBusy(false);}}
  const visible=items?.filter(i=>(level==='all'||i.difficulty===level)&&(state==='all'||i.status===state));
  return <div className={record.page}>
    <AdminBoardHeader terms={["숨김", "개인정보 삭제", "Top N"]} screenshots={["submissions"]} title="참여 기록" description="퀴즈별 답안과 코멘트를 확인하고 공개 여부를 관리하세요." actions={<AdminRefreshButton label="제출 목록 새로고침" disabled={busy||!id} onClick={()=>{setMessage('');setAttempt(a=>a+1);}}/>}/>
    <div className={record.fields}>
      <label>관리할 퀴즈<select value={id} disabled={busy} onChange={e=>{setResult(null);setMessage('');setQuery({quiz:e.target.value});}}><option value="">퀴즈 선택</option>{quizzes.filter(q=>['published','archived'].includes(q.status)).map(q=><option key={q.quizSetId} value={q.quizSetId}>{q.sermonDate} · {q.title}</option>)}</select></label>
      <label>난이도 필터<select value={level} onChange={e=>setLevel(e.target.value)}><option value="all">모두</option><option value="child">어린이</option><option value="adult">장년</option></select></label>
      <label>상태 필터<select value={state} onChange={e=>setState(e.target.value)}><option value="all">모두</option><option value="visible">공개</option><option value="hidden">숨김</option><option value="deleted">삭제</option></select></label>
    </div>
    {message&&<p role="status">{message}</p>}
    {id&&<p className={record.count}>참여 기록 <strong>{visible?.length??'—'}</strong>건<span>이름을 누르면 답안과 관리 도구가 열립니다.</span></p>}
    {!id&&<div className={record.empty}><h3><AdminLabel text="어떤 퀴즈의 기록을 볼까요?"/></h3><p>관리할 퀴즈를 선택하면 제출 기록이 표시됩니다.</p></div>}
    {id&&items===null&&!message&&<p role="status">제출 기록을 불러오고 있습니다.</p>}
    {items&&items.length===0&&<div className={record.empty}><h3><AdminLabel text="아직 참여 기록이 없습니다"/></h3><p>이 퀴즈에는 제출이 없습니다.</p></div>}
    {items&&items.length>0&&visible?.length===0&&<p>선택한 난이도·상태에 해당하는 기록이 없습니다. 필터를 ‘모두’로 바꿔 보세요.</p>}
    <ul className={record.list}>{visible?.map(item=><AdminRecord key={item.id} title={item.displayName??'삭제된 제출'} icon={item.difficulty==='child'?'child':'adult'} label={item.difficulty==='child'?'어린이':'장년'} status={item.status==='visible'?'공개':item.status==='hidden'?'숨김':'삭제·복구 불가'} tone={item.status==='visible'?'success':item.status==='hidden'?'attention':'danger'} meta={<><span className={record.score}>{item.scorePercent}점</span><time dateTime={item.submittedAt}>{new Date(item.submittedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})}</time><span>문제 버전 {item.revision}</span></>}>
      <div className={record.submissionDetail}>
        <section className={record.answerSection} aria-label="실제 제출 답안">
          <h4><AdminLabel text="실제 제출 답안"/></h4>
          {item.answers ? <dl className={record.answers}>{Object.entries(item.answers).map(([cell,value])=><div key={cell}><dt>{cell}</dt><dd>{value||'빈칸'}</dd></div>)}</dl> : <p className={record.muted}>개인정보가 삭제되어 답안을 볼 수 없습니다.</p>}
          {item.comment&&<div className={record.comment}><h4><AdminLabel text="참여자 코멘트"/></h4><blockquote>{item.comment}</blockquote></div>}
        </section>
        {item.status!=='deleted'&&<section className={record.management} aria-label="공개 상태·개인정보 관리">
          <h4><AdminLabel text="공개 상태·개인정보 관리"/></h4>
          <form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void action(item,String(fields.get('action')),String(fields.get('reason')));}}>
            <fieldset disabled={busy||!selected} className={record.manageFields}><legend className="sr-only">참여 기록 처리</legend>
              <label>처리할 작업<select name="action"><option value={item.status==='visible'?'hide':'unhide'}>{item.status==='visible'?'숨김':'다시 공개'}</option><option value="delete">개인정보 삭제 (복구 불가)</option></select></label>
              <label>처리 사유<textarea name="reason" required minLength={2} maxLength={500} placeholder="처리 이유를 남겨 주세요"/></label>
              <p className={record.note}>숨긴 기록은 다시 공개할 수 있습니다. 개인정보 삭제는 이름·답안·코멘트를 지우며 복구할 수 없습니다.</p>
              <Button variant="primary">내용 확인 후 처리</Button>
            </fieldset>
          </form>
        </section>}
      </div>
      {item.actions.length>0&&<details className={record.historyDisclosure}><summary>처리 이력 ({item.actions.length})</summary><ul className={record.history}>{item.actions.map((a,index)=><li key={index}><time>{new Date(a.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time><strong>{({hide:'숨김',unhide:'다시 공개',delete:'개인정보 삭제'} as Record<string,string>)[a.action]??a.action}</strong><span>{a.reason}</span></li>)}</ul></details>}
    </AdminRecord>)}</ul>
    <details className={styles.explainer}><summary><AdminLabel text="숨김·다시 공개·삭제는 어떻게 다른가요?"/></summary><dl><dt>숨김</dt><dd>공개 참여 현황과 Top N에서 제외합니다. 기록은 남습니다.</dd><dt>다시 공개</dt><dd>숨긴 기록을 공개 참여 현황에 다시 표시합니다.</dd><dt>개인정보 삭제</dt><dd>이름·답안·코멘트를 제거합니다. 복구와 같은 난이도 재제출은 불가능합니다. 기존 성적과 확정 순위는 보존합니다.</dd></dl></details>
    <AdminSteps steps={[{title:"퀴즈 선택",description:"퀴즈를 고른 뒤 난이도·상태로 기록을 좁힙니다."},{title:"내용 확인",description:"참여자의 답안과 코멘트를 펼쳐 확인합니다."},{title:"기록 관리",description:"공개 상태·개인정보 관리에서 사유와 영향을 확인한 뒤 처리합니다."}]}/>
  </div>;
}
