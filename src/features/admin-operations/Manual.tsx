import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { AdminIntro } from "../../components/AdminGuide";
import { Button } from "../../components/Button";
import { weeklyRequest } from "../admin-weekly/client";
import { serviceRegistry } from "../../config/service-registry";
import { serviceGuides } from "./service-guides";
import { ManualText } from "./ManualText";
import styles from "../admin-weekly/weekly.module.css";
import local from "./operations.module.css";

const schema = z.strictObject({ markdown: z.string(), updatedAt: z.string(), verification: z.string(), deployment: z.string() });
export function Component() {
  const { pathname } = useLocation();
  return <ManualPage key={pathname} future={pathname.endsWith("/future/member-auth")}/>;
}
function ManualPage({ future }: { future: boolean }) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void weeklyRequest(future ? "/api/admin/manual/future/member-auth" : "/api/admin/manual", schema, "GET", undefined, controller.signal)
      .then(next => { if (!controller.signal.aborted) setData(next); })
      .catch(() => { if (!controller.signal.aborted) setError("안내문을 불러오지 못했습니다. 아래 버튼으로 다시 시도해 주세요."); });
    return () => controller.abort();
  }, [future, attempt]);
  return <div className={styles.page}>
    <AdminIntro title={future ? "향후 회원 로그인 검토" : "운영 매뉴얼"} description={future ? "아직 제공하지 않는 기능의 검토 내용입니다." : "퀴즈를 만드는 순서부터 문제가 생겼을 때의 대처까지, 필요한 항목을 펼쳐보세요."}/>
    {error && <div role="alert"><p>{error}</p><Button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>안내문 다시 불러오기</Button></div>}
    {!data && !error && <p role="status">안내문을 불러오고 있습니다.</p>}
    {data && <ManualText source={data.markdown}/>}
    {!future && <section className={local.dictionary} aria-labelledby="service-dictionary-heading">
      <h3 id="service-dictionary-heading">서비스 사전</h3>
      <p>이 사이트 뒤에서 일하는 서비스들입니다. 이름을 누르면 어떤 역할을 하는지 알 수 있습니다.</p>
      <div className={local.manual}>{serviceRegistry.map(service => {
        const guide = serviceGuides[service.id];
        return <details key={service.id}>
          <summary><span className={local.serviceName}>{service.name}</span><span className={local.serviceSubtitle}>{service.plainLanguageName}</span></summary>
          <div className={local.serviceGuide}>
            <p className={local.lead}>{guide.role}</p>
            <dl className={local.guideFacts}>
              <div><dt>언제 쓰나요?</dt><dd>{guide.when}</dd></div>
              <div><dt>멈추면 어떻게 되나요?</dt><dd>{guide.failure}</dd></div>
              <div><dt>내가 확인할 것은?</dt><dd>{guide.check}</dd></div>
            </dl>
            <a className={local.docLink} href={service.officialDocsUrl} target="_blank" rel="noreferrer">{service.name} 공식 안내 ↗</a>
            <details className={local.technical}><summary>연결 설정·비용 기록 자세히</summary>
              <p>아래는 설정을 점검할 때 참고하는 정보입니다. 평소 퀴즈를 운영할 때는 바꾸지 않아도 됩니다.</p>
              <dl className={local.guideFacts}>
                <div><dt>관리 화면에서 찾는 곳</dt><dd>{service.dashboardPath}</dd></div>
                <div><dt>기록된 요금 방식</dt><dd>{service.planAndCostType}<br/>{service.freeAllowanceSummary}</dd></div>
                <div><dt>연결 이름</dt><dd>{service.secretAndBindingNames.length ? service.secretAndBindingNames.map(name => <code key={name}>{name}</code>) : "별도로 입력할 연결 이름이 없습니다."}</dd></div>
              </dl>
              <p className={local.note}>요금 정보 확인일: {service.pricingCheckedAt.slice(0, 10)}. 현재 요금이나 남은 무료량을 실시간으로 보여주는 정보는 아닙니다. 비용을 확인할 때는 위 공식 안내와 해당 계정의 청구 화면을 함께 확인하세요.</p>
            </details>
          </div>
        </details>;
      })}</div>
    </section>}
    {data && <details className={local.documentInfo}><summary>안내문 수정일과 서버 정보</summary>
      <dl className={local.guideFacts}>
        <div><dt>안내문 수정일</dt><dd>{data.updatedAt} · 글을 마지막으로 고친 날짜입니다.</dd></div>
        <div><dt>검사 기록</dt><dd>개발 과정에서 동작을 확인한 기록의 이름입니다. 지금 서버를 실시간으로 검사했다는 뜻은 아닙니다.<br/><span className={local.note}>{data.verification}</span></dd></div>
        <div><dt>접속한 서버</dt><dd>{data.deployment.includes("미연결") ? "이 화면에서는 서버 종류 또는 배포 번호를 확인할 수 없습니다. 로컬 실행에서도 이렇게 표시될 수 있으며, 서비스 장애를 뜻하지는 않습니다." : data.deployment}</dd></div>
      </dl>
    </details>}
    {future ? <Link to="/admin/manual">운영 매뉴얼로 돌아가기</Link> : <Link to="/admin/manual/future/member-auth">향후 회원 로그인·교회 계정 연동 검토</Link>}
  </div>;
}
