export type SkyTime = "dawn" | "day" | "dusk" | "night";
export type SkyMovie = { desktop: string; mobile: string; poster: string; smallPoster: string };
export type WorldController = { dispose(): void; setGround(mode: "grass" | "photo"): void; setTheme(theme: SkyTime): void; reset(): void };
export function createWorld(options?: { asset?: (path: string) => string; videoMedia?: Record<SkyTime, SkyMovie>; initiallyPaused?: boolean; cloudSpeed?: number; onMotionChange?: (paused: boolean) => void }): WorldController;
