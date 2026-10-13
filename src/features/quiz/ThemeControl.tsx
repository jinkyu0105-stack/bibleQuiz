import { useEffect, useState } from "react";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { useGlass } from "../../components/glass/useGlass";
import { readSkyFlag, saveSkyPreference } from "../../components/sky/preferences";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";

export function ThemeControl({ time, onChange, grass, onGrassChange, storageFailed }: {
  time: SkyTime; onChange: (choice: SkyTime) => void; grass: boolean; onGrassChange: () => void; storageFailed: boolean;
}) {
  const [clarity, setClarity] = useState(() => readSkyFlag("clarity"));
  const [systemClarity, setSystemClarity] = useState(() => window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
  const [clarityStorageFailed, setClarityStorageFailed] = useState(false);
  const motionRef = useGlass<HTMLButtonElement>();
  const clarityRef = useGlass<HTMLButtonElement>();
  const grassRef = useGlass<HTMLButtonElement>();
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
      <button ref={clarityRef} id="glass-clarity" data-glint className="glass glass-clear" type="button" aria-label={systemClarity ? "시스템 투명도 감소 적용 중" : clarity ? "유리 투명도 복원" : "투명도 줄이기"} aria-pressed={clarity || systemClarity} disabled={systemClarity} onClick={() => { setClarity(!clarity); setClarityStorageFailed(!saveSkyPreference("clarity", String(!clarity))); }}><span aria-hidden="true">가</span><small>선명하게</small></button>
      <button ref={grassRef} id="grass-toggle" data-glint className="glass glass-clear" type="button" aria-label={grass ? "잔디 끄기" : "잔디 켜기"} title={grass ? "잔디 끄기" : "잔디 켜기"} aria-pressed={grass} onClick={onGrassChange}>
        <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true" fill="currentColor">
          <path className="grass-blades" d="M5 22C5 17 3.5 13 2 11c4 1 6.5 4 8 8C9 12 9.5 7 12 3c0 7 1 11 2 15 1-5 4-9 8-11-2.5 4-3.5 8-3.5 12 1.5-3 3.5-5 6.5-6-2 3-3 6-3 9Z"/>
          <g className="grass-state" data-on={grass}>
            <circle cx="22" cy="22" r="5"/>
            <path d={grass ? "m19.8 22 1.5 1.5 2.8-3" : "M20 22h4"}/>
          </g>
        </svg>
      </button>
    </div>
    {(storageFailed || clarityStorageFailed) && <p className="quiet-message" role="status">설정은 이 화면에서만 유지됩니다.</p>}
  </aside>;
}
