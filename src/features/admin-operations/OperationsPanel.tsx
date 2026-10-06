import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { operationsUsageSchema,backupListSchema,backupAcceptedSchema } from "../../../shared/api/admin-operations";
import { serviceRegistry,serviceIds,noSeparateCharge } from "../../config/service-registry";
import { weeklyRequest } from "../admin-weekly/client";
import styles from "../admin-weekly/weekly.module.css";
import local from "./operations.module.css";
const statusLabel={comfortable:"여유",check:"확인",warning:"주의",delayed:"사용량 확인 지연"};
const backupKindLabel={weekly:"주간 백업",pre_migration:"DB 변경 전 백업",manual:"수동 백업",deletion_manifest:"삭제 기록"};
const backupStatusLabel={queued:"대기",running:"진행 중",verified:"검증 완료",failed:"실패",rotated:"보관 종료"};
const time=(value:string|null)=>value?new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"미확인";
export function OperationsPanel(){
  const [data,setData]=useState<ReturnType<typeof operationsUsageSchema.parse>|null>(null),[backups,setBackups]=useState<ReturnType<typeof backupListSchema.parse>|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[checked,setChecked]=useState<string[]>([]),[kind,setKind]=useState<"manual"|"pre_migration">("manual"),[confirmed,setConfirmed]=useState(false);
  const [notice,setNotice]=useState(""),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const controller=new AbortController();void weeklyRequest("/api/admin/usage-summary",operationsUsageSchema,"GET",undefined,controller.signal).then(setData).catch(()=>{if(!controller.signal.aborted)setError("비용·사용량을 확인하지 못했습니다. 기존 수치를 최신으로 표시하지 않습니다.");});void weeklyRequest("/api/admin/backups",backupListSchema,"GET",undefined,controller.signal).then(setBackups).catch(()=>{if(!controller.signal.aborted)setError("백업 상태를 확인하지 못했습니다. 다시 조회해 주세요.");});return()=>controller.abort();},[attempt]);
  async function open(){dialog.current?.showModal();setError("");try{setBackups(await weeklyRequest("/api/admin/backups",backupListSchema));}catch{setBackups(null);setError("백업 상태를 확인하지 못했습니다. 다시 조회해 주세요.");}}
  async function refresh(){setBusy(true);setError("");try{setData(await weeklyRequest("/api/admin/usage-summary/refresh",operationsUsageSchema,"POST",{}));setBackups(await weeklyRequest("/api/admin/backups",backupListSchema));}catch(e){setError(e instanceof Error?e.message:"갱신하지 못했습니다.");}finally{setBusy(false);}}
  async function month(){if(!data)return;setBusy(true);setError("");try{setData(await weeklyRequest("/api/admin/operations/monthly-check",operationsUsageSchema,"POST",{yearMonth:data.yearMonth,pricingVersion:data.pricingVersion,checkedServices:checked,confirmation:"official_policies_reviewed"}));setNotice("이번 달 요금 정책 확인을 기록했습니다. 실제 장애·사용량·백업 경고는 유지됩니다.");}catch(e){setError(e instanceof Error?e.message:"확인하지 못했습니다.");}finally{setBusy(false);}}
  async function backup(){setBusy(true);setError("");try{const accepted=await weeklyRequest("/api/admin/backups",backupAcceptedSchema,"POST",{requestKey,kind,confirmation:"export_may_pause_database"});setNotice(`백업 ${accepted.outcome==="replayed"?"기존 요청 확인":"요청 접수"} · 진행 상태를 새로 조회해 주세요.`);setRequestKey(crypto.randomUUID());setConfirmed(false);setBackups(await weeklyRequest("/api/admin/backups",backupListSchema));}catch(e){setError(e instanceof Error?e.message:"백업 접수 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.");}finally{setBusy(false);}}
  const latestSql=backups?.items.find(i=>i.kind!=="deletion_manifest"),latestManifest=backups?.items.find(i=>i.kind==="deletion_manifest");
  const backupProblem=[latestSql,latestManifest].some(i=>i?.status==="failed"||!!i?.errorCode);
  const worst=!data||data.items.some(i=>i.status==="delayed")?"사용량 확인 지연":data.items.some(i=>i.status==="warning")?"주의":data.items.some(i=>i.status==="check")?"확인":"여유";
  return <section className={styles.panel} aria-labelledby="operations-title"><h3 id="operations-title">비용·백업</h3><p role="status">{worst}</p>
    {data?.items.some(i=>i.status==="warning")&&<p role="alert">무료 포함량의80% 이상을 사용한 항목이 있습니다. 공식 관리 화면에서 확인해 주세요.</p>}
    {backupProblem&&<p role="alert">최근 백업·삭제 기록에 실패가 있습니다. 마지막 정상본을 보존하고 상세 상태를 확인하세요.</p>}
    {backups?.enabled&&<p>마지막 SQL 정상 완료: {time(backups.items.find(i=>i.kind!=="deletion_manifest"&&i.status==="verified")?.completedAt??null)} · 주간 정상본 {backups.weeklyVerifiedCount}/8</p>}
    {data?.policyCheckNeeded&&<p>이번 달 요금 정책 확인 필요 · <Link to="/admin/manual">매뉴얼의 월간 확인 항목 보기</Link></p>}
    {error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>void open()}>비용·백업 상세 열기</button>{!data&&<button type="button" onClick={()=>{setError("");setAttempt(v=>v+1);}}>사용량 다시 조회</button>}
    <dialog ref={dialog} className={local.drawer} aria-labelledby="operations-dialog-title"><header className={local.header}><h2 id="operations-dialog-title">비용·사용량과 백업</h2><button type="button" onClick={()=>dialog.current?.close()}>닫기</button></header>
      <p>앱의 관측 추정입니다. 공식 청구 금액과 무료 잔여량은 각 서비스 관리 화면에서 확인하세요. 계정 전체와 이 프로젝트 기여분을 구분합니다.</p>
      <button type="button" disabled={busy} onClick={()=>void refresh()}>{busy?"처리 중…":"사용량·백업 갱신"}</button>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {serviceRegistry.map(service=><details key={service.id} className={local.service}><summary>{service.name} · {data?statusLabel[data.items.find(i=>i.service===service.id)?.status??"delayed"]:"사용량 확인 지연"}</summary><p>{service.planAndCostType} · {service.freeAllowanceSummary}</p><a href={service.officialDocsUrl} target="_blank" rel="noreferrer">{service.name} 공식 가격·한도</a><p>관리 위치: {service.dashboardPath}</p>
        <p>가격 확인: {service.pricingCheckedAt.slice(0,10)} · 가격표 {data?.pricingVersion??"미확인"}</p>
        {(data?.items.filter(i=>i.service===service.id)??[]).map(item=><div key={`${item.scope}/${item.scopeId}`}><h4>{item.scope==="account"?"계정 전체":`이 프로젝트 · ${item.scopeId}`}</h4><p>{statusLabel[item.status]} · {item.source} · 갱신 {time(item.fetchedAt)}</p><p>집계 기간: {time(item.periodStart)} ~ {time(item.periodEnd)}</p><dl className={local.metrics}>{Object.entries(item.metrics).map(([key,value])=><div key={key}><dt>{({requests:"요청 수",cpuMs:"CPU 합계 ms",resourceErrors:"실행 한도 오류",storageBytes:"저장 bytes",objectCount:"파일 수",classA:"Class A 작업",classB:"Class B 작업",rowsRead:"읽은 행",rowsWritten:"쓴 행",costMicroUsd:"관측 비용 USD",steps:"관측 성공 단계 수",instances:"관측 시작 수",failures:"관측 실패 수",retries:"관측 시도 수",durationGbSeconds:"실행량 GB-s",buildMinutes:"빌드 분",buildLimitReached:"빌드 분 한도 도달(1=도달)",activeSeats:"활성 사용자",unknownCalls:"비용 미확인 호출",inputTokens:"입력 token",outputTokens:"출력 token",audioSeconds:"전사 초"} as Record<string,string>)[key]??key}</dt><dd>{value==null?"미확인":key==="costMicroUsd"?(value/1_000_000).toFixed(6):value.toLocaleString("ko-KR")}</dd></div>)}</dl>{Object.keys(item.metrics).length===0&&<p>자동 조회 미연결 · 관리 화면에서 확인 필요</p>}</div>)}
      </details>)}
      {data&&data.openAiModels.length>0&&<section><h3>이번 달 AI 모델별 관측</h3><p>과거 비용은 당시 계산값을 보존합니다. 캐시 저장 요금이 누락된 이전 가격표의 기록은 실제 청구보다 낮을 수 있으며, 퀴즈별 비용 상세에서 가격표를 확인할 수 있습니다.</p><ul>{data.openAiModels.map(model=><li key={model.model}>{model.model} · {model.calls}호출 · 입력 {model.inputTokens} / 출력 {model.outputTokens}token · 전사 {model.audioSeconds}초 · USD {(model.costMicroUsd/1_000_000).toFixed(6)} · 미확인 {model.unknownCalls}호출</li>)}</ul></section>}
      <p>Workflows 단계 수는 관측 성공 이벤트이며 청구 단계 수와 동일하다고 단정하지 않습니다. CPU 합계·GB-s·state storage를 확인하지 못하면 미확인으로 표시합니다.</p>
      <p>현재 별도 과금 없음: {noSeparateCharge.join(" · ")}</p>
      <section><h3>비공개 백업 상태</h3><p>{backups?.enabled?"백업 실행 켜짐":"백업 실행 꺼짐"} · 주간 정상본 {backups?.weeklyVerifiedCount??"미확인"}/8</p><p>별도 삭제 기록 갱신: {time(backups?.manifestUpdatedAt??null)}</p>
        {backups?.items.length===0&&<p>이 환경의 백업 실행 기록이 없습니다.</p>}<ul>{backups?.items.map(item=><li key={item.id}>{time(item.startedAt)} · {backupKindLabel[item.kind]} · {backupStatusLabel[item.status]} · {item.sizeBytes?.toLocaleString()??"크기 미확인"} bytes · 지문 {item.checksumPrefix??"미확인"}{item.errorCode&&` · 확인 필요 ${item.errorCode}`}</li>)}</ul>
        <label>백업 종류 <select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as typeof kind);setRequestKey(crypto.randomUUID());setConfirmed(false);}}><option value="manual">수동 백업</option><option value="pre_migration">DB 변경 전 백업</option></select></label>
        <p>전체 SQL export 동안 DB가 잠시 응답하지 못할 수 있습니다. 마지막 정상본을 유지하고 새 파일 검증 뒤 회전합니다.</p>
        <label className={local.check}><input type="checkbox" checked={confirmed} disabled={!backups?.enabled||busy} onChange={e=>setConfirmed(e.target.checked)}/>DB의 일시 응답 중단과 시작 시각을 확인했습니다.</label>
        <button type="button" disabled={!backups?.enabled||!confirmed||busy} onClick={()=>void backup()}>백업 요청</button><p>복원은 <Link to="/admin/manual">매뉴얼의 격리 복원 절차</Link>로 진행합니다.</p>
      </section>
      {data&&<section><h3>{data.yearMonth} 요금 정책 확인</h3><p>{data.policyCheckNeeded?"확인 필요":"이번 달 확인 완료"} · 마지막 확인 {time(data.checkedAt)}</p><fieldset disabled={busy}><legend>공식 링크와 현재 등록값을 서비스별로 확인하세요</legend>{serviceRegistry.map(service=><label key={service.id} className={local.check}><input type="checkbox" checked={checked.includes(service.id)} onChange={e=>setChecked(v=>e.target.checked?[...v,service.id]:v.filter(id=>id!==service.id))}/>{service.name} 정책 확인</label>)}</fieldset><button type="button" disabled={busy||checked.length!==serviceIds.length} onClick={()=>void month()}>이번 달 확인 완료</button></section>}
    </dialog>
  </section>;
}
