import { useEffect, useState } from "react";
import { browserStorage } from "../../lib/browser-storage";

type Theme = "system" | "light" | "dark";

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = browserStorage()?.getItem("bibleQuiz:theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch { return "system"; }
  });
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <div className="theme-control">
      <label htmlFor="theme-choice">화면 테마</label>
      <select id="theme-choice" value={theme} onChange={(event) => {
        const value = event.target.value as Theme;
        setTheme(value);
        try {
          const storage = browserStorage();
          if (!storage) throw new Error("Storage unavailable");
          storage.setItem("bibleQuiz:theme", value);
          setStorageFailed(false);
        } catch { setStorageFailed(true); }
      }}>
        <option value="system">기기 설정</option>
        <option value="light">라이트</option>
        <option value="dark">다크</option>
      </select>
      {storageFailed && <span className="quiet-message">테마는 이 화면에서만 유지됩니다.</span>}
    </div>
  );
}
