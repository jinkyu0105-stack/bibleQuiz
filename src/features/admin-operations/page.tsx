import { AdminIntro, AdminSteps } from "../../components/AdminGuide";
import { OperationsPanel } from "./OperationsPanel";
import styles from "../admin-weekly/weekly.module.css";
export function Component() {
  return <div className={styles.page}>
    <AdminIntro title="비용·백업 상태" description="사이트 사용량과 데이터 백업이 정상인지 확인하는 곳입니다. 상세 화면에서 서비스별 사용량과 백업 기록을 볼 수 있습니다."/>
    <AdminSteps steps={[
      {title:"현재 상태 확인",description:"주의·실패 표시가 있으면 상세 내용을 살펴봅니다."},
      {title:"필요할 때 상세 조회",description:"사용량을 갱신하거나 최근 백업 기록을 확인합니다."},
      {title:"한 달에 한 번 점검",description:"공식 요금·한도를 확인하고 월간 확인을 기록합니다."},
    ]}/>
    <OperationsPanel/>
  </div>;
}
