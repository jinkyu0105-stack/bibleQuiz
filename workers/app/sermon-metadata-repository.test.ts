import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../_shared/db/client";
import { bibleTranslations, sermonMetadataDrafts, sermons } from "../_shared/db/schema";
import { createSermonMetadataRepository } from "../_shared/repositories/sermon-metadata-repository";
import { finalCheckMetadataSnapshotSchema } from "../_shared/services/final-check-metadata-contract";
import { inspectSyntheticLegacyMetadata } from "./test/legacy-metadata-fixture";
import { metadataCommand, seedMetadataSermon } from "./test/sermon-metadata-fixture";

const binding = (env as Env).DB;
const database = createDatabase(binding);
const repository = createSermonMetadataRepository(database);
afterEach(() => vi.restoreAllMocks());
async function seed() {
  const id = `metadata-${crypto.randomUUID()}`;
  await seedMetadataSermon(database, id);
  return id;
}

describe("P5-18 private metadata / isolated migrated D1", () => {
  it("does not synthesize revision 1 from legacy sermons; round-trips an explicit private initialization", async () => {
    const id = await seed(), command = metadataCommand(id);
    const publicBefore = await database.select().from(sermons).where(eq(sermons.id, id));
    const translationBefore = await database.select().from(bibleTranslations).where(eq(bibleTranslations.id, id));
    expect(await repository.read(id)).toBeNull();
    const result = await repository.save(command);
    expect(result).toEqual({ outcome: "saved", snapshot: {
      contractVersion: 1, sermonId: id, metadataRevision: 1, title: command.title,
      sermonDate: command.sermonDate, bibleReference: command.bibleReference,
    } });
    if (result.outcome === "conflict") throw new Error("fixture conflict");
    expect(await repository.read(id)).toEqual(result.snapshot);
    expect(finalCheckMetadataSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    result.snapshot.bibleReference.reference.start.verse = 1;
    expect((await repository.read(id))?.bibleReference.reference.start.verse).toBe(16);
    await repository.save({ ...command, expectedRevision: 1, title: "TEST_ONLY_PRIVATE_CHANGED" });
    expect(await database.select().from(sermons).where(eq(sermons.id, id))).toEqual(publicBefore);
    expect(await database.select().from(bibleTranslations).where(eq(bibleTranslations.id, id))).toEqual(translationBefore);
  });

  it("keeps a no-op revision only after expected revision matches, and never revives ABA", async () => {
    const id = await seed(), a = metadataCommand(id);
    await repository.save(a);
    expect(await repository.save(a)).toEqual({ outcome: "conflict" });
    expect(await repository.save({ ...a, expectedRevision: 1 })).toMatchObject({ outcome: "unchanged", snapshot: { metadataRevision: 1 } });
    expect(await repository.save({ ...a, expectedRevision: 1, title: "합성 B" })).toMatchObject({ outcome: "saved", snapshot: { metadataRevision: 2 } });
    expect(await repository.save({ ...a, expectedRevision: 2 })).toMatchObject({ outcome: "saved", snapshot: { metadataRevision: 3 } });
    expect(await repository.save({ ...a, expectedRevision: 1 })).toEqual({ outcome: "conflict" });
    expect(await repository.save({ ...a, sermonId: "missing", expectedRevision: 3 })).toEqual({ outcome: "conflict" });
  });

  it.each([null, 1])("elects exactly one same-read CAS winner at expected revision %s", async (revision) => {
    const id = await seed(), command = metadataCommand(id, revision);
    if (revision === 1) await repository.save(metadataCommand(id));
    // Hold both reads at the same persisted revision, then let real D1 writes race.
    const original = database.select.bind(database);
    let reads = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(database, "select").mockImplementation((...args) => {
      const query = original(...args);
      const from = query.from.bind(query);
      vi.spyOn(query, "from").mockImplementation((...tables) => {
        const selection = from(...tables), where = selection.where.bind(selection);
        vi.spyOn(selection, "where").mockImplementation((...conditions) => {
          const result = where(...conditions);
          const execute = result.execute.bind(result);
          vi.spyOn(result, "execute").mockImplementation(async () => {
            const rows = await execute();
            reads++; if (reads === 2) release();
            await gate; return rows;
          });
          return result;
        });
        return selection;
      });
      return query;
    });
    const results = await Promise.all([repository.save({ ...command, title: "합성 승자 A" }), repository.save({ ...command, title: "합성 승자 B" })]);
    vi.restoreAllMocks();
    expect(reads).toBe(2);
    expect(results.map((r) => r.outcome).sort()).toEqual(["conflict", "saved"]);
    const winner = results.find((r) => r.outcome === "saved")!;
    if (winner.outcome === "conflict") throw new Error("fixture winner");
    expect(await repository.read(id)).toEqual(winner.snapshot);
    expect(winner.snapshot.metadataRevision).toBe((revision ?? 0) + 1);
    expect(await database.select().from(sermonMetadataDrafts).where(eq(sermonMetadataDrafts.sermonId, id))).toHaveLength(1);
  });

  it("rolls back snapshot and revision together on an AFTER UPDATE failure, then permits retry", async () => {
    const id = await seed(), command = metadataCommand(id);
    await repository.save(command);
    const before = await repository.read(id);
    await binding.exec("CREATE TRIGGER metadata_test_failure AFTER UPDATE ON sermon_metadata_drafts BEGIN SELECT RAISE(ABORT, 'TEST_ONLY_PRIVATE_DB_ERROR'); END;");
    try {
      await expect(repository.save({ ...command, expectedRevision: 1, title: "실패 합성", sermonDate: "2026-09-07" }))
        .rejects.toMatchObject({ message: "METADATA_UNAVAILABLE", code: "METADATA_UNAVAILABLE" });
      expect(await repository.read(id)).toEqual(before);
    } finally { await binding.exec("DROP TRIGGER metadata_test_failure;"); }
    expect(await repository.save({ ...command, expectedRevision: 1, title: "재시도 합성" })).toMatchObject({ outcome: "saved", snapshot: { metadataRevision: 2 } });
  });

  it("rejects orphan initialization without a row and fails safely on read transport errors", async () => {
    await expect(repository.save(metadataCommand("missing-sermon"))).rejects.toMatchObject({ code: "METADATA_UNAVAILABLE" });
    expect(await repository.read("missing-sermon")).toBeNull();
    vi.spyOn(database, "select").mockImplementation(() => { throw new Error("TEST_ONLY_PRIVATE_DB_ERROR"); });
    const failure = await repository.read("missing-sermon").catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "METADATA_UNAVAILABLE", code: "METADATA_UNAVAILABLE" });
    expect(failure).not.toHaveProperty("cause");
    expect(JSON.stringify(failure)).not.toContain("TEST_ONLY_PRIVATE");
  });

  it.each(["title", "date", "reference", "extra", "revision", "contract"])("rejects corrupt stored %s without repairing or treating it as missing", async (field) => {
    const id = await seed(), command = metadataCommand(id);
    await repository.save(command);
    const changed = structuredClone(command.bibleReference) as Record<string, unknown>;
    if (field === "reference") changed.verseCount = 99;
    if (field === "extra") changed.privateText = "TEST_ONLY_PRIVATE_CORRUPT";
    const column = field === "title" ? "title" : field === "date" ? "sermon_date" : field === "revision" ? "metadata_revision" : field === "contract" ? "contract_version" : "bible_reference_json";
    const value = field === "title" ? " TEST_ONLY_PRIVATE_CORRUPT" : field === "date" ? "2026-02-30" : field === "revision" ? 0 : field === "contract" ? 2 : JSON.stringify(changed);
    await binding.exec("PRAGMA ignore_check_constraints = ON;");
    try { await binding.prepare(`UPDATE sermon_metadata_drafts SET ${column} = ? WHERE sermon_id = ?`).bind(value, id).run(); }
    finally { await binding.exec("PRAGMA ignore_check_constraints = OFF;"); }
    await expect(repository.read(id)).rejects.toMatchObject({ code: "METADATA_CORRUPT", message: "METADATA_CORRUPT" });
    await expect(repository.save({ ...command, expectedRevision: 1 })).rejects.toMatchObject({ code: "METADATA_CORRUPT" });
  });

  it.each([0, -1, 1.5, 9007199254740992])("enforces DB revision integer/range constraints: %s", async (revision) => {
    const id = await seed(); await repository.save(metadataCommand(id));
    await expect(binding.prepare("UPDATE sermon_metadata_drafts SET metadata_revision = ? WHERE sermon_id = ?").bind(revision, id).run()).rejects.toThrow(/CHECK constraint failed/u);
    expect((await repository.read(id))?.metadataRevision).toBe(1);
  });

  it("fails revision overflow before writing", async () => {
    const id = await seed(), command = metadataCommand(id);
    await repository.save(command);
    await database.update(sermonMetadataDrafts).set({ metadataRevision: Number.MAX_SAFE_INTEGER }).where(eq(sermonMetadataDrafts.sermonId, id));
    expect(await repository.save({ ...command, expectedRevision: Number.MAX_SAFE_INTEGER })).toMatchObject({ outcome: "unchanged" });
    await expect(repository.save({ ...command, expectedRevision: Number.MAX_SAFE_INTEGER, title: "overflow" })).rejects.toMatchObject({ code: "METADATA_INVALID" });
    expect((await repository.read(id))?.metadataRevision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    { title: " 공백" }, { title: "한글".normalize("NFD") }, { sermonDate: "2026-02-30" },
    { expectedRevision: 0 }, { metadataRevision: 1 }, { contractVersion: 1 }, { text: "TEST_ONLY_PRIVATE_EXTRA" },
    { bibleReference: { ...metadataCommand("fixture").bibleReference, canonicalLabel: "불일치" } },
  ])("rejects invalid commands before any persistence: %o", async (change) => {
    const id = await seed();
    await expect(repository.save({ ...metadataCommand(id), ...change })).rejects.toMatchObject({ code: "METADATA_INVALID" });
    expect(await repository.read(id)).toBeNull();
  });
});

