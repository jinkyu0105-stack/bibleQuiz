import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { difficultyLabel, type TopNExport } from "../../../shared/api/quiz-export";
import type { Difficulty } from "../../../shared/api/public-quiz";
import { readTopN } from "./client";
import { download, pngZip } from "./files";
import type { Scene } from "./scene";
import "./export.css";

interface Prepared { pdf: Uint8Array; scenes: Scene[]; models: TopNExport[]; url: string }
export function Component() {
  const { slug = "" } = useParams(), [params] = useSearchParams();
  const initial: Difficulty = params.get("level") === "adult" ? "adult" : "child";
  const [choice, setChoice] = useState<Difficulty | "both">(initial);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [message, setMessage] = useState("출력 파일을 준비하고 있어요.");
  const [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const urlRef = useRef<string | null>(null), request = useRef<AbortController | null>(null);
  const generate = useCallback(async (selected: Difficulty | "both") => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(false); setPrepared(null); setMessage("출력 파일을 준비하고 있어요.");
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    try {
      // Fetch every selected level before generating any file: both requires both permissions.
      const models = await Promise.all((selected === "both" ? ["child", "adult"] as const : [selected]).map(level => readTopN(slug, level, controller.signal)));
      const { createPoster } = await import("./render"); const result = await createPoster(models);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([result.pdf], { type: "application/pdf" })); urlRef.current = url;
      setPrepared({ ...result, models, url });
      if (navigator.pdfViewerEnabled === false) {
        download(result.pdf, "application/pdf", `${slug}-${selected === "both" ? "두난도" : difficultyLabel(selected)}-TopN.pdf`);
        setMessage("이 브라우저는 PDF 미리보기를 지원하지 않아 파일을 내려받았습니다. 파일을 열어 인쇄하세요.");
      } else setMessage("PDF를 준비했습니다. PDF 뷰어의 프린터 아이콘으로 인쇄하세요.");
    } catch (reason) {
      if (!controller.signal.aborted) { setError(true); setMessage(reason instanceof Error ? reason.message : "출력 파일을 준비하지 못했습니다."); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, [slug]);
  useEffect(() => {
    const timer = setTimeout(() => void generate(initial), 0);
    return () => { clearTimeout(timer); request.current?.abort(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [generate, initial]);
  const filename = `${slug}-${choice === "both" ? "두난도" : difficultyLabel(choice)}-TopN`;
  async function pngs(zip: boolean) {
    if (!prepared) return;
    setBusy(true); setMessage("300dpi PNG를 준비하고 있어요.");
    try {
      const { posterPng } = await import("./render");
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const [index, scene] of prepared.scenes.entries()) {
        const file = { name: `${filename}-${index + 1}쪽.png`, bytes: await posterPng(scene) };
        if (zip) files.push(file); else download(file.bytes, "image/png", file.name);
        // Let the screen update between pages and release each raster before the next.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (zip) download(pngZip(files), "application/zip", `${filename}.zip`);
      setMessage(`${prepared.scenes.length}쪽의 PNG를 준비했습니다.`);
    } catch { setMessage("PNG를 준비하지 못했습니다. PDF 파일 받기를 사용하거나 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <main className="print-route" id="main-content">
    <div className="print-controls">
      <h1>Top N 출력</h1><p role={error ? "alert" : "status"}>{message}</p>
      <label>출력 난이도 <select value={choice} disabled={busy} onChange={event => { const value = event.target.value as Difficulty | "both"; setChoice(value); void generate(value); }}>
        <option value="child">어린이용</option><option value="adult">장년용</option><option value="both">둘 다</option>
      </select></label>
      {error && <button disabled={busy} onClick={() => void generate(choice)}>출력 다시 시도</button>}
      {prepared && <div className="export-actions">
        <button disabled={busy} onClick={() => download(prepared.pdf, "application/pdf", `${filename}.pdf`)}>PDF 파일 받기</button>
        <button disabled={busy} onClick={() => void pngs(false)}>페이지별 PNG 받기</button>
        <button disabled={busy} onClick={() => void pngs(true)}>PNG ZIP 받기</button>
      </div>}
      <p>생성할 때의 정답자 현황입니다. 최신 상태가 필요하면 <button disabled={busy} onClick={() => void generate(choice)}>최신 자료로 다시 만들기</button></p>
      <Link to={`/quiz/${slug}?level=${initial}`}>퀴즈로 돌아가기</Link>
    </div>
    {prepared && navigator.pdfViewerEnabled !== false && <iframe className="pdf-preview" title="A4 정답자·Top N PDF 미리보기" src={prepared.url} onError={() => {
      download(prepared.pdf, "application/pdf", `${filename}.pdf`); setMessage("PDF 파일을 내려받았습니다. 파일을 열어 인쇄하세요.");
    }} />}
  </main>;
}
