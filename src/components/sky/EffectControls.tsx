import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";

export function EffectControls<Key extends string>({ id, anchor, label, title = label, description, settings, defaults, fields, onChange, onClose, enabled, onEnabledChange }: {
  id: string; anchor: RefObject<HTMLElement | null>; label: string; title?: string; description: string;
  settings: Record<Key, number>; defaults: Record<Key, number>;
  fields: readonly { key: Key; label: string; min: number; max: number }[];
  onChange: (settings: Record<Key, number>) => void; onClose: () => void;
  enabled: boolean; onEnabledChange: (enabled: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const origin = anchor.current;
    if (!element || !origin) return;
    let placementFrame = 0;
    const place = () => {
      const box = origin.getBoundingClientRect();
      const rail = origin.closest(".time-rail")?.getBoundingClientRect() ?? box;
      const mobile = window.matchMedia("(max-width: 700px)").matches;
      const beside = mobile && innerWidth >= 560 && innerHeight <= 540;
      const menuTop = Math.min(rail.top, origin.closest(".hero-effect-surface")?.getBoundingClientRect().top ?? rail.top);
      // Four light controls must not cover the effect choices on short phones.
      // Keep the choices reachable and scroll only the controller when needed.
      element.style.maxHeight = mobile ? `${beside ? innerHeight - 24 : Math.max(120, menuTop - 24)}px` : "";
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, beside ? rail.right + 12 : mobile ? (innerWidth - width) / 2 : box.left - width - 14))}px`;
      element.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, beside ? 12 : mobile ? menuTop - height - 10 : box.top + box.height / 2 - height / 2))}px`;
    };
    const schedulePlace = () => {
      cancelAnimationFrame(placementFrame);
      placementFrame = requestAnimationFrame(place);
    };
    // Sizing an observed panel inside its observer can re-enter layout before
    // paint. Coalesce those writes into the following frame and clean it up.
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(element); observer.observe(origin);
    const capsule = origin.closest(".hero-effect-control");
    if (capsule) observer.observe(capsule);
    window.addEventListener("resize", schedulePlace);
    place();
    element.querySelector("input")?.focus({ preventScroll: true });
    return () => { cancelAnimationFrame(placementFrame); observer.disconnect(); window.removeEventListener("resize", schedulePlace); };
  }, [anchor, panel]);

  return <div ref={panel} id={id} className="hero-light-panel glass glass-clear" role="group" aria-label={label}>
    <div className="hero-light-heading">
      <strong>{title}</strong>
      <button type="button" className="hero-light-close" aria-label={`${label} 닫기`} onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <div className="hero-light-body">
    <p className="hero-light-description">{description}</p>
    {fields.map(({ key, label: fieldLabel, min, max }) =>
      <label className="hero-light-slider" key={key}>
        <span>{fieldLabel}<output htmlFor={`${id}-${key}`}>{settings[key]}<small>%</small></output></span>
        <input id={`${id}-${key}`} type="range" min={min} max={max} step="1"
          value={settings[key]} aria-label={fieldLabel} aria-valuetext={`${settings[key]}%`}
          style={{ "--veil-value": `${(settings[key] - min) / (max - min) * 100}%` } as CSSProperties}
          onChange={event => onChange({ ...settings, [key]: event.currentTarget.valueAsNumber })} />
      </label>)}
    </div>
    <div className="hero-light-actions">
      <button className="hero-light-reset" type="button" aria-label="기본값으로" title="기본값으로" onClick={() => onChange({ ...defaults })}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></svg>
        <span>기본값으로</span>
      </button>
      <button className="hero-light-toggle" type="button" role="switch" aria-label="효과 사용" aria-checked={enabled} onClick={() => onEnabledChange(!enabled)}>
        <span className="hero-light-switch" aria-hidden="true" /><span aria-hidden="true">{enabled ? "ON" : "OFF"}</span>
      </button>
    </div>
  </div>;
}
