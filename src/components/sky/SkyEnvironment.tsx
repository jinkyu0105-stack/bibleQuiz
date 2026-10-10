import { useEffect, useState, type ReactNode } from "react";
import { SkyScene, type SkyView } from "./SkyScene";
import { readSkyChoice, saveSkyPreference, type SkyChoice } from "./preferences";
import { ThemeControl } from "../../features/quiz/ThemeControl";

export function SkyEnvironment({ view, children }: { view: SkyView; children: ReactNode }) {
  const [choice, setChoice] = useState(readSkyChoice);
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const time = choice === "system" ? dark ? "night" : "day" : choice;
  function choose(value: SkyChoice) { setChoice(value); setStorageFailed(!saveSkyPreference("sky", value)); }
  return <><SkyScene time={time} view={view} />{children}<ThemeControl time={time} choice={choice} onChange={choose} storageFailed={storageFailed} /></>;
}
