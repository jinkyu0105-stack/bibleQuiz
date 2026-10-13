import { AdminLabel } from "../../components/AdminHelp";
import { AdminIntro, AdminTool } from "../../components/AdminGuide";
import { Button, ButtonLink } from "../../components/Button";
import { ProblemCorrection } from "../admin-sermon-input/ProblemCorrection";
import { WithdrawPublication } from "../admin-sermon-input/WithdrawPublication";
import { PublishedMetadata } from "../admin-sermon-input/PublishedMetadata";
import { DraftCleanup } from "../admin-sermon-input/DraftCleanup";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  BIBLE_BOOKS,
  getBibleBook,
  getVerseCount,
  type BibleBookId,
  type NormalizedBibleReference,
} from "../../../shared/bible-reference";
import type { BibleReferencePreviewQuery } from "../../../shared/api/admin-bible-reference";
import {
  parseAdminBibleReference,
  previewAdminBibleReference,
  type AdminBibleReferenceClientError,
} from "./client";
import { AdminSermonInput } from "../admin-sermon-input/AdminSermonInput";
import styles from "./admin-bible-reference.module.css";

type RequestState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; data: NormalizedBibleReference }
  | { state: "error"; error: AdminBibleReferenceClientError };

const DEFAULT_BOOK_ID: BibleBookId = "GEN";

function chapterOptions(bookId: BibleBookId): number[] {
  return Array.from({ length: getBibleBook(bookId).chapterCount }, (_, index) => index + 1);
}

function verseOptions(bookId: BibleBookId, chapter: number): number[] {
  const count = getVerseCount(bookId, chapter);
  return count === undefined ? [] : Array.from({ length: count }, (_, index) => index + 1);
}

function ReferenceResult({ data }: { data: NormalizedBibleReference }) {
  return <section className={styles.result} aria-live="polite" aria-labelledby="reference-result-title">
    <h4 id="reference-result-title">{data.canonicalLabel}</h4>
    <dl>
      <dt>판본</dt><dd>{data.translation}</dd>
      <dt>범위</dt><dd>{data.verseCount}절</dd>
      <dt>본문</dt><dd>이 화면에는 본문을 표시하지 않습니다.</dd>
      <dt>공식 읽기</dt><dd><a href={data.readingPortalUrl} target="_blank" rel="noreferrer">대한성서공회 읽기 포털 열기</a></dd>
    </dl>
  </section>;
}

function RequestFeedback({ request }: { request: RequestState }) {
  if (request.state === "idle") return null;
  if (request.state === "loading") return <p className={styles.loading} role="status">성경 장절을 확인하고 있습니다.</p>;
  if (request.state === "success") return <ReferenceResult data={request.data} />;
  return <div className={styles.error} role="alert">
    <p>{request.error.message}</p>
    {request.error.requestId && <p className={styles.requestId}>문의용 번호: {request.error.requestId}</p>}
  </div>;
}

