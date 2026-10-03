import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { draftListSchema, draftMetadataViewSchema, registerSermonResultSchema, type DraftItem, type DraftMetadataView } from "../../../shared/api/admin-sermon-drafts";
import { adminPublicVideoPreviewSchema, type AdminPublicVideoPreview } from "../../../shared/api/admin-public-video";
import { BIBLE_BOOKS, createBibleReference, getBibleBook, getVerseCount, parseBibleReference, type BibleBookId } from "../../../shared/bible-reference";
import { extractSermonTitleMetadata, suggestSermonDate } from "../../../shared/sermon-registration";
import styles from "./admin-sermon-input.module.css";

async function request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal, method = "GET", body?: unknown, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(`/api/admin/sermon-drafts${path}`, { method, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const json = await response.json() as { data?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(json.error?.message ?? "작업을 확인하지 못했습니다. 다시 불러와 주세요.");
  return schema.parse(json.data);
}

function MetadataForm({ view, onSave, onSelectExisting, busy }: {
  view: DraftMetadataView | null;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
  onSelectExisting: (id: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [video, setVideo] = useState("");
  const [preview, setPreview] = useState<AdminPublicVideoPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const previewOperation = useRef<AbortController | null>(null);
  useEffect(() => () => previewOperation.current?.abort(), []);
  const [title, setTitle] = useState(view?.title ?? "");
  const [date, setDate] = useState(view?.sermonDate ?? suggestSermonDate("").date);
  const [referenceInput, setReferenceInput] = useState(view?.referenceLabel ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState(view ? "저장된 설교일" : "작업 생성일 기준 최근 일요일");
  const [book, setBook] = useState<BibleBookId>(view?.bibleReference?.reference.bookId ?? "GEN");
  const [chapter, setChapter] = useState(view?.bibleReference?.reference.start.chapter ?? 1);
  const [start, setStart] = useState(view?.bibleReference?.reference.start.verse ?? 1);
  const [end, setEnd] = useState(view?.bibleReference?.reference.end.verse ?? 1);
  const parsed = parseBibleReference(referenceInput);
  function changeReference(value: string) {
    setReferenceInput(value); setConfirmed(false);
    const result = parseBibleReference(value);
    if (result.ok) { setBook(result.value.reference.bookId); setChapter(result.value.reference.start.chapter); setStart(result.value.reference.start.verse); setEnd(result.value.reference.end.verse); }
  }
  function selectReference(b: BibleBookId, c: number, s: number, e: number) {
    const result = createBibleReference({ bookId: b, chapter: c, verseStart: s, verseEnd: e });
    if (result.ok) changeReference(result.value.canonicalLabel);
  }
  const weekday = z.iso.date().safeParse(date).success ? new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "";
  async function inspectVideo() {
    if (!video.trim() || previewBusy || busy) return;
    previewOperation.current?.abort();
    const controller = new AbortController();
    previewOperation.current = controller;
    setPreviewBusy(true); setPreview(null); setPreviewError(""); setCopyMessage(""); setConfirmed(false);
    try {
      const result = await request("/video-preview", adminPublicVideoPreviewSchema, controller.signal, "POST", { video }, 45_000);
      if (controller.signal.aborted) return;
      setPreview(result);
      if (result.outcome === "inspected") {
        if (result.title) {
          const fields = extractSermonTitleMetadata(result.title);
          setTitle(fields.title);
          changeReference(fields.referenceInput ?? "");
        }
        const suggested = suggestSermonDate(result.title ?? title, new Date(), result.publishedDate ?? undefined);
        setDate(suggested.date); setReason(suggested.reason + (suggested.distant ? " · 게시일과 31일 넘게 차이 납니다. 설교일을 확인해 주세요." : ""));
      }
    } catch (failure) {
      if (!controller.signal.aborted) setPreviewError(failure instanceof Error ? failure.message : "영상 정보를 확인하지 못했습니다. 직접 입력해 주세요.");
    } finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }
  async function copyDiagnostic(code: string, diagnostic: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ code, diagnostic }, null, 2));
      setCopyMessage("진단 정보를 복사했습니다.");
    } catch { setCopyMessage("복사하지 못했습니다. 기술 정보를 선택해 복사해 주세요."); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.ok || !confirmed || busy || previewBusy) return;
    await onSave({ ...(view ? { expectedRevision: view.metadataRevision } : { video }), title, sermonDate: date, referenceInput, confirmed: true });
  }
  const options = (count: number) => Array.from({ length: count }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>);
  return <form onSubmit={event => void submit(event)}>
    <fieldset disabled={busy || previewBusy} className={`${styles.displayFields} ${styles.draftFields}`} onChange={() => setConfirmed(false)}>
      <legend>{view ? "발행 전 설교 정보" : "새 설교 등록"}</legend>
      <div className={styles.formGrid}>
        {!view && <label>YouTube 영상 링크<input value={video} required onChange={e => {
          previewOperation.current?.abort();
          setVideo(e.target.value); setPreview(null); setPreviewError(""); setConfirmed(false);
        }} /></label>}
        <label>설교 제목<input value={title} required maxLength={300} onChange={e => setTitle(e.target.value)} /></label>
        <label>설교 일자(주일)<input type="date" value={date} required onChange={e => { setDate(e.target.value); setReason("직접 선택"); }} /></label>
      </div>
      {!view && <div className={styles.actions}>
        <button type="button" onClick={() => void inspectVideo()} disabled={!video.trim()}>{previewBusy ? "영상 확인 중" : "영상 정보·공개 자막 확인"}</button>
        <button type="button" onClick={() => { const candidate = suggestSermonDate(title); setDate(candidate.date); setReason(candidate.reason); setConfirmed(false); }}>제목에서 설교일 추천</button>
      </div>}
      {previewError && <p role="alert">{previewError} 제목·설교일을 직접 입력해 계속할 수 있습니다.</p>}
      {preview?.outcome === "existing" && <div role="status">
        <p>같은 영상의 {preview.destination === "draft" ? "미발행 작업" : preview.destination === "published" ? "발행 이력" : "정리된 초안"}이 있습니다. 새 정보로 덮어쓰지 않습니다.</p>
        {preview.destination === "draft" && <button type="button" onClick={() => void onSelectExisting(preview.sermonId)}>기존 작업 선택</button>}
      </div>}
      {preview?.outcome === "inspected" && <div className={styles.previewNotice} role="status">
        <p>영상 제목: {preview.title ?? "확인되지 않음 · 직접 입력해 주세요"} · 게시일: {preview.publishedDate ?? "확인되지 않음"}</p>
        <p>영상 제목에서 인식한 날짜·장절은 자동 입력합니다. 인식하지 못한 항목은 직접 입력하고 확인해 주세요.</p>
        {preview.caption.status === "available"
          ? <p>공개 한국어 {preview.caption.generated ? "자동" : "수동"} 자막 {preview.caption.segmentCount}구간 · {preview.caption.characterCount.toLocaleString("ko-KR")}자. 등록 후 원본 저장 단계에서 다시 취득합니다.{preview.caption.characterCount > 30_000 ? " 3만 자를 넘으므로 원본 저장은 차단됩니다." : ""}</p>
          : <><p>{preview.caption.message} {preview.caption.code === "TRANSCRIPT_SOURCE_BLOCKED"
            ? "반복 조회해도 계속 차단될 수 있습니다. 설교 정보를 확인해 등록한 뒤 YouTube의 ‘스크립트 표시’ 내용을 직접 붙여넣을 수 있습니다."
            : "등록 후 다시 시도하거나 텍스트를 직접 붙여넣을 수 있습니다."}</p>
            {preview.title && <p>영상 기본 정보는 확인했지만, 자막 원본은 아직 가져오지 못했습니다.</p>}
            <details><summary>기술 정보</summary><pre>{JSON.stringify({ code: preview.caption.code, diagnostic: preview.caption.diagnostic }, null, 2)}</pre></details>
            <button type="button" onClick={() => { const caption = preview.caption; if (caption.status === "unavailable") void copyDiagnostic(caption.code, caption.diagnostic); }}>진단 정보 복사</button>
            {copyMessage && <p role="status">{copyMessage}</p>}</>}
      </div>}
      <p>{reason} · {weekday}{weekday && weekday !== "일요일" ? ": 특별예배 등 의도한 날짜인지 확인해 주세요. 저장은 가능합니다." : ""}</p>
      <label>성경 장절<input value={referenceInput} required placeholder="영상 제목에서 확인되지 않으면 직접 입력" onChange={e => changeReference(e.target.value)} /></label>
      <div className={styles.formGrid}>
        <label>성경 책<select value={parsed.ok ? book : ""} onChange={e => selectReference(e.target.value as BibleBookId, 1, 1, 1)}><option value="" disabled>성경 책 선택</option>{BIBLE_BOOKS.map(b => <option key={b.bookId} value={b.bookId}>{b.canonicalKoreanName}</option>)}</select></label>
        <label>장<select value={chapter} onChange={e => selectReference(book, Number(e.target.value), 1, 1)}>{options(getBibleBook(book).chapterCount)}</select></label>
        <label>시작 절<select value={start} onChange={e => selectReference(book, chapter, Number(e.target.value), Math.max(end, Number(e.target.value)))}>{options(getVerseCount(book, chapter) ?? 1)}</select></label>
        <label>끝 절<select value={end} onChange={e => selectReference(book, chapter, Math.min(start, Number(e.target.value)), Number(e.target.value))}>{options(getVerseCount(book, chapter) ?? 1)}</select></label>
      </div>
      {parsed.ok ? <p>{parsed.value.canonicalLabel} · 총 {parsed.value.verseCount}절 · 개역개정 <a href={parsed.value.readingPortalUrl} target="_blank" rel="noreferrer">대한성서공회에서 읽기</a></p>
        : <p>{referenceInput ? parsed.error.message : "성경 장절을 입력하거나 책·장·절을 선택해 주세요."}</p>}
      {view && <p>공개 주소 미리보기: /quiz/{date}-{view.slugPreview.split("-").at(-1)}</p>}
    </fieldset>
    <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={busy || !parsed.ok} onChange={e => setConfirmed(e.target.checked)} />제목·설교일·성경 장절을 확인했습니다.</label>
    <button type="submit" className="primary-button" disabled={busy || previewBusy || !confirmed || !parsed.ok}>{busy ? "저장 중" : view ? "설교 정보 저장" : "새 작업 등록"}</button>
  </form>;
}

export function SermonDrafts({ selectedId, onSelect, onMetadataSaved, onCostQuizSetId, disabled, initialCreating = false }: {
  initialCreating?: boolean; selectedId: string; onSelect: (id: string) => Promise<boolean>; onMetadataSaved: () => void; onCostQuizSetId: (id: string | null) => void; disabled: boolean;
}) {
  const [items, setItems] = useState<DraftItem[] | null>(null), [view, setView] = useState<DraftMetadataView | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const [creating, setCreating] = useState(initialCreating), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void request("", draftListSchema, controller.signal).then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(() => { if (!controller.signal.aborted) setError("미발행 목록을 불러오지 못했습니다. 다시 시도해 주세요."); });
    return () => controller.abort();
  }, [version]);
  useEffect(() => {
    onCostQuizSetId(null);
    if (!selectedId) return;
    const controller = new AbortController();
    void request(`/${selectedId}`, draftMetadataViewSchema, controller.signal).then(data => { if (!controller.signal.aborted) { setView(data); setDetailError(null); onCostQuizSetId(data.quizSetId); } })
      .catch(() => { if (!controller.signal.aborted) { setView(null); setDetailError({ id: selectedId, message: "발행 전 정보를 불러오지 못했습니다. 작업 목록을 새로고침하거나 발행·초안 보관 상태를 확인해 주세요." }); } });
    return () => controller.abort();
  }, [selectedId, version, onCostQuizSetId]);
  async function save(fields: Record<string, unknown>) {
    if (busy) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setMessage("");
    try {
      if (creating) {
        const result = await request("", registerSermonResultSchema, controller.signal, "POST", fields);
        if (controller.signal.aborted) return;
        if (result.destination === "draft") {
          setCreating(false); setView(null);
          await onSelect(result.sermonId);
          setMessage(result.outcome === "existing" ? "같은 영상의 기존 작업을 불러왔습니다. 새로 입력한 정보로 덮어쓰지 않았습니다." : "새 작업을 등록했습니다. 아래에서 입력자료를 저장해 주세요.");
        } else setMessage(result.destination === "published" ? "이미 등록·발행된 영상입니다. 발행된 퀴즈 관리에서 계속해 주세요." : "같은 영상의 초안 본문이 보관 기간에 따라 정리되었습니다. 초안 보관 현황을 확인해 주세요.");
      } else if (view) {
        const saved = await request(`/${view.sermonId}`, draftMetadataViewSchema, controller.signal, "PATCH", fields);
        if (controller.signal.aborted) return;
        setView(saved); onMetadataSaved(); setMessage("설교 정보를 저장했습니다. 생성·배치 검수는 현재 정보를 기준으로 다시 확인해 주세요.");
      }
      setVersion(value => value + 1);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "저장에 실패했습니다."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="sermon-drafts-title">
    <h3 id="sermon-drafts-title">설교 작업 선택</h3>
    <p>영상 링크에서 제목·게시일 후보와 공개 자막 상태를 확인할 수 있습니다. 설교일·장절은 직접 확인하고, 자막을 가져오지 못하면 텍스트를 붙여넣어 주세요.</p>
    <div className={styles.actions}>
      <button type="button" disabled={busy || disabled} onClick={() => { setCreating(v => !v); setError(""); setMessage(""); }}>{creating ? "등록 닫기" : "새 설교 등록"}</button>
      <button type="button" disabled={busy || disabled} onClick={() => { setError(""); setView(null); setVersion(v => v + 1); }}>작업 목록 새로고침</button>
    </div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {items === null ? <p role="status">미발행 작업을 불러오고 있습니다.</p> : items.length === 0 ? <p>미발행 작업이 없습니다. 새 설교를 등록해 주세요.</p> :
      <label>미발행 작업<select value={items.some(item => item.sermonId === selectedId) ? selectedId : ""} disabled={busy || disabled} onChange={e => {
        if (e.target.value) { setCreating(false); setView(null); setError(""); setMessage(""); void onSelect(e.target.value); }
      }}><option value="" disabled>작업을 선택해 주세요</option>{items.map(item => <option key={item.sermonId} value={item.sermonId} disabled={item.expired}>{item.sermonDate} · {item.title}{item.expired ? " (본문 정리됨)" : ""}</option>)}</select></label>}
    {!creating && detailError?.id === selectedId && <p role="alert">{detailError.message}</p>}
    {creating ? <MetadataForm key="new" view={null} onSave={save} onSelectExisting={async id => { setCreating(false); setView(null); return onSelect(id); }} busy={busy || disabled} />
      : view && view.sermonId === selectedId && <MetadataForm onSelectExisting={onSelect} key={`${view.sermonId}-${view.metadataRevision}-${version}`} view={view} onSave={save} busy={busy || disabled} />}
  </section>;
}
