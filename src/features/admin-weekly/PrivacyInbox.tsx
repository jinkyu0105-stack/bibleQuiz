import { AdminIntro, AdminSteps } from "../../components/AdminGuide";
import { Button } from "../../components/Button";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { privacyAdminListSchema, privacyLabels } from "../../../shared/api/privacy";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function Component(){
  const [items,setItems]=useState<ReturnType<typeof privacyAdminListSchema.parse>['items']|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest('/api/admin/privacy-requests',privacyAdminListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setItems(data.items);}).catch(()=>{if(!controller.signal.aborted)setMessage('문의 목록을 불러오지 못했습니다.');});return()=>controller.abort();},[attempt]);
  async function save(id:string,body:unknown){if(busy)return;setBusy(true);setMessage('');try{setItems((await weeklyRequest(`/api/admin/privacy-requests/${id}`,privacyAdminListSchema,'PATCH',body)).items);setMessage('상태와 관리자 답변을 저장했습니다.');}catch(error){setMessage(error instanceof Error?error.message:'저장을 확인하지 못했습니다.');}finally{setBusy(false);}}
  return <div className={styles.page}><AdminIntro title="문의·삭제 요청 처리" description="참여자가 보낸 문의를 읽고, 필요한 조치를 한 뒤 처리 상태와 답변을 남깁니다."/>
    <AdminSteps steps={[
      {title:"요청 내용 확인",description:"어느 퀴즈의 누구에 대한 요청인지 확인합니다."},
      {title:"필요한 조치",description:"삭제 요청은 제출 기록 관리에서 해당 자료를 확인하고 처리합니다."},
      {title:"답변 저장",description:"실제 처리 결과에 맞게 상태를 선택하고 답변을 남깁니다."},
    ]}/>
    <div className={styles.note}><p>상태를 ‘처리 완료’로 바꾸는 것만으로 제출 기록이 삭제되지는 않습니다.</p><Link to="/admin/submissions">제출 기록 관리 열기</Link></div>
    {message&&<p role="status">{message}</p>}<Button disabled={busy} onClick={()=>setAttempt(a=>a+1)}>문의 목록 새로고침</Button>{items===null?<p role="status">문의 목록을 불러오고 있습니다.</p>:items.length===0?<p>접수된 문의가 없습니다. 새 문의가 들어오면 이곳에서 내용과 처리 상태를 확인할 수 있습니다.</p>:<ul className={styles.list}>{items.map(item=><li key={`${item.id}/${item.updatedAt}`} className={styles.panel}><h3>{item.requestType==='delete_submission'?'제출 삭제 요청':'개인정보 문의'}</h3><p>{item.quizSlug??'퀴즈 미지정'} · {item.submittedName??'이름 미기재'} · {privacyLabels[item.status]}</p><p>{item.message}</p>
      <form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void save(item.id,{status:String(fields.get('status')),adminResponse:String(fields.get('response')),expectedUpdatedAt:item.updatedAt});}}><fieldset disabled={busy} className={styles.fields}><legend>처리 상태·답변</legend><label>처리 상태<select name="status" defaultValue={item.status}>{Object.entries(privacyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>관리자 답변<textarea name="response" maxLength={1000} defaultValue={item.adminResponse??''}/></label><Button>상태·답변 저장</Button></fieldset></form></li>)}</ul>}
  </div>;
}
