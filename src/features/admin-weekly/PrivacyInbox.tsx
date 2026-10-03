import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { privacyAdminListSchema, privacyLabels } from "../../../shared/api/privacy";
import { weeklyRequest } from "./client";
import { AdminNavigation } from "./Dashboard";
import styles from "./weekly.module.css";
export function Component(){
  const [items,setItems]=useState<ReturnType<typeof privacyAdminListSchema.parse>['items']|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest('/api/admin/privacy-requests',privacyAdminListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setItems(data.items);}).catch(()=>{if(!controller.signal.aborted)setMessage('문의 목록을 불러오지 못했습니다.');});return()=>controller.abort();},[attempt]);
  async function save(id:string,body:unknown){if(busy)return;setBusy(true);setMessage('');try{setItems((await weeklyRequest(`/api/admin/privacy-requests/${id}`,privacyAdminListSchema,'PATCH',body)).items);setMessage('상태와 관리자 답변을 저장했습니다.');}catch(error){setMessage(error instanceof Error?error.message:'저장을 확인하지 못했습니다.');}finally{setBusy(false);}}
  return <div className={styles.page}><AdminNavigation/><header className={styles.hero}><h2>문의·삭제 요청 처리</h2><p>삭제 요청은 제출 기록에서 해당 자료를 확인하고 조치한 뒤 답변합니다. 상태 변경만으로 제출을 삭제하지 않습니다.</p><Link to="/admin/submissions">제출 기록 관리 열기</Link></header>
    {message&&<p role="status">{message}</p>}<button disabled={busy} onClick={()=>setAttempt(a=>a+1)}>문의 목록 새로고침</button>{items===null?<p role="status">문의 목록을 불러오고 있습니다.</p>:items.length===0?<p>접수된 문의가 없습니다.</p>:<ul className={styles.list}>{items.map(item=><li key={`${item.id}/${item.updatedAt}`} className={styles.panel}><h3>{item.requestType==='delete_submission'?'제출 삭제 요청':'개인정보 문의'}</h3><p>{item.quizSlug??'퀴즈 미지정'} · {item.submittedName??'이름 미기재'} · {privacyLabels[item.status]}</p><p>{item.message}</p>
      <form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void save(item.id,{status:String(fields.get('status')),adminResponse:String(fields.get('response')),expectedUpdatedAt:item.updatedAt});}}><fieldset disabled={busy} className={styles.fields}><legend>처리 상태·답변</legend><label>처리 상태<select name="status" defaultValue={item.status}>{Object.entries(privacyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>관리자 답변<textarea name="response" maxLength={1000} defaultValue={item.adminResponse??''}/></label><button>상태·답변 저장</button></fieldset></form></li>)}</ul>}
  </div>;
}
