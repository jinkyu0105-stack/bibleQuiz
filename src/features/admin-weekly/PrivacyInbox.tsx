import { AdminIntro, AdminSteps } from "../../components/AdminGuide";
import { AdminRecord } from "../../components/AdminRecord";
import record from "./records.module.css";
import { Button } from "../../components/Button";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { quizSlugSchema } from "../../../shared/api/public-quiz";
import { privacyAdminListSchema, privacyLabels } from "../../../shared/api/privacy";
import { weeklyRequest } from "./client";
import styles from "./weekly.module.css";
export function Component(){
  const [items,setItems]=useState<ReturnType<typeof privacyAdminListSchema.parse>['items']|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest('/api/admin/privacy-requests',privacyAdminListSchema,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setItems(data.items);}).catch(()=>{if(!controller.signal.aborted)setMessage('문의 목록을 불러오지 못했습니다.');});return()=>controller.abort();},[attempt]);
  async function save(id:string,body:unknown){if(busy)return;setBusy(true);setMessage('');try{setItems((await weeklyRequest(`/api/admin/privacy-requests/${id}`,privacyAdminListSchema,'PATCH',body)).items);setMessage('상태와 관리자 답변을 저장했습니다.');}catch(error){setMessage(error instanceof Error?error.message:'저장을 확인하지 못했습니다.');}finally{setBusy(false);}}
  const [filter,setFilter]=useState('pending');
  const pending=(status:string)=>status==='received'||status==='reviewing';
  const visible=items?.filter(item=>filter==='all'||(filter==='pending'?pending(item.status):!pending(item.status)));
  return <div className={styles.page}>
    <AdminIntro terms={["처리 완료", "개인정보 삭제"]} screenshots={["privacy"]} title="문의·삭제 요청" description="문의 내용을 확인하고 답변을 남기세요."/>
    <div className={record.toolbar}>
      <div className={record.filters} role="group" aria-label="문의 상태 필터">{([['pending','답변 대기'],['done','처리한 문의'],['all','전체']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}<small>{items?.filter(item=>value==='all'||(value==='pending'?pending(item.status):!pending(item.status))).length??'—'}</small></button>)}</div>
      <Button disabled={busy} onClick={()=>{setMessage('');setAttempt(a=>a+1);}}>문의 목록 새로고침</Button>
    </div>
    {message&&<p role="status">{message}</p>}
    {items===null?(!message&&<p role="status">문의 목록을 불러오고 있습니다.</p>):visible?.length===0?<div className={record.empty}><h3>{filter==='pending'?'답변을 기다리는 문의가 없습니다':'이곳에 문의가 표시됩니다'}</h3><p>새 문의가 들어오면 내용과 처리 상태를 확인할 수 있습니다.</p></div>:<ul className={record.list}>{visible?.map(item=><AdminRecord key={`${item.id}/${item.updatedAt}`} title={item.submittedName??'이름 미기재'} label={item.requestType==='delete_submission'?'제출 삭제 요청':'개인정보 문의'} status={privacyLabels[item.status]} attention={pending(item.status)} meta={<><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time>{item.quizSlug&&(quizSlugSchema.safeParse(item.quizSlug).success?<Link to={`/quiz/${item.quizSlug}`}>관련 퀴즈 보기 ↗</Link>:<span>대상: {item.quizSlug}</span>)}</>}>
      <blockquote>{item.message}</blockquote>
      {item.adminResponse&&<p><strong>내 답변</strong> · {item.adminResponse}</p>}
      <details><summary>{item.adminResponse?'답변·상태 수정':'답변 작성'}</summary>
        {item.requestType==='delete_submission'&&<div className={record.note}><p>상태를 ‘처리 완료’로 바꾸는 것만으로 제출 기록이 삭제되지는 않습니다.</p><Link to="/admin/submissions">제출 기록 관리 열기 ↗</Link></div>}
        <form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void save(item.id,{status:String(fields.get('status')),adminResponse:String(fields.get('response')),expectedUpdatedAt:item.updatedAt});}}><fieldset disabled={busy} className={record.reply}><legend>처리 상태·답변</legend><label>처리 상태<select name="status" defaultValue={item.status}>{Object.entries(privacyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>관리자 답변<textarea name="response" maxLength={1000} defaultValue={item.adminResponse??''}/></label><Button>상태·답변 저장</Button></fieldset></form>
      </details>
    </AdminRecord>)}</ul>}
    <AdminSteps steps={[
      {title:"내용 확인",description:"이름과 관련 퀴즈를 보고 누구의 어떤 요청인지 확인합니다."},
      {title:"삭제 요청 처리",description:"제출 기록에서 실제 삭제한 뒤 처리 상태를 바꿉니다. 상태 변경만으로 기록은 삭제되지 않습니다."},
      {title:"답변 저장",description:"참여자가 내 문의에서 확인할 수 있도록 처리 결과를 남깁니다."},
    ]}/>
  </div>;
}
