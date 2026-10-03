import type { Difficulty } from "../../../shared/api/public-quiz";

export function DifficultyTabs({ difficulty, available = ["child", "adult"], onChange }: {
  difficulty: Difficulty; available?: readonly Difficulty[]; onChange: (difficulty: Difficulty) => void;
}) {
  const levels = (["child", "adult"] as const).filter((level) => available.includes(level));
  return <div className="difficulty-tabs" role="tablist" aria-label="퀴즈 난이도">
    {levels.map((level, index) => <button type="button" role="tab" id={`tab-${level}`} key={level}
      aria-selected={level === difficulty} aria-controls="quiz-panel" tabIndex={level === difficulty ? 0 : -1}
      data-composition-cancel onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => { event.currentTarget.focus(); onChange(level); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? levels[0] : event.key === "End" ? levels.at(-1) : levels[(index + (event.key === "ArrowLeft" ? -1 : 1) + levels.length) % levels.length];
        if (!next) return;
        onChange(next);
        document.getElementById(`tab-${next}`)?.focus();
      }}>{level === "child" ? "어린이용" : "장년용"}</button>)}
  </div>;
}
