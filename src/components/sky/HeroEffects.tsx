import { useEffect, useRef } from "react";
import { createHeroEffects } from "./hero-effects";
import "./hero-effects.css";

/** Decorative light over the existing sky, confined to the home introduction. */
export function HeroEffects() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) return createHeroEffects(canvas.current);
  }, []);
  return <canvas ref={canvas} className="hero-effects" aria-hidden="true" />;
}
