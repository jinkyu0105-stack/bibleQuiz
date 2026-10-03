import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import { difficultyLabel, type TopNExport } from "../../../shared/api/quiz-export";

export const A4 = { width: 210 / 25.4 * 72, height: 297 / 25.4 * 72 };
export const printColors = { ink: "#36434a", accent: "#526300", paper: "#ffffff", winner: "#f4f0d9" };
export type Shape =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string; stroke?: string; strokeWidth?: number }
  | { kind: "text"; x: number; y: number; size: number; text: string; fill: string };
export interface Scene {
  width: number; height: number; shapes: Shape[];
  celebration?: { dataUrl: string; x: number; y: number; width: number; height: number };
}
export type Measure = (text: string, size: number) => number;
export function escapeXml(text: string) {
  return text.replace(/[&<>"']/gu, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[value]!);
}
export function sceneSvg(scene: Scene) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">` + scene.shapes.map(shape => shape.kind === "rect"
    ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}" stroke="${shape.stroke ?? "none"}" stroke-width="${shape.strokeWidth ?? 0}"/>`
    : `<text x="${shape.x}" y="${shape.y}" font-family="Noto Sans KR" font-size="${shape.size}" fill="${shape.fill}">${escapeXml(shape.text)}</text>`).join("") + (scene.celebration ? `<image href="${scene.celebration.dataUrl}" x="${scene.celebration.x}" y="${scene.celebration.y}" width="${scene.celebration.width}" height="${scene.celebration.height}"/>` : "") + "</svg>";
}
function text(scene: Scene, value: string, x: number, baseline: number, size: number, fill = printColors.ink) {
  scene.shapes.push({ kind: "text", text: value, x, y: baseline, size, fill });
}
function wrappedText(scene: Scene, value: string, x: number, y: number, width: number, size: number, measure: Measure) {
  let line = "";
  for (const char of value.replace(/[\p{Cc}\p{Cf}]/gu, " ")) {
    if (measure(line + char, size) > width && line) {
      text(scene, line, x, y, size); y += size * 1.45; line = "";
    }
    line += char;
  }
  text(scene, line, x, y, size);
  return y + size * 1.45;
}
export function drawGrid(scene: Scene, grid: PublicPuzzleGrid, x: number, y: number, width: number, answers?: Readonly<Record<string, string>>, measure?: Measure) {
  const unit = width / grid.gridSize;
  const cells = new Map(grid.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
  for (let row = 0; row < grid.gridSize; row++) for (let column = 0; column < grid.gridSize; column++) {
    const cell = cells.get(`${row}:${column}`);
    const left = x + column * unit, top = y + row * unit;
    scene.shapes.push({ kind: "rect", x: left, y: top, width: unit, height: unit,
      fill: cell ? "#ffffff" : "#e4e4e4", stroke: "#000000", strokeWidth: width > 1000 ? 4 : 0.5 });
    if (cell?.number !== undefined) text(scene, String(cell.number), left + unit * 0.07, top + unit * 0.23, unit * 0.2, "#000000");
    const answer = cell && answers?.[cell.id];
    if (answer) {
      const size = unit * 0.58, letterWidth = measure ? measure(answer, size) : size;
      text(scene, answer, left + (unit - letterWidth) / 2, top + unit * 0.8, size, "#000000");
    }
  }
}
export function blankGridSvg(grid: PublicPuzzleGrid, transparent = false) {
  const scene: Scene = { width: 1600, height: 1600, shapes: [] };
  if (!transparent) scene.shapes.push({ kind: "rect", x: 0, y: 0, width: 1600, height: 1600, fill: "#ffffff" });
  drawGrid(scene, grid, 8, 8, 1584);
  return sceneSvg(scene);
}
const time = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
function header(scene: Scene, model: TopNExport, measure: Measure, first: boolean) {
  const x = 30, contentWidth = A4.width - 60;
  let y = wrappedText(scene, `${model.sermon.churchName} · 이번 주의 말씀 : 낱말 퀴즈`, x, 40, contentWidth, 10, measure);
  if (first) {
    y = wrappedText(scene, model.sermon.title, x, y + 5, contentWidth, 15, measure);
    y = wrappedText(scene, `${model.sermon.date} · ${model.sermon.bibleReferenceLabel} (${model.sermon.translation})`, x, y + 2, contentWidth, 9, measure);
  } else y = wrappedText(scene, `${model.sermon.date} · 정답자 현황 이어서`, x, y + 3, contentWidth, 9, measure);
  text(scene, `${difficultyLabel(model.difficulty)} · Top ${model.board.winnerCount}`, x, y + 22, 20, printColors.accent);
  return y + 42;
}
export function posterScenes(model: TopNExport, measure: Measure): Scene[] {
  const headerHeight = header({ ...A4, shapes: [] }, model, measure, true);
  const firstRows = Math.max(1, Math.min(4, Math.floor((A4.height - 80 - headerHeight) / 140)));
  const firstCount = firstRows * 3;
  const groups = [model.board.participants.slice(0, firstCount)];
  for (let start = firstCount; start < model.board.participants.length; start += 12) groups.push(model.board.participants.slice(start, start + 12));
  return groups.map((people, pageIndex) => {
    const scene: Scene = { ...A4, shapes: [{ kind: "rect", x: 0, y: 0, ...A4, fill: printColors.paper }] };
    const x = 30, contentWidth = A4.width - 60;
    const y = header(scene, model, measure, pageIndex === 0);
    // Small groups use the approved print reference's wide rows, instead of a tiny card in a corner.
    const wide = people.length <= 4;
    const columns = wide ? (people.length === 4 ? 2 : 1) : 3;
    const gap = 12, cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const rows = wide ? Math.max(1, Math.ceil(people.length / columns)) : (pageIndex === 0 ? firstRows : 4);
    const availableHeight = (A4.height - 80 - y - gap * (rows - 1)) / rows;
    const cardHeight = Math.min(wide ? (people.length === 1 ? 290 : people.length === 2 ? 240 : 188) : 158, availableHeight);
    people.forEach((person, index) => {
      const left = x + (index % columns) * (cardWidth + gap);
      const top = y + Math.floor(index / columns) * (cardHeight + gap);
      scene.shapes.push({ kind: "rect", x: left, y: top, width: cardWidth, height: cardHeight,
        fill: person.rank === null ? printColors.paper : printColors.winner,
        stroke: person.rank === null ? "#bdc3af" : printColors.accent, strokeWidth: person.rank === null ? 0.7 : 1.8 });
      const horizontal = wide && columns === 1;
      const gridWidth = horizontal ? Math.min(220, cardHeight - 32, cardWidth * 0.44) : Math.min(cardWidth - 24, cardHeight - 66);
      const textWidth = horizontal ? cardWidth - gridWidth - 52 : cardWidth - 24;
      const label = person.rank === null ? `정답 완료 ${person.completionOrder}` : `${person.rank}위 · 정답 완료 ${person.completionOrder}`;
      text(scene, label, left + 12, top + (horizontal ? 40 : 20), horizontal ? 15 : 9, person.rank === null ? printColors.ink : printColors.accent);
      const nameSize = Math.min(horizontal ? 24 : wide ? 16 : 12, textWidth / Math.max(1, measure(person.displayName, 1)));
      text(scene, person.displayName, left + 12, top + (horizontal ? 81 : 39), nameSize);
      text(scene, time(person.submittedAt), left + 12, top + (horizontal ? 110 : 54), horizontal ? 10 : 6.8);
      drawGrid(scene, model.grid, horizontal ? left + cardWidth - gridWidth - 16 : left + (cardWidth - gridWidth) / 2,
        horizontal ? top + (cardHeight - gridWidth) / 2 : top + 60, gridWidth, person.answers, measure);
    });
    if (!people.length) text(scene, "아직 모든 답을 맞힌 참여자가 없어요.", x, y + 30, 13);
    const footer = [`생성 시각 ${time(model.generatedAt)} (한국 시간)`,
      `포함된 정답자 ${model.board.participants.length}명 · 현재 Top ${model.board.winnerCount} 기준 · ${pageIndex + 1}/${groups.length}쪽`];
    text(scene, footer[0]!, x, A4.height - 43, 8);
    text(scene, footer[1]!, x, A4.height - 29, 8);
    return scene;
  });
}