function BibleReferenceTool() {
  const naturalRequest = useRef<AbortController | null>(null);
  const selectionRequest = useRef<AbortController | null>(null);
  const [naturalInput, setNaturalInput] = useState("");
  const [natural, setNatural] = useState<RequestState>({ state: "idle" });
  const [bookId, setBookId] = useState<BibleBookId>(DEFAULT_BOOK_ID);
  const [chapter, setChapter] = useState(1);
  const [verseStart, setVerseStart] = useState(1);
  const [verseEnd, setVerseEnd] = useState(1);
  const [selection, setSelection] = useState<RequestState>({ state: "idle" });

  const chapters = useMemo(() => chapterOptions(bookId), [bookId]);
  const verses = useMemo(() => verseOptions(bookId, chapter), [bookId, chapter]);

  useEffect(() => () => {
    naturalRequest.current?.abort();
    selectionRequest.current?.abort();
  }, []);

  function setBook(nextBookId: BibleBookId) {
    setBookId(nextBookId);
    setChapter(1);
    setVerseStart(1);
    setVerseEnd(1);
    setSelection({ state: "idle" });
  }

  function setSelectedChapter(nextChapter: number) {
    setChapter(nextChapter);
    setVerseStart(1);
    setVerseEnd(1);
    setSelection({ state: "idle" });
  }

  function setStart(nextStart: number) {
    setVerseStart(nextStart);
    setVerseEnd((current) => Math.max(current, nextStart));
    setSelection({ state: "idle" });
  }

  function submitNatural(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (natural.state === "loading") return;
    naturalRequest.current?.abort();
    const controller = new AbortController();
    naturalRequest.current = controller;
    setNatural({ state: "loading" });
    void parseAdminBibleReference(naturalInput, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setNatural(result.ok ? { state: "success", data: result.data } : { state: "error", error: result.error });
    });
  }

  function submitSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selection.state === "loading") return;
    const query: BibleReferencePreviewQuery = { book: bookId, chapter, verseEnd, verseStart };
    selectionRequest.current?.abort();
    const controller = new AbortController();
    selectionRequest.current = controller;
    setSelection({ state: "loading" });
    void previewAdminBibleReference(query, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSelection(result.ok ? { state: "success", data: result.data } : { state: "error", error: result.error });
    });
  }

  return <section className={styles.page} aria-labelledby="admin-bible-title">
    <header className={styles.intro}>
      <p className="eyebrow">보조 도구</p>
      <h2 id="admin-bible-title"><AdminLabel text="성경 장절 확인"/></h2>
      <p>자연어 입력과 목록 선택이 같은 장절 형식으로 확인되는지 비교할 수 있습니다.</p>
      <p className={styles.notice}>이 단계에서는 장절을 저장하거나 설교 내용을 편집하지 않습니다. 개역개정 본문도 이 화면에 표시하지 않습니다.</p>
    </header>

    <div className={styles.workspace}>
      <form className={styles.form} onSubmit={submitNatural} noValidate>
        <h3><AdminLabel text="자연어로 입력"/></h3>
        <p>예: 요한복음 3:1-3, 요 3:16, 요한복음 3장 1절-3절</p>
        <div className={styles.fields}>
          <label htmlFor="natural-reference">성경 장절
            <input
              id="natural-reference"
              value={naturalInput}
              onChange={(event) => { setNaturalInput(event.target.value); setNatural({ state: "idle" }); }}
              placeholder="요한복음 3:1-3"
              autoComplete="off"
            />
          </label>
        </div>
        <Button className={styles.submit} type="submit" disabled={natural.state === "loading"}>
          {natural.state === "loading" ? "확인 중" : "입력 확인"}
        </Button>
        <RequestFeedback request={natural} />
      </form>

      <form className={styles.form} onSubmit={submitSelection}>
        <h3><AdminLabel text="66권에서 선택"/></h3>
        <p>책, 장, 시작 절, 마지막 절을 차례로 선택합니다. 같은 장 안의 연속 범위만 확인할 수 있습니다.</p>
        <div className={styles.fields}>
          <label htmlFor="bible-book">성경 책
            <select id="bible-book" value={bookId} onChange={(event) => setBook(event.target.value as BibleBookId)}>
              <optgroup label="구약">
                {BIBLE_BOOKS.filter((book) => book.testament === "old").map((book) => <option key={book.bookId} value={book.bookId}>{book.canonicalKoreanName}</option>)}
              </optgroup>
              <optgroup label="신약">
                {BIBLE_BOOKS.filter((book) => book.testament === "new").map((book) => <option key={book.bookId} value={book.bookId}>{book.canonicalKoreanName}</option>)}
              </optgroup>
            </select>
          </label>
          <div className={styles.rangeFields}>
            <label htmlFor="bible-chapter">장
              <select id="bible-chapter" value={chapter} onChange={(event) => setSelectedChapter(Number(event.target.value))}>
                {chapters.map((value) => <option key={value} value={value}>{value}장</option>)}
              </select>
            </label>
            <label htmlFor="bible-verse-start">시작 절
              <select id="bible-verse-start" value={verseStart} onChange={(event) => setStart(Number(event.target.value))}>
                {verses.map((value) => <option key={value} value={value}>{value}절</option>)}
              </select>
            </label>
            <label htmlFor="bible-verse-end">마지막 절
              <select id="bible-verse-end" value={verseEnd} onChange={(event) => { setVerseEnd(Number(event.target.value)); setSelection({ state: "idle" }); }}>
                {verses.filter((value) => value >= verseStart).map((value) => <option key={value} value={value}>{value}절</option>)}
              </select>
            </label>
          </div>
        </div>
        <Button className={styles.submit} type="submit" disabled={selection.state === "loading"}>
          {selection.state === "loading" ? "확인 중" : "선택 확인"}
        </Button>
        <RequestFeedback request={selection} />
      </form>
    </div>
  </section>;
}

export function Component() {
  return <div className={styles.tools}>
    <AdminIntro terms={["초안", "발행"]} screenshots={["settings", "input"]} title="수정·보관 도구" description="발행한 퀴즈 수정부터 설교 자료 점검까지, 필요한 도구를 선택하세요.">
      <ButtonLink to="/admin">퀴즈 목록으로</ButtonLink>
    </AdminIntro>
    <div className={styles.toolGroup}>
      <div className={styles.groupHeading}><h3><AdminLabel text="발행한 퀴즈"/></h3><p>제출이 있는지와 수정할 내용에 따라 도구가 달라집니다.</p></div>
      <AdminTool id="metadata" tag="제목·설교일·오탈자" title="발행 정보 수정" description="제목·날짜·요약·단서의 오탈자를 고칩니다."><PublishedMetadata /></AdminTool>
      <AdminTool id="withdrawal" tag="아직 제출이 없다면" title="발행 취소" description="제출이 없는 퀴즈를 비공개로 돌리고 다시 준비합니다."><WithdrawPublication /></AdminTool>
      <AdminTool id="correction" tag="이미 제출이 있는 퀴즈" title="문제·정답 수정" description="제출이 있는 퀴즈의 오류를 수정합니다. 기존 답안과 결과는 보존됩니다."><ProblemCorrection /></AdminTool>
    </div>
    <div className={styles.toolGroup}>
      <div className={styles.groupHeading}><h3><AdminLabel text="초안과 설교 자료"/></h3><p>평소 발행 순서와 별개로, 필요한 자료만 자세히 살펴봅니다.</p></div>
      <AdminTool id="cleanup" tag="보관 현황 조회" title="초안 보관 현황" description="초안 본문의 자동 정리 예정일을 확인합니다."><DraftCleanup /></AdminTool>
      <AdminTool id="sermon" tag="상세 편집" title="설교 자료 편집" description="저장된 자막과 수정본을 비교하고 편집합니다."><AdminSermonInput /></AdminTool>
      <AdminTool id="bible" tag="저장하지 않는 확인 도구" title="성경 장절 확인" description="장절 표기와 대한성서공회 읽기 링크를 확인합니다."><BibleReferenceTool /></AdminTool>
    </div>
  </div>;
}
