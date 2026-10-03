import { ReviewGrid } from "./ContentPlacement";
import { z } from "zod";
import { useEffect,useRef,useState } from "react";
import { problemCommandSchema,problemViewSchema,problemRecordsSchema,type ProblemView } from "../../../shared/api/admin-problem-correction";
import { publishedMetadataListSchema,type PublishedMetadata } from "../../../shared/api/admin-display-text";
import { QuizRevisionEditor } from "./QuizRevisionEditor";
import styles from "./admin-sermon-input.module.css";
export function ProblemCorrection({ initialQuizSetId = "" }: { initialQuizSetId?: string } = {}) {
 const [records,setRecords]=useState<z.infer<typeof problemRecordsSchema>|null>(null);
 const [items,setItems]=useState<PublishedMetadata[]>([]),[id,setId]=useState(initialQuizSetId),[view,setView]=useState<ProblemView|null>(null);
 const [levels,setLevels]=useState<("child"|"adult")[]>(["child"]),[reason,setReason]=useState(""),[notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false),[cancel,setCancel]=useState(false);
 const [attempt,setAttempt]=useState(0),pending=useRef<{signature:string;body:unknown}|null>(null),lock=useRef(false);
 useEffect(()=>{const abort=new AbortController();void fetch("/api/admin/published-quizzes",{credentials:"same-origin",cache:"no-store",signal:abort.signal})
 .then(async r=>{if(!r.ok) throw new Error();return r.json() as Promise<{data:unknown}>;}).then(r=>setItems(publishedMetadataListSchema.parse(r.data).items))
 .catch(()=>{if(!abort.signal.aborted) setError("발행 목록을 불러오지 못했습니다.");});return ()=>abort.abort();},[attempt]);
 useEffect(()=>{if(!id)return;const abort=new AbortController();void fetch(`/api/admin/quiz-sets/${id}/problem-corrections`,{credentials:"same-origin",cache:"no-store",signal:abort.signal})
 .then(async r=>{if(!r.ok)throw new Error();return r.json() as Promise<{data:unknown}>;}).then(r=>{setView(problemViewSchema.parse(r.data));setError("");})
 .catch(()=>{if(!abort.signal.aborted)setError("오류 처리 상태를 불러오지 못했습니다.");});return ()=>abort.abort();},[id,attempt]);
 async function history() {
  setError("");try {const r=await fetch(`/api/admin/quiz-sets/${id}/problem-records`,{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error();setRecords(problemRecordsSchema.parse((await r.json() as {data:unknown}).data));}
  catch {setError("오류 처리 원본을 불러오지 못했습니다.");}
 }
 async function run(action:"start"|"cancel") {
  if(!view || lock.current)return;lock.current=true;setBusy(true);setError("");
  try {
   const fields=action==="start" ? {action,expectedCycle:view.cycle,expectedVariants:view.variants,levels,reason,notice}:{action,sessionId:view.editor!.sessionId,expectedRevision:view.editor!.revision,reason,confirmation:"not_an_error_resume"};
   const signature=JSON.stringify(fields);
   if(pending.current?.signature!==signature) pending.current={signature,body:problemCommandSchema.parse({...fields,requestKey:crypto.randomUUID()})};
   const r=await fetch(`/api/admin/quiz-sets/${id}/problem-corrections`,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(pending.current.body),signal:AbortSignal.timeout(30_000)});
   if(!r.ok)throw new Error();setView(problemViewSchema.parse((await r.json() as {data:unknown}).data));pending.current=null;setConfirm(false);setCancel(false);
  }catch{setError("처리 상태를 확인하지 못했습니다. 입력을 확인하고 같은 버튼으로 재확인하거나 최신 상태를 불러와 주세요.");}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className={styles.panel} aria-label="첫 제출 후 문제 오류 처리"><h2 id="problem-correction-title">첫 제출 후 문제 오류 처리</h2>
 <p>기존 답안과 당시 정답을 보존합니다. 수정 중에는 세트 전체 접수를 중지하며, 선택한 난이도의 오류본만 교체합니다. 공통 설교 정보·요약을 수정하려면 두 난이도를 선택해 주세요.</p>
 {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>setAttempt(v=>v+1)}>오류 처리 상태 다시 확인</button>
 <label>오류를 처리할 퀴즈<select aria-label="오류를 처리할 퀴즈" disabled={busy} value={id} onChange={e=>{setId(e.target.value);setView(null);setRecords(null);setConfirm(false);setCancel(false);pending.current=null;}}><option value="">퀴즈 선택</option>{items.map(q=><option key={q.quizSetId} value={q.quizSetId}>{q.metadata.title}</option>)}</select></label>
 {id&&!view&&!error&&<p role="status">영향 범위를 확인하고 있습니다.</p>}
 {view&&<>
 <button type="button" disabled={busy} onClick={()=>void history()}>보존된 오류 처리 원본 확인</button>
 {records?.items.map(record=><details key={record.caseId}><summary>{record.createdAt.slice(0,10)} · {record.source.content.metadata.title} · {record.outcome==="publish"?"수정본 발행":record.outcome==="cancel"?"오류 아님 취소":"확인 중"}</summary><p>{record.reason}</p><p>{record.source.content.summary}</p>{(["child","adult"] as const).map(level=><div key={level}>{record.source.layouts[level]&&<ReviewGrid grid={record.source.layouts[level]!.grid} solution={record.source.layouts[level]!.solution} title={`${level==="child"?"어린이":"장년"} 당시 원본 격자`}/>}<ul>{record.source.content[level].map(e=><li key={e.id}>{e.clue} · 당시 정답: {e.answer}</li>)}</ul></div>)}</details>)}<p>기존 마감: {new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"}).format(new Date(view.closesAt))} (한국 시간)</p>
 <p>{view.nonRanked ? "마감된 퀴즈입니다. 수정본을 발행해도 순위 접수를 다시 열지 않습니다.":"수정본은 기존 마감까지 참여할 수 있습니다. 수정 중 마감되면 기록 없는 지난 퀴즈로 전환합니다."}</p>
 <ul>{view.impact.map(v=><li key={v.variantId}>{v.difficulty==="child"?"어린이":"장년"} 버전 {v.revision}: 공개 {v.visible}건 · 숨김 {v.hidden}건 · 삭제 {v.deleted}건 · 확정 순위 {v.winners}건</li>)}</ul>
 {["ready","published","cancelled","expired"].includes(view.status)&&<fieldset disabled={busy}><legend>새 오류 확인</legend>
 {view.status==="expired"&&<p>7일 보관 기간이 지난 편집본은 정리되었습니다. 접수 중지는 유지됩니다. 보존된 문제에서 다시 시작할 수 있습니다.</p>}
 {(["child","adult"] as const).map(level=><label key={level}><input type="checkbox" checked={levels.includes(level)} onChange={e=>setLevels(old=>e.target.checked?[...old,level]:old.filter(v=>v!==level))}/>{level==="child"?"어린이":"장년"} 오류</label>)}
 <label>관리자 오류 확인 사유<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
 <label>공개 중지 안내<textarea value={notice} maxLength={500} onChange={e=>setNotice(e.target.value)}/></label>
 <button type="button" disabled={!levels.length||reason.trim().length<2||notice.trim().length<2} onClick={()=>setConfirm(true)}>접수 중지와 영향 확인</button>
 {confirm&&<div role="group" aria-label="문제 오류 처리 확인"><p>두 난이도 신규 제출을 중지합니다. 선택한 오류본의 기존 기록을 재채점하거나 수정본 순위로 옮기지 않습니다.</p><button type="button" onClick={()=>setConfirm(false)}>돌아가기</button><button type="button" onClick={()=>void run("start")}>접수 중지하고 수정 시작</button></div>}
 </fieldset>}
 {view.status==="editing"&&<QuizRevisionEditor key={view.editor!.sessionId} quizSetId={id} problem={view} onProblemView={setView}/>}
 {["editing","expired"].includes(view.status)&&<><button type="button" disabled={busy} onClick={()=>setCancel(true)}>오류가 아님을 확인하고 취소</button>
 {cancel&&<div role="group" aria-label="오류 처리 취소 확인"><p>실제 오류가 아닌 경우에만 취소합니다. 마감 전이면 기존본 접수를 명시적으로 재개하고, 마감 뒤에는 열지 않습니다.</p><label>취소 사유<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={busy} onClick={()=>setCancel(false)}>계속 수정</button><button type="button" disabled={busy||reason.trim().length<2} onClick={()=>void run("cancel")}>오류 아님 확인·취소</button></div>}</>}
 {view.status==="published"&&<p role="status">수정본 발행을 완료했습니다. 기존 오류본은 결과 무효로 보존됩니다.</p>}
 {view.status==="cancelled"&&<p role="status">오류 아님 확인을 저장했습니다. 기존 문제와 기록은 그대로 유지됩니다.</p>}
 </>}
 </section>;
}
