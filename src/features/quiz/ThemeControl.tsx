import { useEffect, useState } from "react";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { useGlass } from "../../components/glass/useGlass";
import { readSkyFlag, saveSkyPreference } from "../../components/sky/preferences";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";
import { HomeEffectsControl } from "../../components/sky/HomeEffectsControl";

export function ThemeControl({ home, time, onChange, grass, onGrassChange, storageFailed }: {
  home: boolean; time: SkyTime; onChange: (choice: SkyTime) => void; grass: boolean; onGrassChange: () => void; storageFailed: boolean;
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
      {home && <HomeEffectsControl />}
      <button ref={clarityRef} id="glass-clarity" data-glint className="glass glass-clear" type="button" aria-label={systemClarity ? "시스템 투명도 감소 적용 중" : clarity ? "유리 투명도 복원" : "투명도 줄이기"} aria-pressed={clarity || systemClarity} disabled={systemClarity} onClick={() => { setClarity(!clarity); setClarityStorageFailed(!saveSkyPreference("clarity", String(!clarity))); }}><span aria-hidden="true">가</span><small>선명하게</small></button>
      <button ref={grassRef} id="grass-toggle" data-glint className="glass glass-clear" type="button" aria-label={grass ? "잔디 끄기" : "잔디 켜기"} title={grass ? "잔디 끄기" : "잔디 켜기"} aria-pressed={grass} onClick={onGrassChange}>
        <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true" fill="none">
          <path className="grass-blades" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" d="M4 22H24 M8 22V11 M14 22V5 M20 22V13"/>
          {!grass && <g className="grass-state" data-on={false} transform="translate(2 2) scale(.9)">
            <circle cx="22" cy="22" r="5"/>
            <path d="M20 22h4"/>
          </g>}
        </svg>
      </button>
    </div>
    {(storageFailed || clarityStorageFailed) && <p className="quiet-message" role="status">설정은 이 화면에서만 유지됩니다.</p>}
  </aside>;
}
