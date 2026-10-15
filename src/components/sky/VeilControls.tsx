import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import { defaultVeilSettings, type VeilSettings } from "./veil-settings";

export function VeilControls({ id, anchor, settings, night, onChange, onClose }: {
  id: string; anchor: RefObject<HTMLElement | null>; settings: VeilSettings; night: boolean;
  onChange: (settings: VeilSettings) => void; onClose: () => void;
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

  return <div ref={panel} id={id} className="hero-light-panel glass glass-clear" role="group" aria-label="빛줄기 조절">
    <div className="hero-light-heading">
      <strong>{night ? "달빛 조절" : "빛줄기 조절"}</strong>
      <button type="button" className="hero-light-close" aria-label="빛줄기 조절 닫기" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <p className="hero-light-description">{night ? "달 쪽에서 부드럽게 번지는 은빛" : "넓은 광원에서 내려오는 부드러운 빛"}</p>
    {([['width', '광원 너비'], ['strength', '밝기'], ['spread', '퍼짐']] as const).map(([key, label]) =>
      <label className="hero-light-slider" key={key}>
        <span>{label}<output htmlFor={`${id}-${key}`}>{settings[key]}<small>%</small></output></span>
        <input id={`${id}-${key}`} type="range" min={key === 'strength' ? 10 : 0} max="100" step="1"
          value={settings[key]} aria-label={label} aria-valuetext={`${settings[key]}%`}
          style={{ "--veil-value": `${(settings[key] - (key === 'strength' ? 10 : 0)) / (key === 'strength' ? 90 : 100) * 100}%` } as CSSProperties}
          onChange={event => onChange({ ...settings, [key]: event.currentTarget.valueAsNumber })} />
      </label>)}
    <button className="hero-light-reset" type="button" onClick={() => onChange({ ...defaultVeilSettings })}>기본값으로</button>
  </div>;
}
