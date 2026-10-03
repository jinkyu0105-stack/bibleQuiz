import { useEffect,useRef,useState } from "react";
import { z } from "zod";
import { problemHistorySchema } from "../../../shared/api/problem-history";
import { ResultComparisonGrids } from "./ResultComparisonGrids";
export function ProblemHistory({slug,difficulty}:{slug:string;difficulty:"child"|"adult"}) {
 const [data,setData]=useState<z.infer<typeof problemHistorySchema>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string|null>(null);
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function load(remove?:string) {
  abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError("");
  const url=`/api/quizzes/${slug}/${difficulty}/problem-history`;
  try {
   if(remove) {const deleted=await fetch(`${url}/${encodeURIComponent(remove)}`,{method:"DELETE",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:"{}",signal:controller.signal});if(!deleted.ok)throw new Error();}
   const r=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!r.ok)throw new Error();
   setData(problemHistorySchema.parse((await r.json() as {data:unknown}).data));setConfirm(null);
  } catch {if(!controller.signal.aborted)setError("당시 본인 기록을 확인하지 못했습니다. 다시 시도해 주세요.");}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <section aria-label="이전 오류본 본인 기록"><button type="button" disabled={busy} onClick={()=>void load()}>{busy?"기록 확인 중":"이전 오류본의 내 제출 기록"}</button>
 {error&&<p role="alert">{error}</p>}{data?.items.length===0&&<p>이 브라우저에서 확인할 이전 제출이 없습니다.</p>}
 {data?.items.map(item=><section key={item.submission.quizVariantId}><h3>문제 오류로 종료된 버전 {item.submission.quizRevision}</h3><p>{item.notice} 결과 무효 처리됨. 당시 기록을 보여드리며 새 정답으로 재채점하지 않습니다.</p>
 {item.submission.status==="deleted" ? <p>삭제한 제출입니다. 답안은 보관하지 않습니다.</p>:<><p>당시 맞은 칸 {item.submission.result.correctCells} / {item.submission.result.totalCells} · 점수 {item.submission.result.scoreBasisPoints/100}%</p>
 {item.grid&&<ResultComparisonGrids answers={item.submission.answers} grid={item.grid} solution={item.submission.result.solution}/>}
 <button type="button" disabled={busy} onClick={()=>setConfirm(item.submission.quizVariantId)}>이전 제출 삭제</button>
 {confirm===item.submission.quizVariantId&&<div role="group" aria-label="이전 제출 삭제 확인"><p>이전 제출의 이름·답안·코멘트를 삭제합니다.</p><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>취소</button><button type="button" disabled={busy} onClick={()=>void load(item.submission.quizVariantId)}>이전 제출 삭제 확인</button></div>}</>}
 </section>)}</section>;
}
