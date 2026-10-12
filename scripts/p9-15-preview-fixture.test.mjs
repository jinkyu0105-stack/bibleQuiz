import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { env } from "node:process";
import { buildPreviewDemo } from "./p9-15-preview-fixture.ts";

it("prepares only new labelled synthetic records and six real-engine puzzles", async () => {
  const data = await buildPreviewDemo();
  expect(data.manifest.map(s => s.status)).toEqual(["draft", "published", "archived", "archived"]);
  expect(data.puzzles).toHaveLength(6);
  expect(data.rows.filter(r => r.table === "submissions")).toHaveLength(12);
  expect(data.rows.filter(r => r.table === "privacy_requests")).toHaveLength(2);
  expect(data.rows.filter(r => r.table === "leaderboard_snapshot_entries")).toHaveLength(8);
  expect(data.manifest.every(s => s.title.startsWith("[테스트]"))).toBe(true);
  expect(data.rows.every(r => !["site_state", "ai_usage_events", "ai_provider_calls"].includes(r.table))).toBe(true);
  expect(data.statements.filter(s => !s.startsWith("INSERT INTO "))).toEqual([
    expect.stringMatching(/^UPDATE sermon_input_events SET state='sealed' WHERE sermon_id='[a-f0-9-]+' AND id='[a-f0-9-]+' AND state='pending';$/u),
  ]);
  if (env.P915_EXPORT === "1") {
    const root = ".wrangler/releases/p9-15";
    await mkdir(root, { recursive: true });
    await writeFile(`${root}/fixture.sql`, "-- P9-15 synthetic records only; Preview approval granted 2026-10-12.\n" + data.statements.join("\n") + "\n");
    await writeFile(`${root}/manifest.json`, JSON.stringify(data.manifest, null, 2) + "\n");
    await writeFile(`${root}/fixture.json`, JSON.stringify(data) + "\n");
  }
});
