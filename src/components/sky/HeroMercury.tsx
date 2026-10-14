import { useEffect, useRef } from "react";
import { createHeroMercury } from "./hero-mercury";
import "./hero-mercury.css";

/** Decorative light over the existing sky, confined to the home introduction. */
export function HeroMercury() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) return createHeroMercury(canvas.current);
  }, []);
  return <canvas ref={canvas} className="hero-mercury" aria-hidden="true" />;
}
