import { AdminLabel } from "../../components/AdminHelp";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { AdminIntro } from "../../components/AdminGuide";
import { Button } from "../../components/Button";
import { weeklyRequest } from "../admin-weekly/client";
import { ManualText } from "./ManualText";
import { ManualReader } from "./ManualReader";
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
    <AdminIntro title={future ? "기능 검토 기록" : "운영 매뉴얼"} description={future ? "회원 로그인 등 기능 제안과 과거 검토를 모았습니다. 현재 제공 여부는 운영 매뉴얼에서 확인하세요." : "목차에서 필요한 주제를 고르세요. 점선 밑줄이 있는 용어에 마우스를 올리거나 누르면 설명이 나옵니다."}/>
    {error && <div role="alert"><p>{error}</p><Button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>안내문 다시 불러오기</Button></div>}
    {!data && !error && <p role="status">안내문을 불러오고 있습니다.</p>}
    {data && (future ? <ManualText source={data.markdown}/> : <ManualReader source={data.markdown}/>)}
    {data && <details className={local.documentInfo}><summary><AdminLabel text="안내문 수정일과 서버 정보"/></summary>
      <dl className={local.guideFacts}>
        <div><dt>안내문 수정일</dt><dd>{data.updatedAt} · 글을 마지막으로 고친 날짜입니다.</dd></div>
        <div><dt>검사 기록</dt><dd>개발 과정에서 동작을 확인한 기록의 이름입니다. 현재 서버의 실시간 검사 결과는 아닙니다. <span className={local.note}>{data.verification}</span></dd></div>
        <div><dt>접속한 서버</dt><dd>{data.deployment.includes("미연결") ? "이 화면에서는 서버 종류 또는 배포 번호를 확인할 수 없습니다. 로컬 실행에서도 이렇게 표시될 수 있으며, 서비스 장애를 뜻하지는 않습니다." : data.deployment}</dd></div>
      </dl>
    </details>}
    {future ? <Link to="/admin/manual">운영 매뉴얼로 돌아가기</Link> : <Link to="/admin/manual/future/member-auth">기능 검토 기록</Link>}
  </div>;
}
