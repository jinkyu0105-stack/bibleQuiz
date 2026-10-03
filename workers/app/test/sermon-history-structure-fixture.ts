// Synthetic SQL-envelope rehearsal only: deliberately not a domain codec/store.
import { env } from "cloudflare:workers";
import { createDatabase } from "../../_shared/db/client";
import { seedMetadataSermon, metadataCommand } from "./sermon-metadata-fixture";
import { createSermonMetadataRepository } from "../../_shared/repositories/sermon-metadata-repository";

export const historyDb = (env as Env).DB;
export const historyTables = ["heads", "commits", "records", "references", "payloads", "chunks"] as const;
export const streams = ["sources", "revisions", "confirmations", "correctionProposals", "correctionDecisions", "intentEvents", "summaryEvents", "candidateEvents"] as const;
type Value = string | number | null | ArrayBuffer;
export type Step = { label: string; sql: string; values: Value[] };
export async function seedHistory() {
  const id = crypto.randomUUID(), database = createDatabase(historyDb);
  await seedMetadataSermon(database, id);
  await createSermonMetadataRepository(database).save(metadataCommand(id));
  return id;
}
export async function historySnapshot(id: string) {
  const queries = historyTables.map((t) => `SELECT * FROM sermon_history_${t} WHERE sermon_id=? ORDER BY 1,2,3`);
  queries.push("SELECT * FROM sermons WHERE id=?", "SELECT * FROM bible_translations WHERE id=?", "SELECT * FROM sermon_metadata_drafts WHERE sermon_id=?");
  return Promise.all(queries.map(async (sql) => (await historyDb.prepare(sql).bind(id).all()).results));
}
async function sha(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function historyPlan(id: string, command = "import", size = 65537, difficulty = "child") {
  const previous = await historyDb.prepare("SELECT * FROM sermon_history_commits WHERE sermon_id=? AND state='sealed' ORDER BY version DESC LIMIT 1").bind(id).first<Record<string, string | number | null>>();
  const version = Number(previous?.version ?? 0) + 1, attempt = crypto.randomUUID(), commit = crypto.randomUUID();
  const source = command === "import" ? crypto.randomUUID() : String(previous!.current_source_id);
  const revision = ["import", "revisions"].includes(command) ? crypto.randomUUID() : String(previous!.current_revision_id);
  const event = command === "confirmations" ? crypto.randomUUID() : null;
  const confirmation = ["import", "revisions"].includes(command) ? null : command === "confirmations" ? event : previous!.current_confirmation_id ?? null;
  const recordIds = command === "import" ? [source, revision] : [command === "revisions" ? revision : event ?? crypto.randomUUID()];
  const recordStreams = command === "import" ? ["sources", "revisions"] : [command];
  const counts = Object.fromEntries(streams.map((s) => [`${s}_count`, Number(previous?.[`${s}_count`] ?? 0) + (recordStreams.includes(s) ? 1 : 0)]));
  const steps: Step[] = [], claim = "EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=? AND c.version=? AND c.attempt_id=? AND c.state='assembling')";
  const claimValues: Value[] = [id, version, attempt];
  const add = (label: string, sql: string, values: Value[]) => steps.push({ label, sql, values });
  function row(table: string, label: string, values: Record<string, Value>) {
    const columns = Object.keys(values), bound = Object.values(values);
    add(label, `INSERT INTO sermon_history_${table} (${columns.join(",")}) SELECT ${columns.map(() => "?").join(",")} WHERE ${claim}`, [...bound, ...claimValues]);
    add(`${label}:verify`, `UPDATE sermon_history_${table} SET verified=1 WHERE ${columns.map((c) => `${c} IS ?`).join(" AND ")} AND ${claim}`, [...bound, ...claimValues]);
  }
  const refCount = command === "import" ? 1 : command === "confirmations" ? 2 : 1;
  const commitRow: Record<string, Value> = { sermon_id: id, version, commit_id: commit, current_source_id: source, current_revision_id: revision, current_confirmation_id: confirmation, attempt_id: attempt, previous_version: previous?.version ?? null, previous_commit_id: previous?.commit_id ?? null, state: "assembling", command, ...counts, record_count: recordIds.length, reference_count: refCount, manifest_count: recordIds.length, chunk_count: recordIds.length * Math.ceil(size / 65536), byte_length: recordIds.length * size };
  const claimPredicate = previous ? "EXISTS (SELECT 1 FROM sermon_history_heads WHERE sermon_id=? AND version=? AND commit_id=?)" : "NOT EXISTS (SELECT 1 FROM sermon_history_heads WHERE sermon_id=?)";
  add("claim", `INSERT INTO sermon_history_commits (${Object.keys(commitRow).join(",")}) SELECT ${Object.keys(commitRow).map(() => "?").join(",")} WHERE ${claimPredicate}`, [...Object.values(commitRow), ...(previous ? [id, previous.version!, previous.commit_id!] : [id])]);
  for (const [slot, recordId] of recordIds.entries()) {
    const stream = recordStreams[slot]!;
    row("records", `record:${slot}`, { sermon_id: id, record_id: recordId, stream, stream_position: counts[`${stream}_count`]!, commit_version: version, commit_slot: slot, source_revision: stream === "sources" ? counts.sources_count! : null, difficulty: stream === "candidateEvents" ? difficulty : null, verified: 0 });
    const bytes = new Uint8Array(size).fill(65 + slot);
    row("payloads", `payload:${slot}`, { sermon_id: id, record_id: recordId, codec: "record-json-utf8-v1", chunk_bytes: 65536, chunk_count: Math.ceil(size / 65536), byte_length: size, payload_sha256: await sha(bytes), verified: 0 });
    for (let offset = 0; offset < size; offset += 65536) {
      const body = bytes.slice(offset, offset + 65536);
      row("chunks", `chunk:${slot}:${offset / 65536}`, { sermon_id: id, record_id: recordId, chunk_index: offset / 65536, byte_length: body.length, chunk_sha256: await sha(body), body: body.buffer, verified: 0 });
    }
  }
  const owner = recordIds.at(-1)!;
  row("references", "ref:source", { sermon_id: id, owner_record_id: owner, reference_position: 1, relation: "source", target_record_id: source, target_stream: "sources", target_member_id: null, payload_path: "/sourceId", verified: 0 });
  if (command === "confirmations") row("references", "ref:revision", { sermon_id: id, owner_record_id: owner, reference_position: 2, relation: "revision", target_record_id: revision, target_stream: "revisions", target_member_id: null, payload_path: "/revisionId", verified: 0 });
  if (previous) add("head", `UPDATE sermon_history_heads SET version=?,commit_id=?,current_source_id=?,current_revision_id=?,current_confirmation_id=? WHERE sermon_id=? AND version=? AND commit_id=? AND ${claim}`, [version, commit, source, revision, confirmation, id, previous.version!, previous.commit_id!, ...claimValues]);
  else add("head", `INSERT INTO sermon_history_heads (sermon_id,version,commit_id,current_source_id,current_revision_id,current_confirmation_id,storage_format_version,contract_version) SELECT ?,?,?,?,?,?,1,1 WHERE ${claim}`, [id, version, commit, source, revision, confirmation, ...claimValues]);
  add("seal", "UPDATE sermon_history_commits SET state='sealed' WHERE sermon_id=? AND version=? AND attempt_id=? AND state='assembling'", claimValues);
  return { steps, version, attempt, commit, source, revision, recordIds };
}
export function executeHistory(steps: Step[]) {
  return historyDb.batch(steps.map((s) => historyDb.prepare(s.sql).bind(...s.values)));
}
