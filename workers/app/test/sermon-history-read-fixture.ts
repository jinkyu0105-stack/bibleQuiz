// TEST ONLY: unconditional sequential seed of domain-valid records, NOT an append/CAS adapter.
import { createDatabase } from "../../_shared/db/client";
import { encodeHistoryRecord, parseHistoryRecord, historyStreams, type HistoryRecord, type HistoryStream } from "../../_shared/storage/history-record";
import { projectHistoryReferences } from "../../_shared/storage/history-references";
import { seedMetadataSermon } from "./sermon-metadata-fixture";
import { historyDb } from "./sermon-history-structure-fixture";
import type { historyHarness } from "./sermon-history-codec-fixture";

export async function seedReadHistory(h: ReturnType<typeof historyHarness>, sermonId = crypto.randomUUID(), after = 0, createSermon = true) {
  if (!after && createSermon) await seedMetadataSermon(createDatabase(historyDb), sermonId);
  const records: HistoryRecord[] = h.records.map((r) => parseHistoryRecord({ ...r, envelope: { ...r.envelope, sermonId } }));
  const refs = projectHistoryReferences(records, { ...h.scope(), sermonId });
  const counts = Object.fromEntries(historyStreams.map((s) => [s, 0])) as Record<HistoryStream, number>;
  let source = "", revision = "", confirmation: string | null = null;
  for (let version = 1; version <= h.state().version; version++) {
    const delta = records.filter((r) => r.envelope.commitVersion === version);
    for (const { envelope: e } of delta) {
      counts[e.stream]++;
      if (e.stream === "sources") source = e.recordId;
      if (e.stream === "revisions") { revision = e.recordId; confirmation = null; }
      if (e.stream === "confirmations") confirmation = e.recordId;
    }
    if (version <= after) continue;
    const encoded = await Promise.all(delta.map(encodeHistoryRecord));
    const references = refs.filter((r) => delta.some((d) => d.envelope.recordId === r.ownerRecordId));
    const statements: D1PreparedStatement[] = [];
    function insert(table: string, row: Record<string, unknown>, verify = false) {
      const keys = Object.keys(row);
      statements.push(historyDb.prepare(`INSERT INTO sermon_history_${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...Object.values(row)));
      if (verify) statements.push(historyDb.prepare(`UPDATE sermon_history_${table} SET verified=1 WHERE ${keys.map((k) => `${k} IS ?`).join(" AND ")}`).bind(...Object.values(row)));
    }
    const commitId = `${sermonId}-${version}`;
    insert("commits", { sermon_id: sermonId, version, commit_id: commitId, attempt_id: commitId,
      previous_version: version === 1 ? null : version - 1, previous_commit_id: version === 1 ? null : `${sermonId}-${version - 1}`,
      current_source_id: source, current_revision_id: revision, current_confirmation_id: confirmation,
      state: "assembling", command: delta.length === 2 ? "import" : delta[0]!.envelope.stream,
      ...Object.fromEntries(historyStreams.map((s) => [`${s}_count`, counts[s]])),
      record_count: delta.length, manifest_count: delta.length, reference_count: references.length,
      chunk_count: encoded.reduce((sum, p) => sum + p.chunks.length, 0),
      byte_length: encoded.reduce((sum, p) => sum + p.manifest.byteLength, 0) });
    for (const [i, { envelope: e }] of delta.entries()) {
      insert("records", { sermon_id: sermonId, record_id: e.recordId, stream: e.stream, stream_position: e.streamPosition,
        commit_version: version, commit_slot: e.commitSlot, source_revision: e.sourceRevision, difficulty: e.difficulty, verified: 0 }, true);
      const { manifest: m, chunks } = encoded[i]!;
      insert("payloads", { sermon_id: sermonId, record_id: e.recordId, codec: m.codec, chunk_bytes: m.chunkBytes,
        chunk_count: m.chunkCount, byte_length: m.byteLength, payload_sha256: m.payloadSha256, verified: 0 }, true);
      for (const c of chunks) insert("chunks", { sermon_id: sermonId, record_id: e.recordId, chunk_index: c.chunkIndex,
        byte_length: c.byteLength, chunk_sha256: c.chunkSha256, body: c.body.slice().buffer, verified: 0 }, true);
    }
    for (const r of references) insert("references", { sermon_id: sermonId, owner_record_id: r.ownerRecordId,
      reference_position: r.referencePosition, relation: r.relation, target_record_id: r.targetRecordId,
      target_stream: r.targetStream, target_member_id: r.targetMemberId, payload_path: r.payloadPath, verified: 0 }, true);
    if (version === 1) insert("heads", { sermon_id: sermonId, version, commit_id: commitId,
      current_source_id: source, current_revision_id: revision, current_confirmation_id: confirmation, storage_format_version: 1, contract_version: 1 });
    else statements.push(historyDb.prepare("UPDATE sermon_history_heads SET version=?,commit_id=?,current_source_id=?,current_revision_id=?,current_confirmation_id=? WHERE sermon_id=?")
      .bind(version, commitId, source, revision, confirmation, sermonId));
    statements.push(historyDb.prepare("UPDATE sermon_history_commits SET state='sealed' WHERE sermon_id=? AND version=?").bind(sermonId, version));
    await historyDb.batch(statements);
  }
  return sermonId;
}

export type ReadProbe = { sql: string; values: unknown[]; rows: Record<string, unknown>[] };
/** Faults/races applied to actual isolated D1 SELECT responses, never runtime hooks. */
export function observeHistoryReads(hook: (probe: ReadProbe) => void | Promise<void>): D1Database {
  return new Proxy(historyDb, {
    get(target, key) {
      if (key !== "prepare") {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        const wrap = (statement: D1PreparedStatement, values: unknown[]): D1PreparedStatement => new Proxy(statement, {
          get(stmt, property) {
            if (property === "bind") return (...bound: unknown[]) => wrap(stmt.bind(...bound), bound);
            if (property === "all") return async () => {
              const result = await stmt.all();
              await hook({ sql, values, rows: result.results });
              return result;
            };
            const value: unknown = Reflect.get(stmt, property);
            return typeof value === "function" ? value.bind(stmt) : value;
          },
        });
        return wrap(target.prepare(sql), []);
      };
    },
  });
}
