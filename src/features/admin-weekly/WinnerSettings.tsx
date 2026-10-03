import { useEffect, useRef, useState } from "react";
import { winnerSettingsSchema, type WeeklyQuiz } from "../../../shared/api/admin-weekly";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function WinnerSettings({quizSetId}:{quizSetId:string}) {
  const [view,setView]=useState<ReturnType<typeof winnerSettingsSchema.parse>|null>(null);
  const [child,setChild]=useState(3),[adult,setAdult]=useState(3),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  const lock=useRef(false);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest(`/api/admin/quiz-sets/${quizSetId}/winner-settings`,winnerSettingsSchema,'GET',undefined,controller.signal)
    .then(data=>{if(!controller.signal.aborted){setView(data);setChild(data.child);setAdult(data.adult);}}).catch(()=>{if(!controller.signal.aborted)setMessage('Top N 설정을 불러오지 못했습니다.');});return()=>controller.abort();},[quizSetId,attempt]);
  async function save(){if(!view||lock.current)return;lock.current=true;setBusy(true);setMessage('');try{
    const next=await weeklyRequest(`/api/admin/quiz-sets/${quizSetId}/winner-settings`,winnerSettingsSchema,'PATCH',{child,adult,reason,expectedRevision:view.revision});setView(next);setMessage('Top N 인원을 저장했습니다. 화면과 출력에 같은 값을 사용합니다.');
  }catch(error){setMessage(error instanceof Error?error.message:'저장을 확인하지 못했습니다.');}finally{lock.current=false;setBusy(false);}}
  return <section className={styles.panel} aria-label="Top N 인원 설정"><h3>Top N 인원 설정</h3>
    {message&&<p role="status">{message}</p>}{!view?<button type="button" onClick={()=>setAttempt(a=>a+1)}>설정 다시 불러오기</button>:<form onSubmit={e=>{e.preventDefault();void save();}}>
      {!view.editable&&<p>마감된 퀴즈의 순위는 고정되어 인원을 변경할 수 없습니다.</p>}
      <fieldset disabled={busy||!view.editable} className={styles.fields}><legend>완전 정답자 중 제출 순서로 선정합니다.</legend>
        <label>어린이 Top N<input type="number" min={1} max={10} required value={child} onChange={e=>setChild(Number(e.target.value))}/></label>
        <label>장년 Top N<input type="number" min={1} max={10} required value={adult} onChange={e=>setAdult(Number(e.target.value))}/></label>
        <label>설정 변경 사유<input minLength={2} maxLength={500} required value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <button type="submit">Top N 설정 저장</button>
      </fieldset>
    </form>}</section>;
}
export function QuizIdentity({quiz}:{quiz:WeeklyQuiz}) {return <p>{quiz.sermonDate} · {quiz.title}</p>;}
