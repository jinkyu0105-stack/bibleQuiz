import type { TopNExport } from "../../../shared/api/quiz-export";
import { posterScenes, sceneSvg, type Scene } from "./scene";
import { png300dpi } from "./files";

let fontPromise: Promise<Uint8Array<ArrayBuffer>> | undefined;
export function printFont() {
  fontPromise ??= fetch("/fonts/NotoSansKR.ttf", { signal: AbortSignal.timeout(30_000) }).then(async response => {
    if (!response.ok) throw new Error("한글 폰트를 불러오지 못했습니다.");
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}
let wasmPromise: Promise<void> | undefined;
export async function svgPng(svg: string, width: number, dpi = false) {
  const [{ initWasm, Resvg }, wasm, font] = await Promise.all([
    import("@resvg/resvg-wasm"), import("@resvg/resvg-wasm/index_bg.wasm?url"), printFont(),
  ]);
  wasmPromise ??= initWasm(fetch(wasm.default)).catch(error => { wasmPromise = undefined; throw error; });
  await wasmPromise;
  const renderer = new Resvg(svg, { fitTo: { mode: "width", value: width },
    font: { fontBuffers: [font], defaultFontFamily: "Noto Sans KR" } });
  try {
    const result = renderer.render();
    try { const bytes = new Uint8Array(result.asPng()); return dpi ? png300dpi(bytes) : bytes; }
    finally { result.free(); }
  } finally { renderer.free(); }
}
async function celebrationBytes(): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetch("/images/shared/celebration-print.png", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? bytes : null;
  } catch { return null; } // A missing decoration never prevents printing the quiz.
}
export function decoratePoster(scene: Scene, bytes: Uint8Array): Scene {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // Footer text ends on the left; cards leave the existing 80pt bottom margin.
  return { ...scene, celebration: { dataUrl: `data:image/png;base64,${btoa(binary)}`,
    x: scene.width - 157, y: scene.height - 70, width: 127, height: 127 / 3 } };
}
export async function createPoster(models: readonly TopNExport[]) {
  const [{ PDFDocument, rgb }, { default: fontkit }, fontBytes] = await Promise.all([
    import("pdf-lib"), import("@pdf-lib/fontkit"), printFont(),
  ]);
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  document.setTitle("말씀 낱말퀴즈 · 정답자와 Top N");
  document.setCreationDate(new Date(models[0]!.generatedAt));
  document.setModificationDate(new Date(models[0]!.generatedAt));
  const font = await document.embedFont(fontBytes, { subset: true });
  const bytes = models.some(model => model.board.participants.length > 0) ? await celebrationBytes() : null;
  const celebration = bytes ? await document.embedPng(bytes).catch(() => null) : null;
  const scenes = models.flatMap(model => posterScenes(model, (value, size) => font.widthOfTextAtSize(value, size)))
    .map(scene => bytes && celebration ? decoratePoster(scene, bytes) : scene);
  const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  for (const scene of scenes) {
    const page = document.addPage([scene.width, scene.height]);
    if (celebration && scene.celebration) {
      const art = scene.celebration;
      page.drawImage(celebration, { x: art.x, y: scene.height - art.y - art.height, width: art.width, height: art.height });
    }
    for (const shape of scene.shapes) {
      if (shape.kind === "text") page.drawText(shape.text, { x: shape.x, y: scene.height - shape.y,
        font, size: shape.size, color: color(shape.fill) });
      else page.drawRectangle({ x: shape.x, y: scene.height - shape.y - shape.height,
        width: shape.width, height: shape.height, color: color(shape.fill),
        ...(shape.stroke ? { borderColor: color(shape.stroke), borderWidth: shape.strokeWidth ?? 0 } : {}) });
    }
  }
  return { scenes, pdf: new Uint8Array(await document.save()) };
}
export async function posterPng(scene: Scene) {
  // Exact 2480x3508 pixel canvas; A4 point rounding must not drop the last row.
  return svgPng(sceneSvg({ ...scene, width: 2480, height: 3508,
    ...(scene.celebration ? { celebration: { ...scene.celebration,
      x: scene.celebration.x * 2480 / scene.width, y: scene.celebration.y * 3508 / scene.height,
      width: scene.celebration.width * 2480 / scene.width, height: scene.celebration.height * 3508 / scene.height,
    } } : {}),
    shapes: scene.shapes.map(shape => shape.kind === "rect" ? { ...shape,
      x: shape.x * 2480 / scene.width, y: shape.y * 3508 / scene.height,
      width: shape.width * 2480 / scene.width, height: shape.height * 3508 / scene.height,
      ...(shape.strokeWidth === undefined ? {} : { strokeWidth: shape.strokeWidth * 2480 / scene.width }),
    } : { ...shape, x: shape.x * 2480 / scene.width, y: shape.y * 3508 / scene.height, size: shape.size * 2480 / scene.width }) }), 2480, true);
}
