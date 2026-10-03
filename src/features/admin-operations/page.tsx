import { AdminNavigation } from "../admin-weekly/Dashboard";
import { OperationsPanel } from "./OperationsPanel";
import styles from "../admin-weekly/weekly.module.css";
export function Component(){return <div className={styles.page}><AdminNavigation/><header className={styles.hero}><h2>비용·백업 상태</h2><p>공식 청구 확인과 비공개 백업 상태를 함께 살펴봅니다.</p></header><OperationsPanel/></div>;}
