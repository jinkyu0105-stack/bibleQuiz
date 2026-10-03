import { useRef, useState } from "react";
import { clueText, difficultyLabel, type BlankExport } from "../../../shared/api/quiz-export";
import type { Difficulty } from "../../../shared/api/public-quiz";
import { readBlank } from "./client";
import { blankGridSvg } from "./scene";
import { download } from "./files";
import "./export.css";

export function BlankExportPanel({ slug, difficulty, available = ["child", "adult"] }: {
  slug: string; difficulty: Difficulty; available?: readonly Difficulty[];
}) {
  const [choice, setChoice] = useState<Difficulty | "both">(difficulty);
  const [models, setModels] = useState<BlankExport[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  const [transparent, setTransparent] = useState(false);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const selectCopy = (node: HTMLTextAreaElement | null) => { copyField.current = node; if (node) { node.focus(); node.select(); } };
  async function run(action: "png" | "svg" | "copy" | "preview") {
    setBusy(true); setMessage("출력 자료를 준비하고 있어요."); setFallback(null);
    try {
      const levels = choice === "both" ? available : [choice];
      const data = await Promise.all(levels.map(level => readBlank(slug, level)));
      setModels(data);
      if (action === "copy") {
        const value = data.map(model => `${data.length > 1 ? `[${difficultyLabel(model.difficulty)}]\n` : ""}${clueText(model)}`).join("\n\n");
        try { await navigator.clipboard.writeText(value); setMessage("문제 텍스트를 복사했습니다."); }
        catch { setFallback(value); setMessage("텍스트를 선택했습니다. Ctrl/Cmd+C로 복사해 주세요."); }
      } else if (action === "preview") setMessage("빈 격자와 가로·세로 단서를 확인할 수 있습니다.");
      else {
        for (const model of data) {
          const svg = blankGridSvg(model.grid, action === "svg" && transparent);
          const name = `${model.slug}-${difficultyLabel(model.difficulty)}-빈격자`;
          if (action === "svg") download(new TextEncoder().encode(svg), "image/svg+xml", `${name}.svg`);
          else {
            const { svgPng } = await import("./render");
            download(await svgPng(svg, 1600), "image/png", `${name}.png`);
          }
        }
        setMessage(`${data.length}개의 빈 격자 파일을 준비했습니다.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "출력 자료를 준비하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="export-panel" aria-label="주보 편집 자료">
    <div className="export-heading"><h3>주보 편집 자료</h3><p>빈 격자 그림과 편집할 수 있는 문제 텍스트를 받으세요.</p></div>
    <label>출력 난이도 <select value={choice} disabled={busy} onChange={event => { setChoice(event.target.value as Difficulty | "both"); setModels([]); setFallback(null); }}>
      {available.map(level => <option key={level} value={level}>{difficultyLabel(level)}</option>)}
      {available.length > 1 && <option value="both">둘 다</option>}
    </select></label>
    <div className="export-actions">
      <button className="primary-button" disabled={busy} onClick={() => void run("png")}>빈 격자 받기</button>
      <button disabled={busy} onClick={() => void run("copy")}>문제 텍스트 복사</button>
      <button disabled={busy} onClick={() => void run("preview")}>자료 미리보기</button>
    </div>
    <details><summary>고급 설정</summary><label><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.target.checked)} />SVG 배경 투명</label>
      <button disabled={busy} onClick={() => void run("svg")}>SVG 받기</button></details>
    <p role="status">{message}</p>
    {fallback !== null && <label>복사할 문제 텍스트<textarea ref={selectCopy} readOnly value={fallback} rows={10} onFocus={event => event.target.select()} /></label>}
    <div className="blank-previews">{models.map(model => <article key={model.difficulty}>
      <h4>{difficultyLabel(model.difficulty)}</h4>
      <img width="1600" height="1600" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(blankGridSvg(model.grid))}`} alt={`${difficultyLabel(model.difficulty)} 번호 표시 빈 격자`} />
      <pre>{clueText(model)}</pre>
    </article>)}</div>
  </section>;
}
