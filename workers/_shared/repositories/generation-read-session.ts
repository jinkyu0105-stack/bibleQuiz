/** A short-lived generation operation's read coalescer. Never keep this in env
 * or module state. Content writes and external effects end the read window;
 * bookkeeping writes retain already verified immutable content. Mutable
 * authority (heads, jobs, selections, purge markers) is always read from D1.
 * The existing conditional write batches remain the final authority. */
const sessions = new WeakMap<D1Database, { clear: () => void; verified: Map<string, Promise<unknown>> }>();
/** Drain every independent read before reporting an error. A failed branch must
 * not leave D1 work running after its request/test has already returned. */
export async function readTogether<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(values);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as { -readonly [K in keyof T]: Awaited<T[K]> };
}
const immutable = new Set([
  "sermon_input_events", "sermon_input_chunks", "sermon_content_events", "sermon_content_chunks",
  "sermon_content_payloads", "sermon_content_human_events", "sermon_content_domain_lineage",
  "generation_contexts", "generation_context_chunks", "generation_request_contexts", "generation_step_contexts",
  "generation_wait_contexts", "generation_full_v3_requests", "generation_transition_evidence", "generation_job_events",
  "generation_step_outcomes", "generation_step_result_links", "generation_dispatch_receipts", "ai_usage_observations",
  "ai_usage_events", "ai_usage_settlements", "generation_intent_analysis_reuse", "generation_archived_intent_recoveries",
  "final_check_tickets", "final_check_ticket_inputs", "final_check_ticket_chunks", "generation_final_validation_proofs",
]);
function cacheable(sql: string) {
  const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)/giu)].map(m => m[1]!.toLowerCase());
  return tables.length > 0 && tables.every(t => immutable.has(t));
}
export function clearGenerationReads(db: D1Database) { sessions.get(db)?.clear(); }
export function cachedGenerationRead<T>(db: D1Database, key: string): Promise<T> | undefined {
  return sessions.get(db)?.verified.get(key) as Promise<T> | undefined;
}
export function rememberGenerationRead<T>(db: D1Database, key: string, value: T) {
  sessions.get(db)?.verified.set(key, Promise.resolve(value));
}
export function generationVerifiedRead<T>(db: D1Database, key: string, read: () => Promise<T>): Promise<T> {
  const session = sessions.get(db);
  if (!session) return read();
  const hit = session.verified.get(key);
  if (hit) return hit as Promise<T>;
  const value = read();
  session.verified.set(key, value);
  const discard = () => { if (session.verified.get(key) === value) session.verified.delete(key); };
  void value.then(result => { if (result === null) discard(); }, discard);
  return value;
}

