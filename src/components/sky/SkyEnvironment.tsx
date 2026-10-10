import { useEffect, useState, type ReactNode } from "react";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";
import { SkyScene, type SkyView } from "./SkyScene";
import { readSkyChoice, readSkyFlag, saveSkyChoice, saveSkyPreference } from "./preferences";
import { seoulSkyTime } from "./solar-time";
import { ThemeControl } from "../../features/quiz/ThemeControl";

export function SkyEnvironment({ view, children }: { view: SkyView; children: ReactNode }) {
  const [choice, setChoice] = useState(readSkyChoice);
  const [automaticTime, setAutomaticTime] = useState(seoulSkyTime);
  const [grass, setGrass] = useState(() => !readSkyFlag("grass-hidden"));
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    if (choice) return;
    const sync = () => { if (!document.hidden) setAutomaticTime(seoulSkyTime()); };
    const timer = window.setInterval(sync, 60_000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    sync();
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", sync); window.removeEventListener("focus", sync); };
  }, [choice]);
  function choose(value: SkyTime) { setChoice(value); setStorageFailed(!saveSkyChoice(value)); }
  function toggleGrass() { setGrass(!grass); setStorageFailed(!saveSkyPreference("grass-hidden", String(grass))); }
  const time = choice ?? automaticTime;
  return <><SkyScene time={time} view={view} grass={grass} />{children}
    <ThemeControl time={time} onChange={choose} grass={grass} onGrassChange={toggleGrass} storageFailed={storageFailed} /></>;
}
