import { OperationsPanel } from "../admin-operations/OperationsPanel";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { weeklyDashboardSchema } from "../../../shared/api/admin-weekly";
import { draftCleanupListSchema } from "../../../shared/api/admin-draft-cleanup";
import { weeklyRequest } from "./client";
import { AiCostDetails } from "../admin-sermon-input/AiCostDetails";
import styles from "./weekly.module.css";
const remaining=(value:string,now:number)=>{const hours=Math.ceil((Date.parse(value)-now)/3_600_000);return hours<=0?'마감 시각 지남':hours>=24?`약 ${Math.ceil(hours/24)}일 남음`:`약 ${hours}시간 남음`;};
const time=(value:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export function AdminNavigation(){return <nav className={styles.nav} aria-label="관리자 운영 메뉴"><Link to="/admin">주간 운영</Link><Link to="/admin/moderation">이름·문구 필터</Link><Link to="/admin/privacy-requests">문의·삭제 요청</Link><Link to="/admin/tools">발행·수정 도구</Link><Link to="/admin/operations">비용·백업</Link><Link to="/admin/manual">운영 매뉴얼</Link></nav>;}
export function Component(){
  const [checkedAt,setCheckedAt]=useState(()=>Date.now());
  const [data,setData]=useState<ReturnType<typeof weeklyDashboardSchema.parse>|null>(null),[cleanup,setCleanup]=useState<ReturnType<typeof draftCleanupListSchema.parse>|null>(null),[message,setMessage]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest('/api/admin/dashboard',weeklyDashboardSchema,'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted){setData(next);setCheckedAt(Date.now());}}).catch(()=>{if(!controller.signal.aborted)setMessage('관리자 작업 목록을 불러오지 못했습니다. 다시 시도해 주세요.');});
    void weeklyRequest('/api/admin/draft-cleanup',draftCleanupListSchema,'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted)setCleanup(next);}).catch(()=>{if(!controller.signal.aborted)setCleanup(null);});return()=>controller.abort();},[attempt]);
  const draft=data?.items.find(q=>!q.expired&&!['published','archived'].includes(q.status));
  const featured=data?.items.find(q=>q.featured),open=data?.items.filter(q=>q.status==='published')??[];
  return <div className={styles.page}><AdminNavigation/><header className={styles.hero}><p className="eyebrow">이번 주 운영</p><h2>{draft?'이어서 완성할 퀴즈':'이번 주 퀴즈 만들기'}</h2>
    {!data?<p role="status">현재 작업을 확인하고 있습니다.</p>:<>{draft&&<><h3>{draft.title}</h3><p>{draft.sermonDate} · {draft.status==='needs_revision'?'다시 확인 필요':draft.jobStatus==='failed'?'생성 결과 확인 필요':draft.jobStatus==='running'?'생성 진행 중':draft.stage==='content_review'?'요약·문제 검수':draft.stage==='intent_review'?'설교 의도 검수':draft.stage==='finish'?'최종 검사 완료':'미발행 작업'}</p></>}
    <Link className={styles.primaryAction} to={draft?`/admin/quiz/${draft.quizSetId}`:'/admin/new'}>{draft?'계속 작업하기':'이번 주 퀴즈 만들기'}</Link>
    {draft&&<AiCostDetails quizSetId={draft.quizSetId}/>}</>}
    {message&&<p role="alert">{message}</p>}<button type="button" onClick={()=>{setMessage('');setAttempt(a=>a+1);}}>운영 상태 새로고침</button></header>
    <OperationsPanel/>
    {data&&<><section className={styles.panel}><h3>현재 공개 퀴즈</h3>{featured?<><p>{featured.sermonDate} · {featured.title}</p><Link to={`/quiz/${featured.slug}`}>공개 화면 보기</Link></>:<p>현재 대표 퀴즈가 없습니다.</p>}</section>
      <div className={styles.grid}><section className={styles.panel}><h3>확인할 작업</h3><Link to="/admin/privacy-requests">답변할 문의·삭제 요청 {data.unansweredCount}건</Link>
        <h4>하루 이내 초안 정리 예정</h4>{cleanup===null?<p>초안 정리 현황을 확인하지 못했습니다. 발행·수정 도구에서 다시 확인해 주세요.</p>:cleanup.items.filter(i=>i.state==='blocked'||(!!i.dueAt&&Date.parse(i.dueAt)-checkedAt<=86_400_000&&i.state!=='purged')).length===0?<p>현재 확인할 정리 예정 초안이 없습니다.</p>:<ul>{cleanup.items.filter(i=>i.state==='blocked'||(!!i.dueAt&&Date.parse(i.dueAt)-checkedAt<=86_400_000&&i.state!=='purged')).map(i=><li key={i.sermonId}>{i.title} · {i.dueAt?time(i.dueAt):'시각 미확인'} · {i.state==='blocked'?'확인 필요':'본문 정리 예정'}</li>)}</ul>}
      </section><section className={styles.panel}><h3>주간 작업 목록</h3><ul className={styles.list}>{data.items.filter(q=>!['published','archived'].includes(q.status)).map(q=><li key={q.quizSetId}>{q.sermonDate} · {q.title}{q.expired?<p>초안 본문 정리됨</p>:<Link to={`/admin/quiz/${q.quizSetId}`}>작업 열기</Link>}</li>)}</ul></section></div>
      <section><h3>진행 중인 퀴즈</h3>{open.length===0?<p>현재 진행 중인 퀴즈가 없습니다.</p>:<ul className={styles.list}>{open.map(q=><li key={q.quizSetId} className={styles.panel}><h4>{q.title}</h4><p>{q.sermonDate} · 공개 제출 {q.visibleCount}건 · 전체 제출 {q.totalCount}건</p><p>어린이 공개 {q.childVisibleCount}건 · Top {q.childWinnerCount} / 장년 공개 {q.adultVisibleCount}건 · Top {q.adultWinnerCount}</p><p>{q.closesAt?`마감: ${time(q.closesAt)} (한국 시간) · ${remaining(q.closesAt,checkedAt)}`:'마감 시각 확인 필요'} · {q.submissionStatus==='paused'?'접수 중지':q.closesAt&&Date.parse(q.closesAt)<=checkedAt?'마감 정리 대기':'접수 중'}</p>
        <div className={styles.actions}><Link to={`/admin/quiz/${q.quizSetId}`}>퀴즈 운영</Link><Link to={`/admin/submissions?quiz=${q.quizSetId}`}>제출 기록 관리</Link><Link to={`/admin/quiz/${q.quizSetId}?operation=deadline`}>마감 일시 변경·지금 마감</Link><Link to={`/admin/quiz/${q.quizSetId}?operation=winners`}>Top N 설정</Link></div></li>)}</ul>}</section>
      <section className={styles.panel}><h3>최근 발행한 퀴즈</h3><ul>{data.items.filter(q=>['published','archived'].includes(q.status)).slice(0,6).map(q=><li key={q.quizSetId}><Link to={`/admin/quiz/${q.quizSetId}`}>{q.sermonDate} · {q.title}</Link></li>)}</ul></section>
    </>}</div>;
}
