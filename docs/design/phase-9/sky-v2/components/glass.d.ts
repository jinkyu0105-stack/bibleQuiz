export type GlassController = { refresh(): void; destroy(): void };
export function mountGlassComponents(root?: Document | Element, options?: { prismatic?: boolean; descendants?: boolean }): GlassController;
