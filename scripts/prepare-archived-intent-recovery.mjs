import assert from "node:assert/strict";
import { open, readFile, realpath, stat, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const escape = value => String(value).replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const labels = { centralMessage: "중심 메시지", purpose: "설교의 목적", bibleRelationship: "성경 본문과의 관계",
  argumentFlow: "설명의 흐름", repeatedEmphasis: "반복 강조", illustrations: "예화", audienceResponse: "청중에게 요청하는 반응",
  warnings: "주의할 해석", uncertainties: "불확실한 부분" };

export function renderRecoveryReview(p) {
  const analysis = p.result.task === "intent_critique" ? p.result.content.analysis : p.result.content;
  const sections = Object.entries(p.result.task === "summary" ? { paragraphs: "요약" } : labels).map(([field, title]) => `<section><h2>${title}</h2>${analysis[field].map(c =>
    `<article><p>${escape(c.text)}</p>${c.origin === "unresolved" ? "<p class=note>확정하지 않은 해석</p>" : ""}${c.evidence.map(e =>
      `<blockquote>${escape(e.quote)}<footer>${e.locationStatus === "unverified" ? `위치 미확인 · ${e.reason === "ambiguous" ? "같은 문구가 여러 곳에 있음" : "원문에서 찾지 못함"} · 저장과 진행 가능` : e.start === null ? "원문 인용" : `영상 ${escape(e.start)}초 · ${escape(e.duration)}초 구간`}</footer></blockquote>`).join("")}</article>`).join("") || "<p>해당 내용 없음</p>"}</section>`).join("");
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>보관된 설교 결과 검토</title><style>body{font:17px/1.8 system-ui,sans-serif;margin:40px auto;padding:0 24px;max-width:900px;color:#222;background:#faf9f6}h1{line-height:1.4}h2{border-bottom:1px solid #ccc;padding-bottom:8px;margin-top:48px}article{padding:12px 0;border-bottom:1px solid #ddd}blockquote{margin:12px 0 20px;padding:12px 20px;background:#fff;border-left:3px solid #a2a2a2;white-space:pre-wrap}footer,.note{font-size:14px;color:#555}.notice{padding:16px;background:#eeeae1}p{white-space:pre-wrap}</style><h1>보관된 설교 결과 검토</h1><p>${escape(p.expectedAuthority.metadata.title)}</p><p class="notice">앞서 받은 AI 결과를 다시 호출하지 않고 불러왔습니다. 인용문의 글자 위치는 프로그램이 계산했습니다.\n아직 앱에 반영하거나 최종 확정한 결과가 아닙니다. ${p.result.task === "summary" ? "확정한 분석에 따른 요약입니다. 요약 문장과 인용문은 원응답 그대로입니다." : p.result.task === "intent_critique" ? "이미 받은 비판 결과를 재사용합니다." : "AI 비판 검토도 아직 실행하지 않았습니다."}</p><p>${p.result.task === "summary" ? `요약 ${escape(p.checks.paragraphCount)}문단` : `주장 ${escape(p.checks.claimCount)}개`} · 원문 근거 ${escape(p.checks.evidenceCount)}개 · 이번 추가 API 비용 $0</p>${sections}<p class="note">원래 실패 이력과 비용 기록은 유지됩니다. 이 파일을 열거나 읽는 것은 앱 반영·최종 승인·유료 호출 승인이 아닙니다.</p></html>\n`;
}

/** Physical readOnly handle plus a read-only D1 facade; no network or key handling. */
export function openReadOnlyD1(filename) {
  const native = new DatabaseSync(filename, { readOnly: true });
  const prepare = (sql, values = []) => {
    assert.match(sql.trim(), /^(SELECT|WITH)\b/iu, "READ_ONLY_SQL_REQUIRED");
    return { bind: (...args) => prepare(sql, args),
      async first(column) { const row = native.prepare(sql).get(...values); return row ? column ? row[column] : row : null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values), meta: {} }; },
      async raw() { const s = native.prepare(sql); s.setReturnArrays(true); return s.all(...values); } };
  };
  return { db: { prepare }, close: () => native.close() };
}

