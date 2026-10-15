import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { useGlass } from "../../components/glass/useGlass";
import { readSkyFlag, saveSkyPreference } from "../../components/sky/preferences";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";
import { HomeEffectsControl } from "../../components/sky/HomeEffectsControl";
import { PageDock } from "../../components/glass/PageDock";
import "../../components/sky/mobile-settings.css";

export function ThemeControl({ home, time, onChange, grass, onGrassChange, storageFailed }: {
  home: boolean; time: SkyTime; onChange: (choice: SkyTime) => void; grass: boolean; onGrassChange: () => void; storageFailed: boolean;
}) {
  const [clarity, setClarity] = useState(() => readSkyFlag("clarity"));
  const [systemClarity, setSystemClarity] = useState(() => window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
  const [clarityStorageFailed, setClarityStorageFailed] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [popupOpen, setPopupOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const popupTrigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const mobilePopup = home && compact;
  const available = !mobilePopup || popupOpen;
  const clarityLabel = systemClarity ? "시스템 투명도 감소 적용 중" : clarity ? "유리 투명도 복원" : "투명도 줄이기";
  const motionRef = useGlass<HTMLButtonElement>();
  const clarityRef = useGlass<HTMLButtonElement>();
  const grassRef = useGlass<HTMLButtonElement>();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    let focusWithin = false;
    let focusFrame = 0;
    const rememberFocus = (event: Event) => {
      const target = event.target;
      focusWithin = target instanceof Element && !!(rail.current?.contains(target) || popupTrigger.current?.contains(target) || target.closest(".hero-light-panel"));
    };
    const sync = () => {
      // CSS can hide the focused control before the media change event fires.
      const hadFocus = focusWithin;
      setCompact(media.matches); setPopupOpen(false);
      cancelAnimationFrame(focusFrame);
      if (hadFocus) focusFrame = requestAnimationFrame(() => {
        if (media.matches) popupTrigger.current?.focus({ preventScroll: true });
        else rail.current?.querySelector<HTMLButtonElement>(".time-options button[aria-pressed=true]")?.focus({ preventScroll: true });
      });
    };
    const closeForHistory = () => setPopupOpen(false);
    media.addEventListener("change", sync);
    window.addEventListener("popstate", closeForHistory);
    document.addEventListener("focusin", rememberFocus);
    document.addEventListener("pointerdown", rememberFocus);
    return () => {
      cancelAnimationFrame(focusFrame); media.removeEventListener("change", sync); window.removeEventListener("popstate", closeForHistory);
      document.removeEventListener("focusin", rememberFocus); document.removeEventListener("pointerdown", rememberFocus);
    };
  }, []);
  useLayoutEffect(() => {
    if (mobilePopup && popupOpen) rail.current?.querySelector<HTMLButtonElement>(".time-options button[aria-pressed=true]")?.focus({ preventScroll: true });
  }, [mobilePopup, popupOpen]);
  useEffect(() => {
    if (!mobilePopup || !popupOpen) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || rail.current?.contains(target) || popupTrigger.current?.contains(target) || target.closest(".hero-light-panel")) return;
      setPopupOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [mobilePopup, popupOpen]);
  function closePopup() { setPopupOpen(false); popupTrigger.current?.focus({ preventScroll: true }); }
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const sync = () => setSystemClarity(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => { document.body.dataset.transparency = clarity || systemClarity ? "reduced" : "normal"; }, [clarity, systemClarity]);
  return <><aside ref={rail} id={id} className="time-rail" data-popup-open={popupOpen}
    role={mobilePopup ? "dialog" : undefined} aria-label={mobilePopup ? "화면 설정" : "배경 설정"}
    inert={!available} onKeyDown={event => {
      if (mobilePopup && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePopup(); }
    }}>
    <div className="mobile-settings-heading"><strong>화면 설정</strong><button type="button" aria-label="화면 설정 닫기" onClick={closePopup}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button></div>
    <GlassMenu className="time-options" role="group" aria-label="하늘 시간대">
      {([["dawn", "새벽", "☀"], ["day", "낮", "☼"], ["dusk", "노을", "◒"], ["night", "밤", "☾"]] as const).map(([value, label, icon]) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={time === value} onClick={() => onChange(value)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}
    </GlassMenu>
    <div className="sky-controls">
      <button ref={motionRef} id="motion" className="glass glass-clear" data-glint type="button" aria-label="배경 움직임 멈춤" aria-pressed="false"><span aria-hidden="true">Ⅱ</span></button>
      {home && <HomeEffectsControl night={time === "night"} available={available} />}
      <button ref={clarityRef} id="glass-clarity" data-glint className="glass glass-clear" type="button" aria-label={clarityLabel} title={compact ? clarityLabel : undefined} aria-pressed={clarity || systemClarity} disabled={systemClarity} onClick={() => { setClarity(!clarity); setClarityStorageFailed(!saveSkyPreference("clarity", String(!clarity))); }}>
        <svg className="clarity-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" /></svg>
        <span className="clarity-label" aria-hidden="true">가</span><small className="clarity-label">선명하게</small>
      </button>
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
  </aside>{home && <PageDock mobile={mobilePopup} settings={<button ref={popupTrigger} className="mobile-settings-trigger" type="button" aria-label="화면 설정"
    aria-expanded={mobilePopup && popupOpen} aria-controls={id} aria-haspopup="dialog"
    onClick={() => popupOpen ? closePopup() : setPopupOpen(true)} onKeyDown={event => { if (event.key === "Escape") closePopup(); }}>
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h4m4 0h8M4 17h8m4 0h4" /><circle cx="10" cy="7" r="2" /><circle cx="14" cy="17" r="2" />
    </svg>
  </button>} />}</>;
}
