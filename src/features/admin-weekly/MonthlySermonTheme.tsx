import { useEffect, useRef, useState } from "react";
import { sermonThemeSchema, sermonThemeTextSchema, type SermonTheme } from "../../../shared/api/sermon-themes";
import { AdminIcon } from "../../components/AdminIcon";
import { Button } from "../../components/Button";
import { weeklyRequest } from "./client";
import styles from "./monthly-theme.module.css";

const currentMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
export function MonthlySermonTheme() {
  const [opened, setOpened] = useState(false);
  return <details className={styles.panel} onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary><AdminIcon name="calendar"/><strong>월별 설교 주제</strong><span>지난 퀴즈에 함께 표시</span><AdminIcon name="chevron"/></summary>
    {opened && <ThemeForm/>}
  </details>;
}
function ThemeForm() {
  const [month, setMonth] = useState(currentMonth), [draft, setDraft] = useState("");
  const [data, setData] = useState<SermonTheme | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const preserveDraft = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    void weeklyRequest(`/api/admin/sermon-themes/${month}`, sermonThemeSchema, "GET", undefined, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setData(next); if (!preserveDraft.current) setDraft(next.theme);
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setError("주제를 불러오지 못했습니다. 다시 시도해 주세요."); setLoading(false); } });
    return () => controller.abort();
  }, [month, attempt]);
  const dirty = data !== null && draft !== data.theme;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || loading || saving) return;
    const parsed = sermonThemeTextSchema.safeParse(draft);
    if (!parsed.success) { setError("주제는 120자 이내의 한 줄로 입력해 주세요."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const next = await weeklyRequest(`/api/admin/sermon-themes/${month}`, sermonThemeSchema, "PATCH", { theme: parsed.data, expectedRevision: data.revision });
      if (mounted.current) { setData(next); setDraft(next.theme); setNotice("저장했습니다. 같은 달의 지난 퀴즈에 반영됩니다."); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "저장하지 못했습니다. 입력은 그대로 남아 있습니다."); }
    finally { if (mounted.current) setSaving(false); }
  }
  return <form className={styles.form} onSubmit={event => { void save(event); }} aria-label="월별 설교 주제" aria-busy={loading || saving}>
    <p id="theme-help">선택한 달의 모든 지난 퀴즈에 같은 주제를 표시합니다. 비워서 저장하면 ‘주제: 미등록’으로 표시합니다.</p>
    <div className={styles.fields}>
      <label>설교 월<input type="month" min="0001-01" max="9999-12" value={month} disabled={dirty || saving} required onChange={event => {
        setMonth(event.target.value); setData(null); setDraft(""); setLoading(Boolean(event.target.value)); setError(""); setNotice(""); preserveDraft.current = false;
      }}/></label>
      <label>월별 주제<input type="text" value={draft} maxLength={120} disabled={!data || loading || saving} aria-describedby="theme-help" placeholder="예: 함께 자라는 믿음" onChange={event => { setDraft(event.target.value); setNotice(""); }}/></label>
      <Button type="submit" variant="primary" disabled={!data || loading || saving || !dirty}>{saving ? "저장 중…" : "주제 저장"}</Button>
    </div>
    {dirty && <div className={styles.draftNotice}><span>다른 달로 이동하려면 먼저 저장하거나 입력을 취소하세요.</span><Button type="button" disabled={saving || loading} onClick={() => { setDraft(data?.theme ?? ""); setError(""); }}>입력 취소</Button></div>}
    {error && <div role="alert" className={styles.error}><span>{error}</span><Button type="button" disabled={saving || loading} onClick={() => {
      preserveDraft.current = dirty; setLoading(true); setError(""); setNotice(dirty ? "작성한 내용은 유지하고 최신 저장 상태를 다시 불러옵니다." : ""); setAttempt(value => value + 1);
    }}>{data ? "최신 상태 확인" : "다시 시도"}</Button></div>}
    <p role="status" className={styles.status}>{loading ? "주제를 확인하고 있습니다." : notice}</p>
  </form>;
}