async function privateFile(filename) {
  assert.ok(path.isAbsolute(filename));
  const s = await stat(filename);
  assert.ok(s.isFile() && (s.mode & 0o077) === 0, "PRIVATE_FILE_REQUIRED");
  return readFile(filename, "utf8");
}
async function durableWrite(filename, value) {
  const f = await open(filename, "wx", 0o600);
  try { await f.writeFile(value); await f.sync(); } finally { await f.close(); }
}

export async function prepareRecoveryFromManifest(manifestPath) {
  const manifest = JSON.parse(await privateFile(manifestPath));
  assert.deepEqual(Object.keys(manifest).sort(), ["databasePath", "outputDirectory", "pin", "requestPath", "responsePath"].sort());
  const directory = await realpath(path.dirname(manifestPath)), dirStat = await stat(directory);
  assert.equal(dirStat.mode & 0o077, 0, "PRIVATE_DIRECTORY_REQUIRED");
  assert.ok(!directory.startsWith(root + "/") && directory !== root && !/^\/(?:var\/)?tmp(?:\/|$)/u.test(directory), "PERSISTENT_PRIVATE_DIRECTORY_REQUIRED");
  assert.ok(path.isAbsolute(manifest.outputDirectory) && path.dirname(manifest.outputDirectory) === directory,
    "OUTPUT_MUST_BE_NEW_CHILD_DIRECTORY");
  const requestText = await privateFile(manifest.requestPath), responseText = await privateFile(manifest.responsePath);
  assert.ok(path.isAbsolute(manifest.databasePath));
  const dbStat = await stat(manifest.databasePath);
  assert.ok(dbStat.isFile(), "DATABASE_FILE_REQUIRED");
  // Miniflare creates 0644 SQLite files inside the user's 0700 session. That
  // enclosing directory protects the DB; preparation must not chmod real data.
  let privateDatabase = (dbStat.mode & 0o077) === 0;
  for (let parent = path.dirname(await realpath(manifest.databasePath)); !privateDatabase && parent !== path.dirname(parent); parent = path.dirname(parent)) {
    privateDatabase = ((await stat(parent)).mode & 0o077) === 0;
  }
  assert.ok(privateDatabase, "PRIVATE_DATABASE_REQUIRED");
  const require = createRequire(await realpath(path.join(root, "node_modules/wrangler/package.json")));
  const { outputFiles } = await require("esbuild").build({ entryPoints: [path.join(root, "workers/_shared/services/archived-intent-recovery.ts")],
    bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  const { db, close } = openReadOnlyD1(manifest.databasePath);
  try {
    const { prepareArchivedIntentRecovery } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
    const result = await prepareArchivedIntentRecovery(db, manifest.pin, requestText, responseText);
    if (result.outcome !== "ready_for_local_review") return result;
    // Never overwrite a previous paid result or a previously prepared package.
    await mkdir(manifest.outputDirectory, { mode: 0o700 });
    await durableWrite(path.join(manifest.outputDirectory, "recovery-package.json"), JSON.stringify(result.package, null, 2) + "\n");
    await durableWrite(path.join(manifest.outputDirectory, "analysis-review.html"), renderRecoveryReview(result.package));
    const report = { outcome: result.outcome, ...result.package.checks, ...result.package.boundaries };
    await durableWrite(path.join(manifest.outputDirectory, "verification.json"), JSON.stringify(report, null, 2) + "\n");
    for (const dir of [manifest.outputDirectory, directory]) {
      const f = await open(dir, "r"); try { await f.sync(); } finally { await f.close(); }
    }
    return report;
  } finally { close(); globalThis.fetch = previousFetch; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, "ONE_PRIVATE_MANIFEST_REQUIRED");
    const result = await prepareRecoveryFromManifest(process.argv[2]);
    console.log(JSON.stringify(result));
    if (result.outcome !== "ready_for_local_review") process.exitCode = 1;
  } catch { console.error("OFFLINE_RECOVERY_PREPARATION_FAILED"); process.exitCode = 1; }
}
