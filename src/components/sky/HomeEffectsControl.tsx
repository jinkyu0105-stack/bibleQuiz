import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassMenu } from "../glass/GlassMenu";
import { readSkyFlag, saveSkyPreference } from "./preferences";
import { defaultVeilSettings, readVeilSettings, type VeilSettings } from "./veil-settings";
import { defaultMercurySettings, readMercurySettings, type MercurySettings } from "./mercury-settings";
import { EffectControls } from "./EffectControls";
import "./home-effects-control.css";

function EffectIcon({ kind }: { kind: "effects" | "mercury" | "veil" }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "effects" ? <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" /><path d="M20 3v4M18 5h4" /></>
      : kind === "mercury" ? <><path d="M3 7c3-5 6 5 9 0s6 5 9 0M3 12c3-5 6 5 9 0s6 5 9 0M3 17c3-5 6 5 9 0s6 5 9 0" /></>
      : <><path d="M12 3 3 20M12 3 8 21M12 3v18M12 3l4 18M12 3l9 17" /><path d="M10 3h4" /></>}
  </svg>;
}

/** The surface grows in place; independent toggles keep their own checked state. */
export function HomeEffectsControl({ night = false }: { night?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tuning, setTuning] = useState<"mercury" | "veil" | null>(null);
  const [mercury, setMercury] = useState(() => !readSkyFlag("mercury-hidden"));
  const [veil, setVeil] = useState(() => readSkyFlag("veil-rays"));
  const [storageFailed, setStorageFailed] = useState(false);
  const [settings, setSettings] = useState(readVeilSettings);
  const [reflectionSettings, setReflectionSettings] = useState(readMercurySettings);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const raysTrigger = useRef<HTMLButtonElement>(null);
  const reflectionTrigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboardOpen = useRef(false);
  const id = useId();

  useLayoutEffect(() => {
    document.body.dataset.heroMercury = mercury ? "on" : "off";
    document.body.dataset.heroVeil = veil ? "on" : "off";
  }, [mercury, veil]);
  useLayoutEffect(() => {
    document.body.dataset.veilWidth = String(settings.width);
    document.body.dataset.veilStrength = String(settings.strength);
    document.body.dataset.veilSpread = String(settings.spread);
  }, [settings]);
  useLayoutEffect(() => {
    document.body.dataset.mercuryStrength = String(reflectionSettings.strength);
    document.body.dataset.mercuryScale = String(reflectionSettings.scale);
    document.body.dataset.mercurySpeed = String(reflectionSettings.speed);
  }, [reflectionSettings]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !document.getElementById(`${id}-panel`)?.contains(event.target)) {
        clearTimeout(closeTimer.current);
        keyboardOpen.current = false;
        setTuning(null);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, id]);

  function close(restoreFocus = false) {
    clearTimeout(closeTimer.current);
    keyboardOpen.current = false;
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    setTuning(null);
    setOpen(false);
  }
  function closeTuning() {
    (tuning === "mercury" ? reflectionTrigger : raysTrigger).current?.focus({ preventScroll: true });
    setTuning(null);
  }
  function adjust(next: VeilSettings) {
    setSettings(next);
    setStorageFailed(!saveSkyPreference("veil-settings", JSON.stringify(next)));
  }
  function adjustReflection(next: MercurySettings) {
    setReflectionSettings(next);
    setStorageFailed(!saveSkyPreference("mercury-settings", JSON.stringify(next)));
  }
  function toggle(kind: "mercury" | "veil") {
    // Reopen a dismissed controller without turning its effect off. A second
    // click on the same open controller turns off only that effect.
    const next = !((kind === "mercury" ? mercury : veil) && tuning === kind);
    clearTimeout(closeTimer.current);
    setTuning(next ? kind : null);
    if (kind === "mercury") {
      setMercury(next);
      setStorageFailed(!saveSkyPreference("mercury-hidden", String(!next)));
    } else {
      setVeil(next);
      setStorageFailed(!saveSkyPreference("veil-rays", String(next)));
    }
  }
  function revealForPointer(event: { pointerType: string }) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    if (!open) { keyboardOpen.current = false; setOpen(true); }
  }

  return <div ref={root} className="hero-effect-control" data-open={open}
    onPointerEnter={revealForPointer}
    // Firefox can restore a pointer inside a newly mounted element without an enter event.
    onPointerMove={revealForPointer}
    onPointerDown={() => { keyboardOpen.current = false; }}
    onPointerLeave={event => {
      if (event.pointerType !== "mouse" || tuning) return;
      closeTimer.current = setTimeout(() => {
        if (keyboardOpen.current && root.current?.contains(document.activeElement)) return;
        close(!!root.current?.contains(document.activeElement));
      }, 180);
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !document.getElementById(`${id}-panel`)?.contains(event.relatedTarget)) close(); }}
    onKeyDown={event => {
      clearTimeout(closeTimer.current);
      keyboardOpen.current = true;
      if (event.key === "Escape" && open) { event.stopPropagation(); event.preventDefault(); if (tuning) closeTuning(); else close(true); }
      if (event.key === "ArrowDown" && event.target === trigger.current) { event.preventDefault(); setOpen(true); }
    }}>
    <GlassMenu className="hero-effect-surface" role="group" aria-label="메인 배경 효과">
      <button ref={trigger} type="button" className="hero-effect-trigger" aria-label="배경 효과" aria-expanded={open}
        aria-controls={`${id}-mercury ${id}-veil`}
        onClick={() => { clearTimeout(closeTimer.current); if (open) close(); else setOpen(true); }}>
        <EffectIcon kind="effects" />
      </button>
        {([['mercury', '물결 반사 (Mercury)', '반사', mercury], ['veil', '빛줄기 (Veil Rays)', '빛줄기', veil]] as const).map(([kind, label, short, enabled]) =>
          <button key={kind} id={`${id}-${kind}`} ref={kind === "veil" ? raysTrigger : reflectionTrigger} className="hero-effect-option" type="button" aria-label={label} aria-pressed={enabled}
            aria-expanded={tuning === kind} aria-controls={`${id}-panel`}
            aria-hidden={!open} inert={!open} onClick={() => toggle(kind)}>
            <EffectIcon kind={kind} /><small>{short}</small>
            {enabled && <svg className="effect-check" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m2 6 2.5 2.5L10 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>)}
    </GlassMenu>
    {tuning === "veil" && createPortal(<EffectControls key="veil" id={`${id}-panel`} anchor={raysTrigger} label="빛줄기 조절"
      title={night ? "달빛 조절" : "빛줄기 조절"} description={night ? "달 쪽에서 부드럽게 번지는 은빛" : "넓은 광원에서 내려오는 부드러운 빛"}
      settings={settings} defaults={defaultVeilSettings} fields={[
        { key: "width", label: "광원 너비", min: 0, max: 100 }, { key: "strength", label: "밝기", min: 10, max: 100 }, { key: "spread", label: "퍼짐", min: 0, max: 100 },
      ]} onChange={adjust} onClose={closeTuning} />, document.body)}
    {tuning === "mercury" && createPortal(<EffectControls key="mercury" id={`${id}-panel`} anchor={reflectionTrigger} label="반사 조절"
      description="하늘 위로 천천히 흐르는 물결 반사" settings={reflectionSettings} defaults={defaultMercurySettings} fields={[
        { key: "strength", label: "밝기", min: 10, max: 100 }, { key: "scale", label: "물결 크기", min: 0, max: 100 }, { key: "speed", label: "흐름 속도", min: 0, max: 100 },
      ]} onChange={adjustReflection} onClose={closeTuning} />, document.body)}
    {storageFailed && <span className="effect-storage-status" role="status">효과 설정은 이 화면에서만 유지됩니다.</span>}
  </div>;
}
