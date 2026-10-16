import { useState } from "react";
import { AdminIcon } from "../../components/AdminIcon";
import { Tooltip } from "../../components/Tooltip";
import type { Difficulty } from "../../../shared/api/public-quiz";

export function QuizShare({ slug, difficulty, title }: { slug: string; difficulty: Difficulty; title: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  async function share() {
    if (busy) return;
    const url = new URL(`/quiz/${slug}?level=${difficulty}`, window.location.origin).href;
    setBusy(true); setMessage(""); setManualUrl("");
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: `${title} · ${difficulty === "child" ? "어린이용" : "장년용"}`, url });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setMessage("퀴즈 주소를 복사했습니다.");
      } catch {
        setManualUrl(url);
        setMessage("주소를 선택해 직접 복사해 주세요.");
      }
    } finally { setBusy(false); }
  }
  return <>
    <Tooltip label="퀴즈 공유">{id => <button type="button" className="quiz-icon-button" aria-label="퀴즈 공유" aria-describedby={id} disabled={busy} onClick={() => void share()}><AdminIcon name="share"/></button>}</Tooltip>
    {message && <p className="quiz-share-status" role="status">{message}</p>}
    {manualUrl && <label className="quiz-share-fallback">공유할 퀴즈 주소<input readOnly value={manualUrl} onFocus={event => event.target.select()} /></label>}
  </>;
}
