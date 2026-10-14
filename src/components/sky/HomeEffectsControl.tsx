import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useGlass } from "../glass/useGlass";
import { readSkyFlag, saveSkyPreference } from "./preferences";
import "./home-effects-control.css";

function EffectIcon({ kind }: { kind: "effects" | "mercury" | "veil" }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "effects" ? <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" /><path d="M20 3v4M18 5h4" /></>
      : kind === "mercury" ? <><path d="M3 7c3-5 6 5 9 0s6 5 9 0M3 12c3-5 6 5 9 0s6 5 9 0M3 17c3-5 6 5 9 0s6 5 9 0" /></>
      : <><path d="M12 3 3 20M12 3 8 21M12 3v18M12 3l4 18M12 3l9 17" /><path d="M10 3h4" /></>}
  </svg>;
}

/** The surface grows in place; independent toggles keep their own checked state. */
export function HomeEffectsControl() {
  const [open, setOpen] = useState(false);
  const [mercury, setMercury] = useState(() => !readSkyFlag("mercury-hidden"));
  const [veil, setVeil] = useState(() => readSkyFlag("veil-rays"));
  const [storageFailed, setStorageFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useGlass<HTMLDivElement>();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboardOpen = useRef(false);
  const id = useId();

  useLayoutEffect(() => {
    document.body.dataset.heroMercury = mercury ? "on" : "off";
    document.body.dataset.heroVeil = veil ? "on" : "off";
  }, [mercury, veil]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        clearTimeout(closeTimer.current);
        keyboardOpen.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close(restoreFocus = false) {
    clearTimeout(closeTimer.current);
    keyboardOpen.current = false;
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }
  function toggle(kind: "mercury" | "veil") {
    if (kind === "mercury") {
      setMercury(!mercury);
      setStorageFailed(!saveSkyPreference("mercury-hidden", String(mercury)));
    } else {
      setVeil(!veil);
      setStorageFailed(!saveSkyPreference("veil-rays", String(!veil)));
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
      if (event.pointerType !== "mouse") return;
      closeTimer.current = setTimeout(() => {
        if (keyboardOpen.current && root.current?.contains(document.activeElement)) return;
        close(!!root.current?.contains(document.activeElement));
      }, 100);
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
    onKeyDown={event => {
      clearTimeout(closeTimer.current);
      keyboardOpen.current = true;
      if (event.key === "Escape" && open) { event.stopPropagation(); event.preventDefault(); close(true); }
      if (event.key === "ArrowDown" && event.target === trigger.current) { event.preventDefault(); setOpen(true); }
    }}>
    <div ref={panel} className="hero-effect-surface glass glass-clear" data-glass-lens="" data-glint="">
      <button ref={trigger} type="button" className="hero-effect-trigger" aria-label="배경 효과" aria-expanded={open} aria-controls={id}
        onClick={() => { clearTimeout(closeTimer.current); setOpen(!open); }}>
        <EffectIcon kind="effects" /><small>효과</small>
      </button>
      <div id={id} className="hero-effect-options" role="group" aria-label="메인 배경 효과" aria-hidden={!open} inert={!open}>
        {([['mercury', '물결 반사 (Mercury)', '반사', mercury], ['veil', '빛줄기 (Veil Rays)', '빛줄기', veil]] as const).map(([kind, label, short, enabled]) =>
          <button key={kind} type="button" aria-label={label} aria-pressed={enabled} onClick={() => toggle(kind)}>
            <EffectIcon kind={kind} /><small>{short}</small>
            {enabled && <svg className="effect-check" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m2 6 2.5 2.5L10 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>)}
      </div>
    </div>
    {storageFailed && <span className="effect-storage-status" role="status">효과 설정은 이 화면에서만 유지됩니다.</span>}
  </div>;
}
