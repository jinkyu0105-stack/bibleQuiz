import { useState } from "react";
import type { ParticipationBoardTarget } from "../quiz/participation-board-client";
import { readTopN } from "./client";
import { download } from "./files";
export function TopNPrintButton({ target }: { target: ParticipationBoardTarget }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function open() {
    const url = `/quiz/${encodeURIComponent(target.slug)}/print?level=${target.difficulty}`;
    const tab = window.open(url, "_blank");
    if (tab) { tab.opener = null; return; }
    setBusy(true); setMessage("새 탭을 열지 못해 PDF 파일을 준비하고 있어요.");
    try {
      const model = await readTopN(target.slug, target.difficulty);
      const { createPoster } = await import("./render");
      const { pdf } = await createPoster([model]);
      download(pdf, "application/pdf", `${target.slug}-${target.difficulty}-TopN.pdf`);
      setMessage("PDF 파일을 내려받았습니다. 파일을 열어 인쇄하세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PDF를 준비하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={() => void open()}>Top N 출력</button><p role="status">{message}</p></div>;
}