export function generationReadSession(database: D1Database): D1Database {
  if (sessions.has(database)) return database;
  const cache = new Map<string, { value: D1Result; bytes: number }>();
  const inFlight = new Map<string, { epoch: number; value: Promise<D1Result> }>();
  const verified = new Map<string, Promise<unknown>>();
  let cachedBytes = 0, epoch = 0;
  const clear = () => { cache.clear(); inFlight.clear(); verified.clear(); cachedBytes = 0; epoch++; };
  type Pending = { statement: D1PreparedStatement; key: string | null; epoch: number;
    resolve: (value: D1Result) => void; reject: (error: unknown) => void };
  let pending: Pending[] = [];
  const native = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const texts = new WeakMap<D1PreparedStatement, string>();
  function invalidate(statements: D1PreparedStatement[]) {
    const touched = new Set<string>();
    // These writes change bookkeeping or append a final ticket. They cannot
    // change an already sealed input/content/context. All other writes flush
    // the window (including unknown statements and all cleanup operations).
    for (const stmt of statements) {
      const sql = texts.get(stmt)?.trim();
      if (!sql) { clear(); return; }
      if (/^SELECT\b/iu.test(sql)) continue;
      const insert = /^INSERT INTO (generation_transition_evidence|generation_job_events|generation_final_validation_proofs|final_check_tickets|final_check_ticket_inputs|final_check_ticket_chunks)\b/iu.exec(sql);
      if (insert) { touched.add(insert[1]!.toLowerCase()); continue; }
      if (/^UPDATE final_check_tickets SET state='sealed' WHERE id=\? AND state='assembling'$/u.test(sql)) {
        touched.add("final_check_tickets"); continue;
      }
      if (/^UPDATE generation_jobs SET status=\?,current_step=\?,state_version=\?,event_count=\?,required_event_no=\?,required_event_state_version=\?,\s*evidence_event_no=\?,active_wait_generation=\?,wait_kind=\?,wait_generation=\?,wait_input_fingerprint=\?,updated_at=\?,completed_at=\?\s+WHERE id=\? AND state_version=\? AND event_count=\? AND status=\?$/u.test(sql)) continue;
      clear(); return;
    }
    epoch++;
    for (const [key, entry] of cache) if ([...touched].some(table => key.includes(table))) {
      cachedBytes -= entry.bytes; cache.delete(key);
    }
  }
  async function flush() {
    const group = pending; pending = [];
    // Bounded independently of the number of historical results being checked.
    for (let offset = 0; offset < group.length; offset += 32) {
      const page = group.slice(offset, offset + 32);
      try {
        const values = page.length === 1 ? [await page[0]!.statement.all()] : await database.batch(page.map(p => p.statement));
        if (values.length !== page.length || values.some(v => !v.success)) throw new Error("GENERATION_READ_UNAVAILABLE");
        for (const [i, p] of page.entries()) {
          const value = values[i]!;
          if (p.key && p.epoch === epoch && value.results.length) {
            const size = retainedReadBytes(value, p.key);
            const previousBytes = cache.get(p.key)?.bytes ?? 0;
            if (cachedBytes - previousBytes + size <= 4_194_304) {
              cache.set(p.key, { value, bytes: size }); cachedBytes += size - previousBytes;
            }
          }
          p.resolve(value);
        }
      } catch (error) { for (const p of page) p.reject(error); }
    }
  }
  function statement(sql: string, bound: unknown[] = []): D1PreparedStatement {
    const real = bound.length ? database.prepare(sql).bind(...bound) : database.prepare(sql);
    const readOnly = /^\s*SELECT\b/iu.test(sql);
    const key = readOnly && cacheable(sql) ? JSON.stringify([sql.replace(/\s+/gu, " ").trim(), bound]) : null;
    const read = () => {
      const hit = key ? cache.get(key) : null;
      if (hit) return Promise.resolve(hit.value);
      const running = key ? inFlight.get(key) : null;
      if (running?.epoch === epoch) return running.value;
      const value = new Promise<D1Result>((resolve, reject) => {
        pending.push({ statement: real, key, epoch, resolve, reject });
        if (pending.length === 1) queueMicrotask(() => { void flush(); });
      });
      if (key) {
        inFlight.set(key, { epoch, value });
        const discard = () => { if (inFlight.get(key)?.value === value) inFlight.delete(key); };
        void value.then(discard, discard);
      }
      return value;
    };
    const wrapped = new Proxy(real, { get(target, property) {
      if (property === "bind") return (...values: unknown[]) => statement(sql, values);
      if (readOnly && property === "all") return read;
      // raw preserves duplicate column names and empty-result headers, which
      // cannot be reconstructed from the object rows returned by all().
      if (readOnly && property === "raw") return real.raw.bind(real);
      if (readOnly && property === "first") return async (column?: string) => {
        const row = (await read()).results[0] as Record<string, unknown> | undefined;
        if (column !== undefined && row && !(column in row)) throw new Error("D1_COLUMN_NOTFOUND");
        return row ? column === undefined ? row : row[column] : null;
      };
      if (property === "run" || property === "all" || property === "first" || property === "raw") {
        return (...args: unknown[]) => { invalidate([wrapped]); return Reflect.apply(Reflect.get(target, property) as (...a: unknown[]) => unknown, target, args); };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    native.set(wrapped, real);
    texts.set(wrapped, sql);
    return wrapped;
  }
  const db = new Proxy(database, { get(target, property) {
    if (property === "prepare") return (sql: string) => statement(sql);
    if (property === "batch") return (statements: D1PreparedStatement[]) => {
      invalidate(statements); return target.batch(statements.map(s => native.get(s) ?? s));
    };
    if (property === "exec") return (sql: string) => { clear(); return target.exec(sql); };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  sessions.set(db, { clear, verified });
  return db;
}

/** Conservative retained-data estimate for D1's flat rows. Cache bookkeeping
 * must not serialize every BLOB byte into JSON and allocate it again as UTF-8.
 * D1 BLOBs are numeric arrays (or typed arrays in local adapters); the existing
 * readers still validate every byte. Unsupported cell types simply skip cache. */
function retainedReadBytes(result: D1Result, key: string): number {
  let bytes = 1024 + key.length * 3;
  for (const row of result.results) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return Infinity;
    bytes += 64;
    for (const [name, value] of Object.entries(row)) {
      bytes += 64 + name.length * 3;
      if (value === null || typeof value === "number" || typeof value === "boolean") bytes += 24;
      else if (typeof value === "string") bytes += 64 + value.length * 3;
      else if (Array.isArray(value)) bytes += 64 + value.length * 8;
      else if (ArrayBuffer.isView(value)) bytes += 64 + value.byteLength;
      else if (value instanceof ArrayBuffer) bytes += 64 + value.byteLength;
      else return Infinity;
      if (bytes > 4_194_304) return bytes;
    }
  }
  return bytes;
}
