import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { blankExport } from "../../shared/api/quiz-export";
import { exportResponse } from "../fixtures/export-response";
import { publicResponse } from "../fixtures/public-response";

const slug = "2026-08-31-test01";
async function mock(context: BrowserContext, options: { count?: number; denied?: "child" | "adult"; archived?: boolean } = {}) {
  await context.route("**/api/quizzes/**", route => {
    const url = new URL(route.request().url());
    const level = url.pathname.includes("/adult/") || url.searchParams.get("difficulty") === "adult" ? "adult" : "child";
    if (url.pathname.endsWith("/export-data")) return route.fulfill({ json: { data: blankExport(publicResponse(level).data.quiz!) } });
    if (url.pathname.endsWith("/top-n-export")) return route.fulfill(options.denied === level
      ? { status: 403, json: { error: { code: "SUBMISSION_REQUIRED" } } }
      : { json: { data: exportResponse(options.count ?? 13, level) } });
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { data: { submission: null } } });
    if (url.pathname.endsWith("/board")) {
      const model = exportResponse(options.count ?? 13, level);
      return route.fulfill({ json: { data: { winnerCount: model.board.winnerCount,
        participants: model.board.participants.map(person => ({ submissionOrder: person.completionOrder, displayName: person.displayName,
          submittedAt: person.submittedAt, answers: person.answers, correctCellIds: Object.keys(person.answers), isFullyCorrect: true, isMine: false, comment: "인쇄제외문구" })),
        winners: model.board.participants.flatMap(person => person.rank === null ? [] : [{ rank: person.rank, submissionOrder: person.completionOrder }]),
      } } });
    }
    const result = publicResponse(level);
    if (options.archived) Object.assign(result.data.quiz!, { status: "archived", availability: "archived", mode: "practice", acceptingSubmissions: false, solutionAccess: "public" });
    return route.fulfill({ json: result });
  });
}
async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "PDF 파일 받기", exact: true })).toBeVisible({ timeout: 30_000 });
}
async function download(page: Page, button: string, name: string) {
  const event = page.waitForEvent("download"); await page.getByRole("button", { name: button, exact: true }).click();
  const file = await event; const path = `/tmp/p6-01-${test.info().project.name}-${name}`;
  await file.saveAs(path); return { file, path, bytes: await readFile(path) };
}
test("blank SVG preview and Korean clue clipboard fallback remain public and answer-free", async ({ page, context }) => {
  await mock(context); await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }); });
  await page.goto(`/quiz/${slug}/export`);
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("both");
  await page.getByRole("button", { name: "문제 텍스트 복사", exact: true }).click();
  const field = page.getByRole("textbox", { name: "복사할 문제 텍스트" });
  await expect(field).toBeFocused(); const value = await field.inputValue();
  expect(value).toContain("[어린이용]"); expect(value).toContain("[장년용]"); expect(value).toContain("[가로]"); expect(value).toContain("[세로]");
  expect(await field.evaluate(node => (node as HTMLTextAreaElement).selectionEnd)).toBe(value.length);
  await expect(page.getByRole("img", { name: "어린이용 번호 표시 빈 격자" })).toBeVisible();
  await page.screenshot({ path: `/tmp/p6-01-${test.info().project.name}-blank.png`, fullPage: true });
});
test("downloads both actual 1600 PNG files and an advanced transparent SVG", async ({ page, context }) => {
  await mock(context); await page.goto(`/quiz/${slug}/export`);
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("both");
  const downloads: Promise<void>[] = [];
  page.on("download", file => { downloads.push(file.saveAs(`/tmp/p6-01-${test.info().project.name}-${file.suggestedFilename()}`)); });
  await page.getByRole("button", { name: "빈 격자 받기", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2개의 빈 격자", { timeout: 30_000 });
  await Promise.all(downloads); expect(downloads).toHaveLength(2);
  for (const level of ["어린이용", "장년용"]) {
    const bytes = await readFile(`/tmp/p6-01-${test.info().project.name}-${slug}-${level}-빈격자.png`);
    expect(bytes.readUInt32BE(16)).toBe(1600); expect(bytes.readUInt32BE(20)).toBe(1600);
  }
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("child");
  await page.getByText("고급 설정", { exact: true }).click(); await page.getByRole("checkbox", { name: "SVG 배경 투명" }).check();
  const svg = await download(page, "SVG 받기", "blank.svg");
  expect(svg.bytes.toString()).toContain('width="1600"'); expect(svg.bytes.toString()).not.toContain('width="1600" height="1600" fill="#ffffff"');
});
test("creates actual multi-page Korean vector A4 PDF, both levels and print route without app navigation", async ({ page, context }) => {
  await mock(context); await page.goto(`/quiz/${slug}/print?level=child`); await ready(page);
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(0);
  const result = await download(page, "PDF 파일 받기", "topn.pdf");
  const pdf = await PDFDocument.load(result.bytes); expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages()[0]!.getWidth()).toBeCloseTo(595.27559, 3);
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("both"); await ready(page);
  const both = await download(page, "PDF 파일 받기", "both.pdf");
  expect((await PDFDocument.load(both.bytes)).getPageCount()).toBe(4);
  await page.screenshot({ path: `/tmp/p6-01-${test.info().project.name}-print.png`, fullPage: true });
});
test("50-person PNG ZIP contains all five 300dpi A4 pages", async ({ page, context }) => {
  test.setTimeout(60_000); await mock(context, { count: 50 });
  await page.goto(`/quiz/${slug}/print?level=adult`); await ready(page);
  const result = await download(page, "PNG ZIP 받기", "50.zip");
  const bytes = result.bytes; const end = bytes.subarray(bytes.length - 22); expect(end.readUInt16LE(10)).toBe(5);
  let offset = 0, count = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const png = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    expect(png.readUInt32BE(16)).toBe(2480); expect(png.readUInt32BE(20)).toBe(3508);
    const pHYs = png.indexOf(Buffer.from("pHYs")); expect(pHYs).toBeGreaterThan(20);
    expect(png.readUInt32BE(pHYs + 4)).toBe(11811); expect(png[pHYs + 12]).toBe(1);
    offset += 30 + nameLength + length; count++;
  }
  expect(count).toBe(5);
});
test("direct print route rejects missing submission and both fails if either level is unauthorized", async ({ page, context }) => {
  await mock(context, { denied: "adult" }); await page.goto(`/quiz/${slug}/print?level=adult`);
  await expect(page.getByRole("alert")).toContainText("장년용에 답안을 제출한 브라우저");
  await expect(page.getByRole("button", { name: "PDF 파일 받기", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("child"); await ready(page);
  await page.getByRole("combobox", { name: "출력 난이도" }).selectOption("both");
  await expect(page.getByRole("alert")).toContainText("장년용에 답안을 제출한 브라우저");
  await expect(page.getByRole("button", { name: "PDF 파일 받기", exact: true })).toHaveCount(0);
});
test("only eligible Top N region exposes print button and opens a real result tab", async ({ page, context }) => {
  await mock(context, { archived: true }); await page.goto(`/quiz/${slug}`);
  await page.getByRole("button", { name: "참여 현황 보기", exact: true }).click();
  await page.getByRole("button", { name: "Top N", exact: true }).click();
  const event = page.waitForEvent("popup"); await page.getByRole("button", { name: "Top N 출력", exact: true }).click();
  const popup = await event; await ready(popup); await expect(popup).toHaveURL(/\/print\?level=child/u); await popup.close();
});
test("blocked popup falls back to actual PDF download on the original page", async ({ page, context }) => {
  await mock(context, { archived: true }); await page.addInitScript(() => { window.open = () => null; });
  await page.goto(`/quiz/${slug}`); await page.getByRole("button", { name: "참여 현황 보기", exact: true }).click();
  await page.getByRole("button", { name: "Top N", exact: true }).click();
  const file = await download(page, "Top N 출력", "fallback.pdf"); expect((await PDFDocument.load(file.bytes)).getPageCount()).toBe(2);
});
test("unsubmitted public quiz hides Top N print and does not load PDF, font or wasm eagerly", async ({ page, context }) => {
  await mock(context); const requests: string[] = []; page.on("request", request => requests.push(request.url()));
  await page.goto(`/quiz/${slug}`); await expect(page.getByRole("button", { name: "빈 격자 받기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Top N 출력", exact: true })).toHaveCount(0);
  expect(requests.filter(url => /fontkit|NotoSansKR\.ttf|index_bg\.wasm|pdf-lib/u.test(url))).toHaveLength(0);
});

test("browser without inline PDF viewer automatically downloads a valid PDF", async ({ page, context }) => {
  await mock(context); await page.addInitScript(() => { Object.defineProperty(navigator, "pdfViewerEnabled", { value: false }); });
  const event = page.waitForEvent("download"); await page.goto(`/quiz/${slug}/print?level=child`);
  const file = await event; await file.saveAs(`/tmp/p6-01-${test.info().project.name}-no-viewer.pdf`);
  expect((await PDFDocument.load(await readFile(`/tmp/p6-01-${test.info().project.name}-no-viewer.pdf`))).getPageCount()).toBe(2);
  await expect(page.getByRole("status")).toContainText("미리보기를 지원하지 않아");
  await expect(page.locator("iframe")).toHaveCount(0);
});
