/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { blankExport, clueText, topNExport, topNExportSchema, type TopNExport } from "../../../shared/api/quiz-export";
import { publicResponse } from "../../../tests/fixtures/public-response";
import { blankGridSvg, posterScenes, sceneSvg, A4 } from "./scene";
import { crc32, pngZip } from "./files";
import { createPoster } from "./render";

function model(count = 3): TopNExport {
  const quiz = publicResponse().data.quiz!;
  return topNExport(quiz, {
    winnerCount: 3,
    participants: Array.from({ length: count }, (_, index) => ({
      submissionOrder: index + 1, displayName: `정답자${index + 1}`, submittedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      comment: "비공개인쇄금지", isMine: index === 0, isFullyCorrect: true,
      answers: Object.fromEntries(quiz.variant.grid.cells.map(cell => [cell.id, "가"])),
      correctCellIds: quiz.variant.grid.cells.map(cell => cell.id),
    })),
    winners: Array.from({ length: Math.min(count, 3) }, (_, index) => ({ rank: index + 1, submissionOrder: index + 1 })),
  }, new Date("2026-10-01T01:00:00.000Z"));
}
export { model as exportFixture };
describe("validated exports", () => {
  it("projects empty grid and clue text without answers, counts, metadata or private fields", () => {
    const quiz = { ...publicResponse().data.quiz!, transcript: "비공개원문", solution: { secret: "정답" } };
    const result = blankExport(quiz), copy = clueText(result), svg = blankGridSvg(result.grid);
    expect(JSON.stringify(result)).not.toMatch(/transcript|solution|sermon|answers|displayName/u);
    expect(copy).toContain("[가로]"); expect(copy).toContain("[세로]");
    expect(copy).not.toContain("글자"); expect(svg).not.toContain("단서");
    expect(svg).toContain('width="1600"'); expect(svg).not.toContain(quiz.sermon.title);
    expect(blankGridSvg(result.grid, true)).not.toContain('width="1600" height="1600" fill="#ffffff"');
  });
  it.each([5, 6, 7, 8, 9, 10])("renders all blocked/active cells in a %i grid", size => {
    const grid = { ...publicResponse().data.quiz!.variant.grid, gridSize: size };
    const svg = blankGridSvg(grid);
    expect((svg.match(/<rect /gu) ?? []).length).toBe(size * size + 1);
    expect(svg).not.toMatch(/answer|solution|clue/u);
  });
  it("shares filtered complete people and fixed ranks without closing rank gaps", () => {
    const result = model(4); result.board.participants[0]!.rank = null; result.board.participants[1]!.rank = 2;
    const parsed = topNExportSchema.parse(result);
    expect(parsed.board.participants[1]!.rank).toBe(2);
    expect(JSON.stringify(parsed)).not.toMatch(/comment|isMine|session|score|비공개인쇄금지/u);
    parsed.board.participants[0]!.answers = {};
    expect(topNExportSchema.safeParse(parsed).success).toBe(false);
  });
  it.each([0, 1, 3, 4, 9, 13, 50])("keeps all %i people within A4 pages and repeats snapshot footers", count => {
    const scenes = posterScenes(model(count), (text, size) => text.length * size);
    expect(scenes).toHaveLength(Math.max(1, Math.ceil(count / 12)));
    const copy = scenes.flatMap(scene => scene.shapes.filter(shape => shape.kind === "text").map(shape => shape.text));
    expect(copy.filter(value => /^정답자\d+$/u.test(value))).toHaveLength(count);
    expect(copy.filter(value => value.includes("생성 시각"))).toHaveLength(scenes.length);
    for (const scene of scenes) for (const shape of scene.shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(0); expect(shape.y).toBeGreaterThanOrEqual(0);
      if (shape.kind === "rect") {
        expect(shape.x + shape.width).toBeLessThanOrEqual(A4.width + .001);
        expect(shape.y + shape.height).toBeLessThanOrEqual(A4.height + .001);
      }
    }
    expect(scenes.map(sceneSvg).join("")).not.toContain("비공개인쇄금지");
  });
  it("retains long Korean title/reference safely within page bounds", () => {
    const data = model(13); data.sermon.title = "말씀과은혜".repeat(60); data.sermon.bibleReferenceLabel = "마태복음장절".repeat(50);
    const scenes = posterScenes(data, (text, size) => text.length * size);
    expect(scenes[0]!.shapes.filter(shape => shape.kind === "text").every(shape => shape.y < A4.height)).toBe(true);
    expect(scenes[0]!.shapes.filter(shape => shape.kind === "rect").every(shape => shape.height > 0)).toBe(true);
  });
  it("preserves every Korean, number and punctuation outline through font subsetting", async () => {
    const original = fontkit.create(new Uint8Array(await readFile("public/fonts/NotoSansKR.ttf")));
    const glyphs = original.layout("다사랑교회 이번 주의 말씀 낱말 퀴즈 어린이용 장년용 사무엘 한나 엘가나 정답 완료 1위 2026-10-01 · Top 3 (한국 시간)").glyphs;
    const subset = original.createSubset();
    const ids = glyphs.map(glyph => subset.includeGlyph(glyph));
    const encoded = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const stream = subset.encodeStream();
      stream.on("data", bytes => chunks.push(bytes));
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error" as "end", () => reject(new Error("Font subset encoding failed")));
    });
    const embedded = fontkit.create(encoded);
    // Text extraction/ToUnicode still succeeds with broken outlines. Check the actual paths.
    for (const [index, glyph] of glyphs.entries()) {
      expect(embedded.getGlyph(ids[index]!).path.toSVG()).toBe(glyph.path.toSVG());
    }
  });
  it("generates subset Korean vector PDF with exact A4 and no raster images", async () => {
    const bytes = new Uint8Array(await readFile("public/fonts/NotoSansKR.ttf"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    try {
      const result = await createPoster([model(13), { ...model(1), difficulty: "adult" }]);
      const pdf = await PDFDocument.load(result.pdf); expect(pdf.getPageCount()).toBe(3);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo(A4.width, 5); expect(page.getHeight()).toBeCloseTo(A4.height, 5);
        const resources = page.node.Resources()!;
        const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
        expect(fonts.keys().length).toBeGreaterThan(0);
        const images = resources.get(PDFName.of("XObject"));
        if (images) expect(resources.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(0);
      }
      expect(result.pdf.length).toBeLessThan(bytes.length / 10);
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);
  it("writes stored ZIP with UTF-8 filename, valid CRC and directory offsets", () => {
    const data = new TextEncoder().encode("PNG contents"), zip = pngZip([{ name: "장년용-1쪽.png", bytes: data }]);
    const view = new DataView(zip.buffer), nameLength = view.getUint16(26, true);
    expect(view.getUint32(14, true)).toBe(crc32(data));
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLength))).toBe("장년용-1쪽.png");
    const end = new DataView(zip.buffer, zip.length - 22); const offset = end.getUint32(16, true);
    expect(new DataView(zip.buffer, offset).getUint32(0, true)).toBe(0x02014b50);
    expect(end.getUint16(10, true)).toBe(1);
  });
});
