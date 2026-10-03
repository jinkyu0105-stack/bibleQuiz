import { problemViewSchema,type ProblemView } from "../../../shared/api/admin-problem-correction";
import { useCallback, useEffect, useRef, useState } from "react";
import { revisionCommandSchema, revisionViewSchema, revisionTrialSchema, type RevisionContent, type RevisionView } from "../../../shared/api/admin-quiz-revision";
import { z } from "zod";
import { ReviewGrid } from "./ContentPlacement";
import styles from "./admin-sermon-input.module.css";
const names = { child: "어린이",adult: "장년" };
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR",{ timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short" }).format(new Date(value));
type Trial = z.infer<typeof revisionTrialSchema>;

export function QuizRevisionEditor({ quizSetId,problem,onProblemView }: { quizSetId: string;problem?: ProblemView;onProblemView?: (view:ProblemView)=>void }) {
  const problemMode=!!problem;
  const endpoint=`/api/admin/quiz-sets/${quizSetId}/${problemMode ? "problem-corrections":"revision"}`;
  const [view,setView] = useState<RevisionView | null>(null), [content,setContent] = useState<RevisionContent | null>(null);
  const [busy,setBusy] = useState(false),[error,setError] = useState(""),[message,setMessage] = useState("");
  const [retryAvailable,setRetryAvailable] = useState(false);
  const [confirmAt,setConfirmAt] = useState(0);
  const [answers,setAnswers] = useState(false),[confirm,setConfirm] = useState(false),[reloadConfirm,setReloadConfirm] = useState(false);
  const [trials,setTrials] = useState<Partial<Record<"child" | "adult",Trial>>>({});
  const [size,setSize] = useState({child:5,adult:5}),[seed,setSeed] = useState({child:"1",adult:"1"});
  const lock = useRef(false),controller = useRef<AbortController | null>(null);
  const pending = useRef<{ signature:string; command:unknown } | null>(null);
  const dirty = !!content && JSON.stringify(content)!==JSON.stringify(view?.body?.content);
  async function request(raw?: unknown) {
    const abort = new AbortController(); controller.current=abort;
    const response=await fetch(endpoint,{ method:raw ? "POST":"GET",credentials:"same-origin",cache:"no-store",
      signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30_000)]),...(raw ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(raw)} : {}) });
    if (!response.ok) throw new Error(response.status===410 ? "편집 보관 기간이 지났습니다. 저장본을 다시 확인해 주세요." : "저장 상태를 확인하지 못했습니다. 입력은 유지됩니다. 같은 요청 재확인 또는 저장본 다시 불러오기를 선택해 주세요.");
    return (await response.json() as {data:unknown}).data;
  }
  const accept=useCallback((raw: unknown) => {
    const saved=revisionViewSchema.parse(problemMode ? problemViewSchema.parse(raw).editor:raw);setView(saved);setContent(saved.body?.content ?? null);setTrials({});setConfirm(false);setReloadConfirm(false);
  },[problemMode]);
  useEffect(()=>{
    const abort=new AbortController();
    void fetch(endpoint,{ credentials:"same-origin",cache:"no-store",signal:abort.signal })
      .then(async r=>{if(!r.ok) throw new Error();return r.json() as Promise<{data:unknown}>;})
      .then(r=>{if(!abort.signal.aborted) accept(r.data);})
      .catch(()=>{if(!abort.signal.aborted) setError("편집본을 불러오지 못했습니다. 저장본 다시 불러오기를 눌러 주세요.");});
    return ()=>{abort.abort();controller.current?.abort();};
  },[endpoint,accept]);
  async function run(fields?: Record<string,unknown>, retry=false) {
    if(lock.current) return;lock.current=true;setBusy(true);setError("");setMessage("");
    try {
      let command: unknown;
      if(retry) command=pending.current?.command;
      else if(fields) {
        const base=fields.action==="start" ? fields : {sessionId:view?.sessionId,expectedRevision:view?.revision,...fields};
        const signature=JSON.stringify(base);
        if(pending.current?.signature===signature) command=pending.current.command;
        else {command=revisionCommandSchema.parse({...base,...(fields.action==="trial" ? {}:{requestKey:crypto.randomUUID()})});pending.current={signature,command};}
      }
      const result=await request(command);
      if(problemMode && !(command && typeof command==="object" && "action" in command && command.action==="trial")) onProblemView?.(problemViewSchema.parse(result));
      if(command && typeof command==="object" && "action" in command && command.action==="trial") {
        const trial=revisionTrialSchema.parse(result);setTrials(old=>({...old,[trial.difficulty]:trial}));setMessage(trial.layout ? "배치 시험을 마쳤습니다. 확인 후 이 배치 사용을 눌러 주세요.":"가능한 배치를 찾지 못했습니다. 답 또는 격자 크기를 확인해 주세요.");
      } else {accept(result);setMessage(fields?.action==="publish" ? "새 검수본을 발행했습니다. 기존 주소에서 확인할 수 있습니다.":"현재 저장 상태를 확인했습니다.");}
      pending.current=null;setRetryAvailable(false);
    } catch(e) {setRetryAvailable(!!pending.current);setError(e instanceof Error && !e.message.includes("[") ? e.message:"입력 내용을 확인해 주세요.");}
    finally {lock.current=false;setBusy(false);}
  }
  function edit(next: RevisionContent) {setContent(next);setConfirm(false);setTrials({});}
  const ready=view?.state==="editing" && !!content;
  return <section aria-label={problemMode ? "문제 오류 수정본 편집":"철회본 편집과 재발행"} className={styles.revisionEditor}>
    <h3>{problemMode ? "문제 오류 수정본 편집":"철회본 편집과 재발행"}</h3>
    <p>내용 저장 → 두 격자 확인 → 요약·문제 검토 → 재발행 순서로 진행합니다.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={()=>dirty ? setReloadConfirm(true):void run()}>저장본 다시 불러오기</button>
      {error && retryAvailable && <button type="button" disabled={busy} onClick={()=>void run(undefined,true)}>같은 요청 재확인</button>}
    </div>
    {reloadConfirm && <div role="group" aria-label="저장본 불러오기 확인"><p>저장하지 않은 입력을 버리고 마지막 저장본을 불러옵니다.</p><button type="button" onClick={()=>setReloadConfirm(false)}>입력 유지</button><button type="button" onClick={()=>void run()}>입력 버리고 불러오기</button></div>}
    {!view && !error && <p role="status">편집 상태를 불러오고 있습니다.</p>}
    {view && ["not_started","expired"].includes(view.state) && <>
      <p>{view.state==="expired" ? "7일 동안 활동이 없던 편집본은 정리되었습니다. 보존된 철회 자료에서 새 편집을 시작할 수 있습니다.":"보존된 철회 자료에서 새 편집본을 엽니다. 보관 중인 수정 내용이 있으면 함께 가져옵니다."}</p>
      <button type="button" disabled={busy} onClick={()=>void run({action:"start",expectedCycle:view.cycle})}>새 편집 시작</button>
    </>}
    {view?.state==="published" && view.publication && <p>발행 {dateTime(view.publication.publishedAt)} · 마감 {dateTime(view.publication.closesAt)} (한국 시간) · <a href={`/quiz/${view.slug}`}>발행한 퀴즈 열기</a></p>}
    {ready && <>
      <p>저장본 {view.revision} · {view.savedAt && dateTime(view.savedAt)} (한국 시간){dirty ? " · 저장하지 않은 변경이 있습니다.":" · 저장됨"}</p>
      <fieldset disabled={busy || !!problem && problem.levels.length===1} className={styles.displayFields}><legend>설교 정보와 요약</legend>
        <label>편집 제목<input value={content.metadata.title} maxLength={300} onChange={e=>edit({...content,metadata:{...content.metadata,title:e.target.value}})} /></label>
        <label>편집 설교일<input type="date" value={content.metadata.sermonDate} onChange={e=>edit({...content,metadata:{...content.metadata,sermonDate:e.target.value}})} /></label>
        <label>편집 교회명<input value={content.churchName} maxLength={100} onChange={e=>edit({...content,churchName:e.target.value})} /></label>
        <label>편집 성경 장절<input value={content.bibleReferenceLabel} maxLength={300} onChange={e=>edit({...content,bibleReferenceLabel:e.target.value})} /></label>
        <label>편집 요약<textarea rows={6} maxLength={20000} value={content.summary} onChange={e=>edit({...content,summary:e.target.value})} /></label>
        <p>{view.disclosure}</p><a href={view.bibleReadingUrl} target="_blank" rel="noreferrer">대한성서공회에서 본문 읽기 ({view.translation})</a>
      </fieldset>
      {(["child","adult"] as const).map(level=><fieldset key={level} disabled={busy || !!problem && !problem.levels.includes(level)} className={styles.revisionLevel}><legend>{names[level]} 문제 편집</legend>
        {content[level].map((entry,index)=><details key={entry.id}><summary>{index+1}. {entry.clue || "단서를 입력해 주세요"}</summary>
          <div className={styles.displayFields}>{(["answer","clue","evidence"] as const).map(field=><label key={field}>{names[level]} {index+1} {field==="answer" ? "정답":field==="clue" ? "단서":"수정 근거"}
            <textarea rows={field==="answer" ? 1:3} value={entry[field]} onChange={e=>edit({...content,[level]:content[level].map((item,i)=>i===index ? {...item,[field]:e.target.value}:item)})} /></label>)}</div>
          <details><summary>보존된 기존 근거</summary><pre className={styles.revisionEvidence}>{JSON.stringify(view.sourceEvidence[entry.id],null,2)}</pre></details>
        </details>)}
      </fieldset>)}
      <button type="button" disabled={busy || !dirty} onClick={()=>void run({action:"save",content})}>편집본 저장</button>
      <p>저장·배치 변경 뒤에는 요약과 두 난이도를 다시 검토합니다. 수정한 답·단서에는 관리자 근거를 적어 주세요.</p>
      <label><input type="checkbox" checked={answers} onChange={e=>setAnswers(e.target.checked)} />관리자 정답 보기</label>
      {(["child","adult"] as const).map(level=><fieldset key={level} disabled={busy || dirty} className={styles.revisionLevel}><legend>{names[level]} 배치와 검토</legend>
        {view.body!.layouts[level] ? <ReviewGrid grid={view.body!.layouts[level]!.grid} {...(answers ? {solution:view.body!.layouts[level]!.solution}:{})} title={`${names[level]} 현재 격자`} />:<p>현재 답으로 배치를 다시 선택해 주세요.</p>}
        <fieldset disabled={!!problem && !problem.levels.includes(level)} className={styles.actions}><label>{names[level]} 격자 크기<select value={size[level]} onChange={e=>{setSize({...size,[level]:Number(e.target.value)});setTrials({...trials,[level]:undefined});}}>{[5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} × {n}</option>)}</select></label>
          <label>{names[level]} 배치 번호<input value={seed[level]} maxLength={128} onChange={e=>{setSeed({...seed,[level]:e.target.value});setTrials({...trials,[level]:undefined});}} /></label>
          <button type="button" onClick={()=>void run({action:"trial",difficulty:level,gridSize:size[level],seed:seed[level]})}>{names[level]} 무료 배치 시험</button></fieldset>
        {trials[level] && <>{trials[level]!.layout ? <><ReviewGrid grid={trials[level]!.layout!.grid} {...(answers ? {solution:trials[level]!.layout!.solution}:{})} title={`${names[level]} 시험 격자`} />
          <button type="button" onClick={()=>void run({action:"layout",difficulty:level,gridSize:trials[level]!.gridSize,seed:trials[level]!.seed})}>{names[level]} 이 배치 사용</button></>:<p>{trials[level]!.issues.join(" ")}</p>}</>}
        <button type="button" disabled={busy || dirty || view.issues.length>0 || view.body!.reviewed[level]} onClick={()=>void run({action:"review",area:level,confirmed:true})}>{names[level]} 문제·정답·근거 검토 완료</button>
        <p>{view.body!.reviewed[level] ? "현재 저장본 검토 완료":"현재 저장본 검토 필요"}</p>
      </fieldset>)}
      {view.issues.length>0 && <ul>{view.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
      <button type="button" disabled={busy || dirty || view.issues.length>0 || view.body!.reviewed.summary} onClick={()=>void run({action:"review",area:"summary",confirmed:true})}>설교 정보·요약 검토 완료</button>
      <p>{view.body!.reviewed.summary ? "현재 요약 검토 완료":"현재 요약 검토 필요"}</p>
      <button type="button" disabled={busy || dirty || !view.canPublish} onClick={()=>{setConfirmAt(Date.now());setConfirm(true);}}>재발행 확인</button>
      {confirm && <div role="group" aria-label="재발행 최종 확인"><p>{problem ? (problem.nonRanked ? "마감된 수정본은 순위와 참여 기록 없이 공개합니다.":"수정본 접수를 재개하며 기존 마감 시각을 유지합니다."):"같은 공유 주소에서 즉시 참여를 시작하고 7일 뒤 마감합니다."} 이전 문제·정답·발행 기록을 보존합니다.</p>
        <p>예상 시작 {dateTime(new Date(confirmAt).toISOString())} · 예상 마감 {dateTime(problem?.closesAt ?? new Date(confirmAt+7*86_400_000).toISOString())} (한국 시간)</p>
        <p>현재 발행 주소: /quiz/{view.slug}</p><p>재발행과 배치 시험에는 AI 호출 비용이 들지 않습니다.</p>
        <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>재발행 취소</button><button type="button" disabled={busy} onClick={()=>void run({action:"publish",confirmation:"publish"})}>지금 재발행</button></div>}
    </>}
  </section>;
}
