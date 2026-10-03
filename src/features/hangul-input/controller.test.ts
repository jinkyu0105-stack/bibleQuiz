import { describe, expect, it } from "vitest";

import { isCompleteHangulSyllable } from "../../../shared/puzzle/hangul";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import { reduceInput } from "./controller";
import { createInputGrid, createInputState } from "./grid";
import type { InputAction } from "./types";

// Public geometry only: deliberately no answer fixture, generator or private solution import.
function fixture(gridSize = 5, length = 3): PublicPuzzleGrid {
  const cells = [];
  for (let row = 0; row < length; row += 1) {
    for (let column = 0; column < length; column += 1) {
      if (row === 0 || row === length - 1 || column === 0 || column === length - 1) {
        cells.push({ id: `r${row}c${column}`, row, column });
      }
    }
  }
  return {
    gridSize,
    cells,
    entries: [
      { id: "a1", number: 1, direction: "across", start: { row: 0, column: 0 }, length },
      { id: "d1", number: 1, direction: "down", start: { row: 0, column: 0 }, length },
      { id: "d2", number: 2, direction: "down", start: { row: 0, column: length - 1 }, length },
      { id: "a3", number: 3, direction: "across", start: { row: length - 1, column: 0 }, length },
    ],
  };
}

function setup(publicGrid = fixture()) {
  const grid = createInputGrid(publicGrid);
  let state = createInputState(grid);
  return {
    grid,
    get state() { return state; },
    send(action: InputAction) {
      const previous = state;
      const oldValues = [...state.cellValues];
      const transition = reduceInput(grid, state, action);
      state = transition.state;
      // Invariants are checked after EVERY action in every scenario.
      expect([...previous.cellValues]).toEqual(oldValues);
      const entry = grid.entries.get(state.activeEntry)!;
      expect(entry.cellIds[state.selectionIndex]).toBe(state.activeCell);
      expect(entry.direction).toBe(state.direction);
      for (const [id, value] of state.cellValues) {
        expect(grid.cells.has(id)).toBe(true);
        expect(isCompleteHangulSyllable(value)).toBe(true);
      }
      if (state.isComposing) {
        expect(state.cellValues).toBe(previous.cellValues);
        expect(state.activeCell).toBe(previous.activeCell);
        expect(state.activeEntry).toBe(previous.activeEntry);
        expect(transition.bufferValue).toBeUndefined();
      }
      return transition;
    },
  };
}

const input = (value: string, isComposing = false, inputType = "insertText", data?: string): InputAction =>
  ({ type: "input", value, isComposing, inputType, ...(data === undefined ? {} : { data }) });
const before = (isComposing = false, inputType = "insertText", cancelable = true): InputAction =>
  ({ type: "beforeinput", inputType, isComposing, cancelable });
const key = (value: string): InputAction => ({ type: "keydown", key: value });

describe("public input geometry", () => {
  it.each([5, 8, 10])("supports gridSize=%i without answers", (size) => {
    const session = setup(fixture(size, size));
    session.send(input("가".repeat(size)));
    expect(session.state.cellValues.size).toBe(size);
    expect(session.state.activeCell).toBe(`r0c${size - 1}`);
    expect(session.state.activeEntry).toBe("a1");
  });

  it("sorts clue navigation independently of source ordering", () => {
    const source = fixture();
    const grid = createInputGrid({ ...source, entries: [...source.entries].reverse() });
    expect(grid.entryOrder).toEqual(["a1", "d1", "d2", "a3"]);
  });

  it("copies only geometry, even when extra private fields reach the internal adapter", () => {
    const source = fixture();
    const grid = createInputGrid({
      ...source,
      cells: source.cells.map((cell) => ({ ...cell, syllable: "비공개" })),
      entries: source.entries.map((entry) => ({ ...entry, gridAnswer: "비공개" })),
    });
    const serialized = JSON.stringify({ cells: [...grid.cells], entries: [...grid.entries] });
    expect(serialized).not.toMatch(/syllable|gridAnswer|solution|비공개/);
    source.cells[0]!.row = 4;
    expect(grid.cells.get("r0c0")!.row).toBe(0);
  });

  it.each([
    ["invalid size", (grid: PublicPuzzleGrid) => ({ ...grid, gridSize: 4 })],
    ["empty entries", (grid: PublicPuzzleGrid) => ({ ...grid, entries: [] })],
    ["duplicate cell", (grid: PublicPuzzleGrid) => ({ ...grid, cells: [...grid.cells, grid.cells[0]!] })],
    ["missing path cell", (grid: PublicPuzzleGrid) => ({ ...grid, cells: grid.cells.filter((cell) => cell.id !== "r0c1") })],
    ["orphan cell", (grid: PublicPuzzleGrid) => ({ ...grid, cells: [...grid.cells, { id: "orphan", row: 4, column: 4 }] })],
    ["duplicate entry", (grid: PublicPuzzleGrid) => ({ ...grid, entries: [...grid.entries, grid.entries[0]!] })],
    ["same-direction overlap", (grid: PublicPuzzleGrid) => ({ ...grid, entries: [...grid.entries, { ...grid.entries[0]!, id: "overlap" }] })],
  ])("rejects %s geometry", (_name, change) => {
    expect(() => createInputGrid(change(fixture()))).toThrow();
  });
});

