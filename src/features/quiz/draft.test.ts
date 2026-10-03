import { describe, expect, it } from "vitest";
import { createInputGrid, createInputState } from "../hangul-input/grid";
import { reduceInput } from "../hangul-input/controller";
import { discardDrafts, draftKey, inputProgress, loadDraft, saveDraft, type DraftStorage } from "./draft";
import { previewQuiz } from "./preview-data";

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
const quiz = previewQuiz("child");
const grid = createInputGrid(quiz.grid);
const initial = createInputState(grid);
const filled = reduceInput(grid, initial, { type: "paste", text: "갑세" }).state;

describe("browser-only input drafts", () => {
  it("restores only committed cells and selection, with a fresh native buffer", () => {
    const storage = memoryStorage();
    expect(loadDraft(storage, quiz, grid).status).toBe("empty");
    expect(saveDraft(storage, quiz, filled)).toBe(true);
    const restored = loadDraft(storage, quiz, grid);
    expect(restored.status).toBe("restored");
    expect(restored.state.cellValues).toEqual(filled.cellValues);
    expect(restored.state.activeCell).toBe(filled.activeCell);
    expect(restored.state.buffer).toMatchObject({ value: "", cellCount: 0, startIndex: filled.selectionIndex });
    expect(restored.state.isComposing).toBe(false);
    const data = JSON.parse(storage.getItem(draftKey(quiz))!);
    expect(Object.keys(data).sort()).toEqual(["activeCell", "activeEntry", "cells", "direction", "quizId", "savedAt", "variantRevision", "version"]);
    expect(data).not.toHaveProperty("solution");
    expect(data).not.toHaveProperty("buffer");
  });

  it("does not persist an unfinished composition or change previous storage", () => {
    const storage = memoryStorage();
    saveDraft(storage, quiz, filled);
    const before = storage.getItem(draftKey(quiz));
    const composing = reduceInput(grid, filled, { type: "compositionstart" }).state;
    expect(saveDraft(storage, quiz, composing)).toBe(false);
    expect(storage.getItem(draftKey(quiz))).toBe(before);
  });

  it("isolates difficulty and revision, and never applies stale values", () => {
    const storage = memoryStorage();
    saveDraft(storage, quiz, filled);
    const adult = previewQuiz("adult", 5);
    expect(loadDraft(storage, adult, grid).status).toBe("empty");
    const newer = { ...quiz, variantRevision: 2 };
    const stale = loadDraft(storage, newer, grid);
    expect(stale.status).toBe("revision-mismatch");
    expect(stale.state.cellValues.size).toBe(0);
    expect(stale.discardKeys).toEqual([draftKey(quiz)]);
    expect(storage.getItem(draftKey(quiz))).not.toBeNull();
    saveDraft(storage, newer, initial);
    expect(loadDraft(storage, newer, grid)).toMatchObject({ status: "restored", discardKeys: [draftKey(quiz)] });
  });

  it.each([
    ["broken JSON", () => "{"],
    ["extra private field", (data: Record<string, unknown>) => ({ ...data, solution: {} })],
    ["wrong identity", (data: Record<string, unknown>) => ({ ...data, quizId: "another" })],
    ["wrong revision", (data: Record<string, unknown>) => ({ ...data, variantRevision: 5 })],
    ["wrong direction", (data: Record<string, unknown>) => ({ ...data, direction: "down" })],
    ["unknown active cell", (data: Record<string, unknown>) => ({ ...data, activeCell: "r9c9" })],
    ["unknown cell", (data: Record<string, unknown>) => ({ ...data, cells: [{ id: "r9c9", value: "값" }] })],
    ["unfinished jamo", (data: Record<string, unknown>) => ({ ...data, cells: [{ id: "r0c0", value: "ㄱ" }] })],
    ["two syllables", (data: Record<string, unknown>) => ({ ...data, cells: [{ id: "r0c0", value: "갑세" }] })],
    ["duplicate cell", (data: Record<string, unknown>) => ({ ...data, cells: [{ id: "r0c0", value: "갑" }, { id: "r0c0", value: "세" }] })],
  ] as const)("rejects %s without removing the stored draft", (_, corrupt) => {
    const storage = memoryStorage();
    saveDraft(storage, quiz, filled);
    const corrupted = corrupt(JSON.parse(storage.getItem(draftKey(quiz))!));
    const raw = typeof corrupted === "string" ? corrupted : JSON.stringify(corrupted);
    storage.setItem(draftKey(quiz), raw);
    const result = loadDraft(storage, quiz, grid);
    expect(result.status).toBe("invalid");
    expect(result.state.cellValues.size).toBe(0);
    expect(result.discardKeys).toContain(draftKey(quiz));
    expect(storage.getItem(draftKey(quiz))).toBe(raw);
  });

  it("normalizes a canonically decomposed complete syllable on restore", () => {
    const storage = memoryStorage();
    saveDraft(storage, quiz, filled);
    const data = JSON.parse(storage.getItem(draftKey(quiz))!);
    data.cells = [{ id: "r0c0", value: "값".normalize("NFD") }];
    storage.setItem(draftKey(quiz), JSON.stringify(data));
    expect(loadDraft(storage, quiz, grid).state.cellValues.get("r0c0")).toBe("값");
  });

  it("only discards keys belonging to this variant", () => {
    const storage = memoryStorage();
    saveDraft(storage, quiz, filled);
    storage.setItem("bibleQuiz:theme", "dark");
    expect(discardDrafts(storage, quiz, [draftKey(quiz), "bibleQuiz:theme"])).toBe(false);
    expect(storage.getItem(draftKey(quiz))).not.toBeNull();
    expect(discardDrafts(storage, quiz, [draftKey(quiz)])).toBe(true);
    expect(storage.getItem(draftKey(quiz))).toBeNull();
    expect(storage.getItem("bibleQuiz:theme")).toBe("dark");
  });

  it("handles absent, blocked, or full storage without losing live input", () => {
    const unavailable = memoryStorage();
    unavailable.getItem = () => { throw new Error("blocked"); };
    unavailable.setItem = () => { throw new Error("quota exceeded"); };
    unavailable.removeItem = () => { throw new Error("blocked"); };
    for (const storage of [null, unavailable]) {
      expect(loadDraft(storage, quiz, grid).status).toBe("unavailable");
      expect(saveDraft(storage, quiz, filled)).toBe(false);
      expect(discardDrafts(storage, quiz, [draftKey(quiz)])).toBe(false);
    }
    expect(filled.cellValues.size).toBe(2);
  });

  it("counts valid cells once and allows blanks but never confirmation during composition", () => {
    expect(inputProgress(grid, initial)).toMatchObject({ filled: 0, canConfirm: false });
    expect(inputProgress(grid, filled)).toEqual({ filled: 2, total: 21, remaining: 19, canConfirm: true });
    expect(inputProgress(grid, { ...filled, isComposing: true }).canConfirm).toBe(false);
    const invalid = { ...initial, cellValues: new Map([["r0c0", "ㄱ"], ["unknown", "값"]]) };
    expect(inputProgress(grid, invalid)).toMatchObject({ filled: 0, canConfirm: false });
  });
});