const legacy = {
  sermonId: "synthetic-legacy", title: "합성 metadata", sermonDate: "2026-09-06",
  translation: "개역개정", mode: "reference_only", label: "요한복음 3:16-18",
  references: [{ book: "요", chapter: 3, verseStart: 16, verseEnd: 18 }],
};
describe("P5-18 synthetic-only legacy conversion rehearsal", () => {
  it("accepts one unambiguous reference and equivalent legacy label without writing revision 1", async () => {
    const result = inspectSyntheticLegacyMetadata(legacy);
    expect(result).toMatchObject({ outcome: "candidate", candidate: { metadataRevision: 1, bibleReference: { canonicalLabel: "요한복음 3:16–18" } } });
    expect(await repository.read(legacy.sermonId)).toBeNull();
  });
  it.each([
    { references: [] }, { references: [...legacy.references, ...legacy.references] },
    { references: [{ ...legacy.references[0], book: "TEST_ONLY_PRIVATE_UNKNOWN" }] },
    { references: [{ ...legacy.references[0], chapter: 999 }] },
    { references: [{ ...legacy.references[0], verseEnd: 999 }] },
    { references: [{ ...legacy.references[0], verseEnd: 1 }] },
    { label: "요한복음 4:16-18" }, { label: "TEST_ONLY_PRIVATE_LABEL" },
    { translation: "다른 판본" }, { mode: "licensed_api" }, { title: " 공백" },
    { sermonDate: "2026-02-30" }, { privateText: "TEST_ONLY_PRIVATE_BODY" },
  ])("requires human review without copying original text: %o", (change) => {
    const result = inspectSyntheticLegacyMetadata({ ...legacy, ...change });
    expect(result).toEqual({ outcome: "needs_review", code: expect.stringMatching(/^LEGACY_/u) });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY_PRIVATE");
  });
});