describe("native composition snapshots", () => {
  it.each(["감", "값", "갑세"])("commits native %s without implementing jamo rules", (value) => {
    const session = setup();
    session.send({ type: "compositionstart" });
    for (const text of ["ㄱ", "가", "갑", value]) {
      session.send({ type: "compositionupdate", text });
      session.send(before(true, "insertCompositionText", false));
      session.send(input(text, true, "insertCompositionText"));
      expect(session.state.cellValues.size).toBe(0);
    }
    session.send({ type: "compositionend", value });
    expect([...session.state.cellValues.values()]).toEqual([...value]);
    expect(session.state.selectionIndex).toBe(value.length);
    expect(session.state.compositionText).toBe("");
    expect(session.state.isComposing).toBe(false);
  });

  it.each(["input-before-end", "input-after-end", "beforeinput-and-input-after-end"])(
    "handles %s without duplicate commits", (order) => {
      const session = setup();
      session.send({ type: "compositionstart" });
      session.send(input("가", true, "insertCompositionText"));
      if (order === "input-before-end") session.send(input("값"));
      session.send({ type: "compositionend", value: "값" });
      if (order === "beforeinput-and-input-after-end") session.send(before(false, "insertFromComposition"));
      session.send(input("값", false, "insertFromComposition"));
      session.send(input("값"));
      expect([...session.state.cellValues]).toEqual([["r0c0", "값"]]);
      expect(session.state.activeCell).toBe("r0c1");
    },
  );

  it("does not clear the native buffer between successive equal syllables", () => {
    const session = setup();
    for (const value of ["가", "가가", "가가가"]) {
      session.send({ type: "compositionstart" });
      session.send(input(value, true));
      expect(session.send({ type: "compositionend", value }).bufferValue).toBeUndefined();
      session.send(input(value));
    }
    expect([...session.state.cellValues.values()]).toEqual(["가", "가", "가"]);
  });

  it("accepts native resegmentation and normalization only after composition", () => {
    const session = setup();
    session.send(input("갑"));
    session.send({ type: "compositionstart" });
    const decomposed = "갑세".normalize("NFD");
    session.send({ type: "compositionupdate", text: decomposed });
    expect(session.state.compositionText).toBe(decomposed);
    expect([...session.state.cellValues.values()]).toEqual(["갑"]);
    session.send({ type: "compositionend", value: decomposed });
    expect([...session.state.cellValues.values()]).toEqual(["갑", "세"]);
    expect(session.state.buffer.value).toBe(decomposed);
  });

  it("keeps committed data when a composition is cancelled to the previous native value", () => {
    const session = setup();
    session.send(input("감"));
    session.send({ type: "compositionstart" });
    session.send(input("감ㅂ", true));
    session.send({ type: "compositionend", value: "감" });
    expect([...session.state.cellValues.values()]).toEqual(["감"]);
    expect(session.state.activeCell).toBe("r0c1");
  });

  it("abandons only uncommitted text for an explicit pointer cancellation", () => {
    const session = setup();
    session.send(input("감"));
    session.send({ type: "compositionstart" });
    session.send(input("감ㄹ", true));
    const transition = session.send({ type: "compositioncancel" });
    expect(transition.bufferValue).toBe("감");
    expect(session.state.isComposing).toBe(false);
    expect(session.state.compositionText).toBe("");
    expect([...session.state.cellValues]).toEqual([["r0c0", "감"]]);
    expect(session.state.activeCell).toBe("r0c1");
  });

  it("honors native isComposing even if compositionstart was not observed", () => {
    const session = setup();
    session.send(before(true));
    session.send(input("가", true));
    session.send(key("ArrowRight"));
    expect(session.state.isComposing).toBe(true);
    expect(session.state.cellValues.size).toBe(0);
    session.send({ type: "compositionend", value: "가" });
    expect(session.state.cellValues.get("r0c0")).toBe("가");
  });

  it.each(["Enter", "Tab", "Backspace", "ArrowRight"])("leaves %s to the native IME during composition", (value) => {
    const session = setup();
    expect(session.send({ type: "keydown", key: value, isComposing: true }).preventDefault).toBe(false);
    expect(session.send({ type: "keydown", key: value, keyCode: 229 }).preventDefault).toBe(false);
    session.send({ type: "compositionstart" });
    expect(session.send(key(value)).preventDefault).toBe(false);
  });

  it.each<InputAction>([
    { type: "select-cell", cellId: "r2c2" }, { type: "select-entry", entryId: "d2" },
    { type: "move", step: 1 }, { type: "toggle-direction" }, { type: "paste", text: "가나" },
  ])("blocks application action $type while composing", (action) => {
    const session = setup();
    session.send({ type: "compositionstart" });
    const transition = session.send(action);
    expect(transition.notices).toEqual([{ code: "COMPOSITION_ACTIVE" }]);
    expect(transition.preventDefault).toBe(true);
  });
});

