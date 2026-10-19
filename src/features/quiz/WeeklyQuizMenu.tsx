import { useEffect, useState } from "react";
import { QuizChoiceDialog } from "../../components/QuizChoiceDialog";
import { Button } from "../../components/Button";
import { loadWeeklyChoice } from "./weekly-choice";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; quiz: Awaited<ReturnType<typeof loadWeeklyChoice>> };
export function WeeklyQuizMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadWeeklyChoice(controller.signal).then(quiz => {
      if (!controller.signal.aborted) setState({ kind: "ready", quiz });
    }).catch(() => { if (!controller.signal.aborted) setState({ kind: "error" }); });
    return () => controller.abort();
  }, [open, attempt]);
  const quiz = state.kind === "ready" ? state.quiz : null;
  return <>
    <button type="button" className="weekly-quiz-trigger" aria-current={active ? "page" : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setState({ kind: "loading" }); setOpen(true); }}>이번 주 퀴즈</button>
    <QuizChoiceDialog open={open} title="이번 주 퀴즈 선택" description={quiz?.title ?? (state.kind === "loading" ? "퀴즈를 확인하고 있습니다." : state.kind === "ready" ? "아직 공개된 퀴즈가 없습니다." : "퀴즈를 불러오지 못했습니다.")} choices={quiz?.difficulties.map(difficulty => ({ difficulty, to: `/quiz/${quiz.slug}?level=${difficulty}` })) ?? []} onClose={() => setOpen(false)}>
      {state.kind === "error" && <div role="alert"><Button onClick={() => { setState({ kind: "loading" }); setAttempt(value => value + 1); }}>다시 시도</Button></div>}
    </QuizChoiceDialog>
  </>;
}
