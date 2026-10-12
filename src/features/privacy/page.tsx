import { Button } from "../../components/Button";
import local from "./privacy.module.css";
import { useCallback, useState } from "react";
import { privacyLabels, privacyReceiptSchema, privacyTokenSchema, privacyViewSchema } from "../../../shared/api/privacy";
import { browserStorage } from "../../lib/browser-storage";
import { TurnstileChallenge } from "../quiz/TurnstileChallenge";
import { weeklyRequest } from "../admin-weekly/client";
import styles from "../admin-weekly/weekly.module.css";
const storageKey='bq:privacy-receipts:v1';
function savedReceipts():string[]{try{const raw=JSON.parse(browserStorage()?.getItem(storageKey)??'[]') as unknown;return Array.isArray(raw)?raw.filter((v):v is string=>privacyTokenSchema.safeParse(v).success):[];}catch{return [];}}
export function Component(){
  const [type,setType]=useState('delete_submission'),[quiz,setQuiz]=useState(''),[name,setName]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [key,setKey]=useState(()=>crypto.randomUUID()),[token,setToken]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const [receipts,setReceipts]=useState(savedReceipts),[receipt,setReceipt]=useState(''),[lookup,setLookup]=useState(''),[view,setView]=useState<ReturnType<typeof privacyViewSchema.parse>|null>(null);
  const onState=useCallback(()=>{},[]),onToken=useCallback((next:string|null)=>setToken(next),[]);
  async function submit(){if(busy||!token)return;setBusy(true);setError('');try{
    const result=await weeklyRequest('/api/privacy-requests',privacyReceiptSchema,'POST',{requestKey:key,requestType:type,quizSlug:quiz||null,submittedName:name||null,message,turnstileToken:token});
    setReceipt(result.lookupToken);setLookup(result.lookupToken);const next=[...new Set([...receipts,result.lookupToken])];setReceipts(next);
    try{const storage=browserStorage();if(!storage)throw new Error();storage.setItem(storageKey,JSON.stringify(next));}catch{setError('이 브라우저에 접수번호를 저장하지 못했습니다. 접수번호를 복사해 보관해 주세요.');}
  }catch(failure){setError(failure instanceof Error?failure.message:'접수 결과를 확인하지 못했습니다.');setRefresh(v=>v+1);}finally{setBusy(false);}}
  async function read(value=lookup){setBusy(true);setError('');setView(null);try{setView(await weeklyRequest(`/api/privacy-requests/${encodeURIComponent(value)}`,privacyViewSchema));setLookup(value);}catch{setError('접수번호를 확인해 주세요. 처리 상태를 불러오지 못했습니다.');}finally{setBusy(false);}}
  function changed(){setKey(crypto.randomUUID());}
  return <div className={`${styles.page} ${local.page}`}><header className={styles.hero}><h2>문의·삭제 요청</h2><p>이메일·전화번호·첨부파일 없이 접수합니다. 접수번호로 처리 상태와 관리자 답변을 확인할 수 있습니다.</p></header>{error&&<p role="alert">{error}</p>}
    {!receipt?<form className={styles.panel} onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy} className={local.fields}><legend>문의 접수</legend>
      <label>문의 종류<select value={type} onChange={e=>{setType(e.target.value);changed();}}><option value="delete_submission">제출 삭제 요청</option><option value="privacy_question">개인정보 문의</option></select></label>
      <label>퀴즈 주차·공개 주소<input maxLength={128} value={quiz} onChange={e=>{setQuiz(e.target.value);changed();}}/></label><label>제출한 이름<input maxLength={100} value={name} onChange={e=>{setName(e.target.value);changed();}}/></label><label className={local.message}>짧은 설명<textarea required minLength={2} maxLength={1000} value={message} onChange={e=>{setMessage(e.target.value);changed();}}/></label>
      <div className={local.message}><TurnstileChallenge action="privacy_request" onState={onState} onToken={onToken} refreshKey={refresh}/></div><Button disabled={!token||busy}>문의 접수</Button></fieldset></form>:<section className={styles.panel}><h3>문의가 접수되었습니다.</h3><p>접수번호는 답변을 볼 수 있는 비밀 조회키입니다. 공개 게시판에 올리지 마세요.</p><output>{receipt}</output><div className={styles.actions}><Button onClick={()=>void navigator.clipboard.writeText(receipt).catch(()=>setError('접수번호를 직접 선택해 복사해 주세요.'))}>접수번호 복사</Button><Button disabled={busy} onClick={()=>void read(receipt)}>처리 상태 보기</Button></div></section>}
    <section className={styles.panel}><h3>내 문의</h3>{receipts.length===0?<p>이 브라우저에 저장된 접수번호가 없습니다.</p>:<ul>{receipts.map((value,index)=><li key={value}><Button disabled={busy} onClick={()=>void read(value)}>내 문의 {index+1} 처리 상태 보기</Button></li>)}</ul>}
      <form onSubmit={e=>{e.preventDefault();void read();}}><label>다른 기기의 접수번호<input value={lookup} onChange={e=>setLookup(e.target.value)} autoComplete="off" spellCheck={false}/></label><Button disabled={busy}>접수번호로 조회</Button></form>
      {view&&<div role="status"><p>{view.requestType==='delete_submission'?'제출 삭제 요청':'개인정보 문의'} · {new Date(view.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국 시간) · {privacyLabels[view.status]}</p><p>{view.adminResponse??'아직 관리자 답변이 없습니다.'}</p></div>}
    </section></div>;
}