describe("committed text and paste", () => {
  it("uses iOS input data when a transparent native input has no value snapshot", () => {
    const session = setup();
    session.send(input("", false, "insertText", "갑"));
    session.send(input("", false, "insertText", "세"));
    expect([...session.state.cellValues]).toEqual([["r0c0", "갑"], ["r0c1", "세"]]);
  });

  it("keeps iOS raw jamo in the native buffer until the next snapshot forms a syllable", () => {
    const session = setup();
    session.send(input("ㅂ", false, "insertText", "ㅂ"));
    expect(session.state.isComposing).toBe(true);
    expect(session.state.cellValues.size).toBe(0);
    session.send(input("바", false, "insertText", "ㅏ"));
    expect([...session.state.cellValues]).toEqual([["r0c0", "바"]]);
    expect(session.state.isComposing).toBe(false);
  });

  it("keeps iOS replacement snapshots anchored across syllables and final consonants", () => {
    const session = setup(fixture(5, 5));
    for (const [value, data] of [
      ["ㄱ", "ㄱ"], ["가", "가"], ["갑", "갑"], ["값", "값"],
      ["값ㅎ", "ㅎ"], ["값호", "호"], ["값호ㅇ", "ㅇ"], ["값홍", "홍"],
      ["값홍ㄱ", "ㄱ"], ["값홍기", "기"], ["값홍기ㄹ", "ㄹ"], ["값홍길", "길"],
      ["값홍길ㄷ", "ㄷ"], ["값홍길도", "도"], ["값홍길도ㅇ", "ㅇ"], ["값홍길동", "동"],
    ]) session.send(input(value!, false, "insertText", data));
    expect([...session.state.cellValues]).toEqual([
      ["r0c0", "값"], ["r0c1", "홍"], ["r0c2", "길"], ["r0c3", "동"],
    ]);
    expect(session.state.activeCell).toBe("r0c4");
  });

  it("retains touch selection on the syllable that iOS may still replace", () => {
    const session = setup(fixture(5, 5));
    const touchInput = (value: string, data: string): InputAction => ({
      type: "input", value, data, inputType: "insertText", isComposing: false,
      retainLastCommittedCell: true,
    });
    session.send(touchInput("ㄱ", "ㄱ"));
    session.send(touchInput("가", "가"));
    expect(session.state.activeCell).toBe("r0c0");
    session.send(touchInput("갑", "갑"));
    session.send(touchInput("값", "값"));
    expect(session.state.activeCell).toBe("r0c0");
    session.send(touchInput("값ㅎ", "ㅎ"));
    expect(session.state.activeCell).toBe("r0c0");
    session.send(touchInput("값호", "호"));
    expect(session.state.activeCell).toBe("r0c1");
    expect([...session.state.cellValues]).toEqual([["r0c0", "값"], ["r0c1", "호"]]);
  });

  it.each(["ㄱ", "ᄀ", "abc", "123", "가 나", "가\n나", "家", "가🙂나", "가\u200b나", "가\u0301", "가!나"])(
    "rejects the whole invalid committed edit %j without shifting valid characters", (value) => {
      const session = setup();
      session.send(input("감"));
      const transition = session.send(input(value));
      expect(transition.notices).toEqual([{
        code: "INVALID_HANGUL_SYLLABLE",
        ...(/[a-z]/iu.test(value) ? { containsLatin: true } : {}),
      }]);
      expect(transition.bufferValue).toBe("감");
      expect([...session.state.cellValues]).toEqual([["r0c0", "감"]]);
      expect(session.state.activeCell).toBe("r0c1");
    },
  );

  it("does not commit beforeinput data and accepts an input-only edit", () => {
    const session = setup();
    expect(session.send(before()).preventDefault).toBe(false);
    expect(session.state.cellValues.size).toBe(0);
    session.send(input("가나"));
    expect([...session.state.cellValues.values()]).toEqual(["가", "나"]);
  });

  it("replaces/shrinks the projected run without leaving stale cells", () => {
    const session = setup();
    session.send(input("가나다"));
    session.send(input("값", false, "insertReplacementText"));
    expect([...session.state.cellValues]).toEqual([["r0c0", "값"]]);
    session.send(input("", false, "deleteByCut"));
    expect(session.state.cellValues.size).toBe(0);
    expect(session.state.selectionIndex).toBe(0);
  });

  it("pastes from the selected cell, reports overflow, and never moves to the next clue", () => {
    const session = setup();
    session.send({ type: "select-cell", cellId: "r0c1" });
    const transition = session.send({ type: "paste", text: "가나다라" });
    expect(transition.preventDefault).toBe(true);
    expect(transition.notices).toEqual([{ code: "ENTRY_OVERFLOW", omittedCount: 2 }, { code: "ENTRY_END" }]);
    expect([...session.state.cellValues]).toEqual([["r0c1", "가"], ["r0c2", "나"]]);
    expect(session.state.activeCell).toBe("r0c2");
    expect(session.state.activeEntry).toBe("a1");
    session.send(input("가나다라", false, "insertFromPaste"));
    expect(session.state.cellValues.size).toBe(2);
  });

  it("normalizes NFD paste and preserves old cells when paste is invalid or empty", () => {
    const session = setup();
    session.send({ type: "paste", text: "갑세".normalize("NFD") });
    const previous = session.state;
    expect(session.send({ type: "paste", text: "가A나" }).state).toBe(previous);
    expect(session.send({ type: "paste", text: "" }).state).toBe(previous);
    expect([...session.state.cellValues.values()]).toEqual(["갑", "세"]);
  });

  it("uses one value per crossing cell and allows a deliberate middle-cell overwrite", () => {
    const session = setup();
    session.send({ type: "paste", text: "가나다" });
    session.send({ type: "select-entry", entryId: "d2" });
    session.send({ type: "paste", text: "라마바" });
    expect(session.state.cellValues.get("r0c2")).toBe("라");
    expect(session.state.cellValues.size).toBe(5);
    session.send({ type: "select-cell", cellId: "r0c1" });
    session.send(input("값"));
    expect(session.state.cellValues.get("r0c1")).toBe("값");
    expect(session.state.cellValues.get("r0c2")).toBe("라");
  });
});

