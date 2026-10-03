import { useEffect,useState } from "react";
import { Link,useLocation } from "react-router-dom";
import { z } from "zod";
import { weeklyRequest } from "../admin-weekly/client";
import { AdminNavigation } from "../admin-weekly/Dashboard";
import { serviceRegistry } from "../../config/service-registry";
import styles from "../admin-weekly/weekly.module.css";
import local from "./operations.module.css";
const schema=z.strictObject({markdown:z.string(),updatedAt:z.string(),verification:z.string(),deployment:z.string()});
function Text({source}:{source:string}){
  // Repository text is rendered as escaped React nodes, never raw HTML.
  return <article className={local.manual}>{source.split(/\n\n+/u).map((block,index)=>{
    if(block.startsWith("### "))return <h3 key={index}>{block.slice(4)}</h3>;
    if(block.startsWith("## "))return <h2 key={index}>{block.slice(3)}</h2>;
    if(block.startsWith("# "))return <h1 key={index}>{block.slice(2)}</h1>;
    if(block.startsWith("```"))return <pre key={index}>{block.replace(/^```[^\n]*\n|\n```$/gu,"")}</pre>;
    if(block.split("\n").every(line=>/^\d+\. /u.test(line)))return <ol key={index}>{block.split("\n").map((line,i)=><li key={i}>{line.replace(/^\d+\. /u,"")}</li>)}</ol>;
    if(block.split("\n").every(line=>line.startsWith("- ")))return <ul key={index}>{block.split("\n").map((line,i)=><li key={i}>{line.slice(2)}</li>)}</ul>;
    return <p key={index}>{block}</p>;
  })}</article>;
}
export function Component(){
  const {pathname}=useLocation(),future=pathname.endsWith("/future/member-auth"),[data,setData]=useState<z.infer<typeof schema>|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const c=new AbortController();void weeklyRequest(future?"/api/admin/manual/future/member-auth":"/api/admin/manual",schema,"GET",undefined,c.signal).then(setData).catch(()=>{if(!c.signal.aborted)setError("관리자 매뉴얼을 읽지 못했습니다. 다시 조회해 주세요.");});return()=>c.abort();},[future,attempt]);
  return <div className={styles.page}><AdminNavigation/><header className={styles.hero}><h2>운영 매뉴얼</h2><p>기존 결과와 키를 보존하며 주간 운영·비용 확인·문제 복구를 진행하는 안내입니다.</p>{data&&<p>문서 갱신 {data.updatedAt} · {data.verification} · 환경 {data.deployment}</p>}</header>
    {error&&<p role="alert">{error}</p>}{!data&&<p role="status">매뉴얼 확인 중</p>}<button type="button" onClick={()=>{setError("");setAttempt(v=>v+1);}}>매뉴얼 다시 조회</button>
    {data&&<Text source={data.markdown}/>}{!future&&<><section className={styles.panel}><h3>서비스 사전</h3>{serviceRegistry.map(service=><details key={service.id}><summary>{service.name} · {service.plainLanguageName}</summary><p>{service.purpose} · 사용 기능 {service.featuresUsingIt.join(", ")}</p><p>멈추면: {service.failureImpact}</p><p>{service.planAndCostType} · {service.freeAllowanceSummary}</p><p>운영자: {service.accountOwnerRole} · 등록 필요 {service.registrationRequired?"예":"아니요"}</p><p>{service.setupSummary}</p><p>관리 위치: {service.dashboardPath}</p><a href={service.officialDocsUrl} target="_blank" rel="noreferrer">공식 문서·가격 확인</a><p>연결·비밀의 이름: {service.secretAndBindingNames.join(" · ")||"없음"}</p><p>사용량 출처: {service.usageMetricSource}</p><p>월간 확인: {service.monthlyChecks.join(" · ")}</p><p>{service.backupOrExitProcedure} · 대안: {service.replacementOptions}</p><p>가격 확인 {service.pricingCheckedAt.slice(0,10)} · 문서 갱신 {service.manualUpdatedAt}</p></details>)}</section><Link to="/admin/manual/future/member-auth">향후 회원 로그인·교회 계정 연동 검토</Link></>}{future&&<Link to="/admin/manual">운영 매뉴얼로 돌아가기</Link>}</div>;
}
