import { useEffect, useRef } from "react";
import { createHeroEffects } from "./hero-effects";
import "./hero-effects.css";

/** Decorative light over the existing sky, confined to the home introduction. */
export function HeroEffects() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // Let the title, glass and selected sky paint before synchronous GPU setup.
    // This is a paint boundary, not a delay tied to an audit or a network timer.
    let dispose: (() => void) | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (canvas.current) dispose = createHeroEffects(canvas.current);
      });
    });
    return () => { cancelAnimationFrame(frame); dispose?.(); };
  }, []);
  return <canvas ref={canvas} className="hero-effects" aria-hidden="true" />;
}
