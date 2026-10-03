import { z } from "zod";

import { isCompleteHangulSyllable } from "../../../shared/puzzle/hangul";
import { createInputState } from "../hangul-input/grid";
import type { InputGrid, InputState } from "../hangul-input/types";

export interface DraftIdentity {
  /** Unique variant ID, not the weekly quiz-set ID: difficulty must remain isolated. */
  readonly quizId: string;
  readonly variantRevision: number;
}
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const draftSchema = z.strictObject({
  version: z.literal(1),
  quizId: z.string().min(1),
  variantRevision: z.number().int().positive(),
  savedAt: z.number().int().nonnegative(),
  activeCell: z.string(),
  activeEntry: z.string(),
  direction: z.enum(["across", "down"]),
  cells: z.array(z.strictObject({
    id: z.string(),
    value: z.string().transform((value) => value.normalize("NFC")).refine(isCompleteHangulSyllable),
  })).max(100),
});

export interface DraftLoad {
  readonly state: InputState;
  readonly status: "empty" | "restored" | "invalid" | "revision-mismatch" | "unavailable";
  readonly discardKeys: readonly string[];
}

export { browserStorage } from "../../lib/browser-storage";

function draftPrefix(identity: DraftIdentity): string {
  return `bibleQuiz:draft:${encodeURIComponent(identity.quizId)}:`;
}

export function draftKey(identity: DraftIdentity): string {
  return `${draftPrefix(identity)}${identity.variantRevision}`;
}

export function loadDraft(storage: DraftStorage | null, identity: DraftIdentity, grid: InputGrid): DraftLoad {
  const initial = createInputState(grid);
  const base = { state: initial, discardKeys: [] };
  if (!storage) return { ...base, status: "unavailable" };
  try {
    const key = draftKey(identity);
    const raw = storage.getItem(key);
    const oldKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const candidate = storage.key(index);
      if (candidate?.startsWith(draftPrefix(identity)) && candidate !== key) oldKeys.push(candidate);
    }
    if (raw === null) {
      return { ...base, status: oldKeys.length ? "revision-mismatch" : "empty", discardKeys: oldKeys };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ...base, status: "invalid", discardKeys: [key, ...oldKeys] }; }
    const decoded = draftSchema.safeParse(parsed);
    if (!decoded.success) return { ...base, status: "invalid", discardKeys: [key, ...oldKeys] };
    const data = decoded.data;
    const entry = grid.entries.get(data.activeEntry);
    if (
      data.quizId !== identity.quizId || data.variantRevision !== identity.variantRevision ||
      !entry || entry.direction !== data.direction || !entry.cellIds.includes(data.activeCell) ||
      data.cells.some((cell) => !grid.cells.has(cell.id)) ||
      new Set(data.cells.map((cell) => cell.id)).size !== data.cells.length
    ) return { ...base, status: "invalid", discardKeys: [key, ...oldKeys] };
    const index = entry.cellIds.indexOf(data.activeCell);
    return {
      status: "restored", discardKeys: oldKeys,
      state: {
        ...initial, activeCell: data.activeCell, activeEntry: entry.id, direction: entry.direction,
        selectionIndex: index, cellValues: new Map(data.cells.map((cell) => [cell.id, cell.value])),
        buffer: { entryId: entry.id, startIndex: index, value: "", cellCount: 0 },
      },
    };
  } catch { return { ...base, status: "unavailable" }; }
}

export function saveDraft(storage: DraftStorage | null, identity: DraftIdentity, state: InputState): boolean {
  if (!storage || state.isComposing) return false;
  const draft = draftSchema.safeParse({
    version: 1, quizId: identity.quizId, variantRevision: identity.variantRevision,
    savedAt: Date.now(), activeCell: state.activeCell, activeEntry: state.activeEntry, direction: state.direction,
    cells: [...state.cellValues].map(([id, value]) => ({ id, value })),
  });
  if (!draft.success) return false;
  try { storage.setItem(draftKey(identity), JSON.stringify(draft.data)); return true; } catch { return false; }
}

export function discardDrafts(storage: DraftStorage | null, identity: DraftIdentity, keys: readonly string[]): boolean {
  if (!storage || keys.some((key) => !key.startsWith(draftPrefix(identity)))) return false;
  try { keys.forEach((key) => storage.removeItem(key)); return true; } catch { return false; }
}

export function inputProgress(grid: InputGrid, state: InputState) {
  const filled = [...state.cellValues].filter(([id, value]) => grid.cells.has(id) && isCompleteHangulSyllable(value)).length;
  return { filled, total: grid.cells.size, remaining: grid.cells.size - filled, canConfirm: filled > 0 && !state.isComposing };
}
