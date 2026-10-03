import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { openReadOnlyD1, renderRecoveryReview } from "./prepare-archived-intent-recovery.mjs";

test("D1 facade and physical SQLite handle forbid writes, including WITH-prefixed mutations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "synthetic-recovery-"));
  const filename = path.join(dir, "synthetic.sqlite"), writable = new DatabaseSync(filename);
  writable.exec("CREATE TABLE fixture(id INTEGER); INSERT INTO fixture VALUES(1)"); writable.close();
  const { db, close } = openReadOnlyD1(filename);
  try {
    assert.equal((await db.prepare("SELECT id FROM fixture").first()).id, 1);
    assert.throws(() => db.prepare("DELETE FROM fixture"), /READ_ONLY_SQL_REQUIRED/u);
    await assert.rejects(db.prepare("WITH x AS (SELECT 1) DELETE FROM fixture RETURNING id").all(), /readonly/u);
    assert.equal((await db.prepare("SELECT count(*) n FROM fixture").first()).n, 1);
    assert.equal(db.batch, undefined);
  } finally { close(); await rm(dir, { recursive: true }); }
});

test("private review escapes all generated text and clearly separates preparation from approval", () => {
  const fields = ["centralMessage", "purpose", "bibleRelationship", "argumentFlow", "repeatedEmphasis", "illustrations", "audienceResponse", "warnings", "uncertainties"];
  const content = Object.fromEntries(fields.map(f => [f, []]));
  content.centralMessage = [{ text: '<script>alert("private")</script>', origin: "unresolved", evidence: [{ quote: "<img src=x onerror=alert(1)>", start: 0, duration: 1 }] }];
  const html = renderRecoveryReview({ expectedAuthority: { metadata: { title: "<unsafe>" } }, result: { content }, checks: { claimCount: 1, evidenceCount: 1 } });
  assert.ok(!html.includes("<script>") && !html.includes("<img ") && !html.includes("<unsafe>"));
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /아직 앱에 반영하거나 최종 확정한 결과가 아닙니다/u);
  assert.match(html, /default-src 'none'/u);
});
