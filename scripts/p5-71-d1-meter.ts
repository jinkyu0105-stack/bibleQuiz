// Preparation/measurement only. SQL, bound values and results never enter the report.
export function meterD1(db: D1Database, rpcLimit?: number) {
  const counts = { d1Calls: 0, sqlStatements: 0, largestBatch: 0, blockedCalls: 0 };
  let windowCalls = 0;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const record = (size: number) => {
    if (rpcLimit !== undefined && windowCalls >= rpcLimit) {
      counts.blockedCalls++;
      throw new Error("P571_SIMULATED_D1_RPC_LIMIT");
    }
    counts.d1Calls++;
    windowCalls++;
    counts.sqlStatements += size;
  };
  function statement(target: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(target, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => statement(target.bind(...values));
      if (["first", "all", "raw", "run"].includes(String(key))) return (...args: unknown[]) => {
        record(1);
        return Reflect.apply(Reflect.get(target, key), target, args);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    originals.set(proxy, target);
    return proxy;
  }
  // Only the actual Workflow unit callback may open a fresh simulated window.
  // Keep lifetime counts and the caller's overhead budget intact. This models
  // a local acceptance bound; it does not claim how Cloudflare schedules invocations.
  async function withinWindow<T>(run: () => Promise<T>): Promise<T> {
    const outerCalls = windowCalls; windowCalls = 0;
    try { return await run(); } finally { windowCalls = outerCalls; }
  }
  return { counts, withinWindow, db: new Proxy(db, { get(target, key) {
    if (key === "prepare") return (sql: string) => statement(target.prepare(sql));
    if (key === "batch") return (statements: D1PreparedStatement[]) => {
      record(statements.length);
      counts.largestBatch = Math.max(counts.largestBatch, statements.length);
      return target.batch(statements.map(s => originals.get(s) ?? s));
    };
    // These services use prepared statements only. Do not silently miss another transport.
    if (["exec", "withSession", "dump"].includes(String(key))) return () => { throw new Error("P571_UNMETERED_D1_METHOD"); };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) };
}
