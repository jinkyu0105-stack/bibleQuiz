import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";

export function EffectControls<Key extends string>({ id, anchor, label, title = label, description, settings, defaults, fields, onChange, onClose }: {
  id: string; anchor: RefObject<HTMLElement | null>; label: string; title?: string; description: string;
  settings: Record<Key, number>; defaults: Record<Key, number>;
  fields: readonly { key: Key; label: string; min: number; max: number }[];
  onChange: (settings: Record<Key, number>) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const origin = anchor.current;
    if (!element || !origin) return;
    const place = () => {
      const box = origin.getBoundingClientRect();
      const rail = origin.closest(".time-rail")?.getBoundingClientRect() ?? box;
      const mobile = window.matchMedia("(max-width: 700px)").matches;
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, mobile ? (innerWidth - width) / 2 : box.left - width - 14))}px`;
      element.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, mobile ? rail.top - height - 10 : box.top + box.height / 2 - height / 2))}px`;
    };
    const observer = new ResizeObserver(place);
    observer.observe(element); observer.observe(origin);
    const capsule = origin.closest(".hero-effect-control");
    if (capsule) observer.observe(capsule);
    window.addEventListener("resize", place);
    place();
    element.querySelector("input")?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor, panel]);

  return <div ref={panel} id={id} className="hero-light-panel glass glass-clear" role="group" aria-label={label}>
    <div className="hero-light-heading">
      <strong>{title}</strong>
      <button type="button" className="hero-light-close" aria-label={`${label} 닫기`} onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <p className="hero-light-description">{description}</p>
    {fields.map(({ key, label: fieldLabel, min, max }) =>
      <label className="hero-light-slider" key={key}>
        <span>{fieldLabel}<output htmlFor={`${id}-${key}`}>{settings[key]}<small>%</small></output></span>
        <input id={`${id}-${key}`} type="range" min={min} max={max} step="1"
          value={settings[key]} aria-label={fieldLabel} aria-valuetext={`${settings[key]}%`}
          style={{ "--veil-value": `${(settings[key] - min) / (max - min) * 100}%` } as CSSProperties}
          onChange={event => onChange({ ...settings, [key]: event.currentTarget.valueAsNumber })} />
      </label>)}
    <button className="hero-light-reset" type="button" onClick={() => onChange({ ...defaults })}>기본값으로</button>
  </div>;
}
