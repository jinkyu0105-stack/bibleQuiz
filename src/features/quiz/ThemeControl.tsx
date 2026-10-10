import { useEffect, useState } from "react";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { useGlass } from "../../components/glass/useGlass";
import { readSkyFlag, saveSkyPreference, type SkyChoice } from "../../components/sky/preferences";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";

export function ThemeControl({ time, choice, onChange, storageFailed }: {
  time: SkyTime; choice: SkyChoice; onChange: (choice: SkyChoice) => void; storageFailed: boolean;
}) {
  const [clarity, setClarity] = useState(() => readSkyFlag("clarity"));
  const [systemClarity, setSystemClarity] = useState(() => window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
  const [clarityStorageFailed, setClarityStorageFailed] = useState(false);
  const motionRef = useGlass<HTMLButtonElement>();
  const clarityRef = useGlass<HTMLButtonElement>();
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const sync = () => setSystemClarity(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => { document.body.dataset.transparency = clarity || systemClarity ? "reduced" : "normal"; }, [clarity, systemClarity]);
  return <aside className="time-rail" aria-label="배경 설정">
    <GlassMenu className="time-options" role="group" aria-label="하늘 시간대">
      {([["dawn", "새벽", "☀"], ["day", "낮", "☼"], ["dusk", "노을", "◒"], ["night", "밤", "☾"]] as const).map(([value, label, icon]) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={time === value} onClick={() => onChange(value)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}
    </GlassMenu>
    <div className="sky-controls">
      <button ref={motionRef} id="motion" className="glass glass-clear" data-glint type="button" aria-label="배경 움직임 멈춤" aria-pressed="false"><span aria-hidden="true">Ⅱ</span></button>
      <button ref={clarityRef} id="glass-clarity" className="glass glass-clear" type="button" aria-label={systemClarity ? "시스템 투명도 감소 적용 중" : clarity ? "유리 투명도 복원" : "투명도 줄이기"} aria-pressed={clarity || systemClarity} disabled={systemClarity} onClick={() => { setClarity(!clarity); setClarityStorageFailed(!saveSkyPreference("clarity", String(!clarity))); }}><span aria-hidden="true">가</span><small>선명하게</small></button>
    </div>
    <label className="theme-control" htmlFor="theme-choice"><span>화면 테마</span><select id="theme-choice" value={choice === "day" ? "light" : choice === "night" ? "dark" : choice} onChange={event => onChange(event.target.value === "light" ? "day" : event.target.value === "dark" ? "night" : event.target.value as SkyChoice)}>
      <option value="system">기기 설정</option><option value="dawn">새벽</option><option value="light">낮</option><option value="dusk">노을</option><option value="dark">밤</option>
    </select></label>
    {(storageFailed || clarityStorageFailed) && <p className="quiet-message" role="status">테마는 이 화면에서만 유지됩니다.</p>}
  </aside>;
}