describe("selection and keyboard commands", () => {
  it("supports Tab/Shift+Tab, and lets native Tab escape at either boundary", () => {
    const session = setup();
    expect(session.send({ type: "keydown", key: "Tab", shiftKey: true }).preventDefault).toBe(false);
    expect(session.send(key("Tab")).preventDefault).toBe(true);
    expect(session.state.activeCell).toBe("r0c1");
    session.send({ type: "keydown", key: "Tab", shiftKey: true });
    expect(session.state.activeCell).toBe("r0c0");
    session.send({ type: "select-cell", cellId: "r0c2" });
    expect(session.send(key("Tab")).preventDefault).toBe(false);
  });

  it("moves only to physical adjacent active cells, not across blocked gaps or edges", () => {
    const session = setup();
    session.send(key("ArrowRight"));
    session.send(key("ArrowDown"));
    expect(session.state.activeCell).toBe("r0c1");
    session.send(key("ArrowUp"));
    expect(session.state.activeCell).toBe("r0c1");
    session.send(key("ArrowLeft"));
    session.send(key("ArrowDown"));
    expect(session.state.activeCell).toBe("r1c0");
    expect(session.state.direction).toBe("down");
  });

  it("toggles crossings by repeat click, Enter, and the direction command", () => {
    const session = setup();
    session.send({ type: "select-cell", cellId: "r0c0" });
    expect(session.state.activeEntry).toBe("d1");
    session.send(key("Enter"));
    expect(session.state.activeEntry).toBe("a1");
    session.send({ type: "toggle-direction" });
    expect(session.state.activeEntry).toBe("d1");
    session.send({ type: "move", step: 1 });
    expect(session.send({ type: "toggle-direction" }).notices).toEqual([{ code: "NO_CROSSING" }]);
    session.send(key("Enter"));
    expect(session.state.activeEntry).toBe("d2");
  });

  it("clears a filled current cell; an empty current cell moves back without deleting the previous value", () => {
    const session = setup();
    session.send(input("가"));
    session.send(key("Backspace"));
    expect(session.state.activeCell).toBe("r0c0");
    expect(session.state.cellValues.get("r0c0")).toBe("가");
    expect(session.send(key("Backspace")).bufferValue).toBe("");
    expect(session.state.cellValues.size).toBe(0);
    session.send(key("Backspace"));
    expect(session.state.activeCell).toBe("r0c0");
  });

  it.each([true, false])("supports mobile backward deletion when beforeinput cancelable=%s", (cancelable) => {
    const session = setup();
    session.send(input("가"));
    const transition = session.send(before(false, "deleteContentBackward", cancelable));
    expect(transition.preventDefault).toBe(cancelable);
    if (!cancelable) session.send(input("", false, "deleteContentBackward"));
    expect(session.state.activeCell).toBe("r0c0");
    expect(session.state.cellValues.get("r0c0")).toBe("가");
  });

  it("synchronizes the native buffer after non-cancelable deletion at an empty boundary", () => {
    const session = setup();
    session.send(before(false, "deleteContentBackward", false));
    const transition = session.send(input("", false, "deleteContentBackward"));
    expect(transition.bufferValue).toBe("");
    expect(session.state.activeCell).toBe("r0c0");
  });

  it("shares mobile previous/next semantics and resets the native buffer on deliberate selection", () => {
    const session = setup();
    session.send(input("가"));
    expect(session.send({ type: "move", step: -1 }).bufferValue).toBe("");
    session.send(input("가"));
    expect(session.state.cellValues.size).toBe(1);
    session.send({ type: "move", step: 1 });
    expect(session.state.activeCell).toBe("r0c2");
  });

  it("ignores unknown/modified keys and rejects unknown cells and clues without mutation", () => {
    const session = setup();
    for (const action of [key("a"), key("toString"), { type: "keydown", key: "ArrowRight", ctrlKey: true }] satisfies InputAction[]) {
      expect(session.send(action).preventDefault).toBe(false);
    }
    for (const action of [{ type: "select-cell", cellId: "r1c1" }, { type: "select-entry", entryId: "missing" }] satisfies InputAction[]) {
      expect(session.send(action).notices).toEqual([{ code: "INVALID_SELECTION" }]);
    }
    expect(session.state.activeCell).toBe("r0c0");
  });
});
