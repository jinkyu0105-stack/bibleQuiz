import type { IntentAnalysis } from "./sermon-intent-contract";
import type { DeepReadonly } from "./transcript-revision-contract";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Narrow compatibility for the observed warnings-N / warning-N spelling error.
 * Never use array positions, fuzzy matching or another claim to repair meaning.
 * Exact existing IDs win; unknown IDs remain invalid for the domain validator. */
export function resolveGeneratedClaimReferences(intent: DeepReadonly<IntentAnalysis>, content: unknown) {
  const existing = new Set(Object.values(intent).flatMap(claims => claims.map(c => c.id)));
  const origins = new Map(Object.values(intent).flatMap(claims => claims.map(c => [c.id, c.origin] as const)));
  const repairs: { from: string; to: string }[] = [];
  const omittedUnresolved: string[] = [];
  const aliases = new Map(intent.warnings.flatMap(c => c.origin === "transcript" && /^warning-\d+$/u.test(c.id)
    ? [[c.id.replace(/^warning-/u, "warnings-"), c.id] as const] : []));
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== "intentClaimIds" || !Array.isArray(child)) return [key, visit(child)];
      const references = child.map(id => {
        const to = typeof id === "string" && !existing.has(id) ? aliases.get(id) : undefined;
        if (!to) return id;
        if (!repairs.some(r => r.from === id)) repairs.push({ from: id, to });
        return to;
      });
      // An unresolved interpretation cannot serve as factual support. Old responses
      // may list it alongside valid source claims; retain those claims and report
      // the omitted link. Never invent a replacement or remove an unknown/admin ID.
      if (!references.some(id => origins.get(id) === "transcript")) return [key, references];
      return [key, references.filter(id => {
        if (origins.get(id) !== "unresolved") return true;
        if (!omittedUnresolved.includes(id)) omittedUnresolved.push(id);
        return false;
      })];
    }));
  }
  return { content: visit(content), repairs, omittedUnresolved };
}
