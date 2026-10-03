import { isCompleteHangulSyllable } from "../../../shared/puzzle/hangul";
import { coordinateKey } from "./grid";
import type { InputAction, InputGrid, InputNotice, InputState, InputTransition } from "./types";

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

function isRawHangulJamo(value: string) {
  return /^[\u1100-\u11FF\u3130-\u318F]+$/u.test(value);
}

function isCompleteHangulText(value: string) {
  return value.length > 0 && Array.from(segmenter.segment(value.normalize("NFC")), (part) => part.segment).every(isCompleteHangulSyllable);
}

function result(
  state: InputState,
  preventDefault = false,
  notices: readonly InputNotice[] = [],
  bufferValue?: string,
): InputTransition {
  return { state, preventDefault, notices, ...(bufferValue === undefined ? {} : { bufferValue }) };
}

function select(grid: InputGrid, state: InputState, entryId: string, index: number): InputTransition {
  const entry = grid.entries.get(entryId);
  const cell = entry?.cellIds[index];
  if (!entry || cell === undefined) return result(state, true, [{ code: "INVALID_SELECTION" }]);
  return result({
    ...state,
    activeCell: cell,
    activeEntry: entry.id,
    direction: entry.direction,
    selectionIndex: index,
    compositionText: "",
    buffer: { entryId: entry.id, startIndex: index, value: "", cellCount: 0 },
  }, true, [], "");
}

function move(grid: InputGrid, state: InputState, step: -1 | 1): InputTransition {
  const entry = grid.entries.get(state.activeEntry)!;
  const index = state.selectionIndex + step;
  if (index < 0 || index >= entry.cellIds.length) {
    return result(state, true, [{ code: "ENTRY_BOUNDARY" }]);
  }
  return select(grid, state, entry.id, index);
}

function toggle(grid: InputGrid, state: InputState): InputTransition {
  const otherId = grid.cells.get(state.activeCell)!.entryIds.find((id) => id !== state.activeEntry);
  if (otherId === undefined) return result(state, true, [{ code: "NO_CROSSING" }]);
  const entry = grid.entries.get(otherId)!;
  return select(grid, state, entry.id, entry.cellIds.indexOf(state.activeCell));
}

function backspace(grid: InputGrid, state: InputState): InputTransition {
  if (!state.cellValues.has(state.activeCell)) return move(grid, state, -1);
  const cellValues = new Map(state.cellValues);
  cellValues.delete(state.activeCell);
  return select(grid, { ...state, cellValues }, state.activeEntry, state.selectionIndex);
}

/** Re-project a full buffer at its stable anchor, never append event.data twice. */
function commit(grid: InputGrid, state: InputState, value: string, retainLastCommittedCell = false): InputTransition {
  const idle = { ...state, isComposing: false, compositionText: "" };
  if (value === state.buffer.value) return result(idle);
  const syllables = Array.from(segmenter.segment(value.normalize("NFC")), (part) => part.segment);
  if (syllables.some((part) => !isCompleteHangulSyllable(part))) {
    return result(idle, false, [{
      code: "INVALID_HANGUL_SYLLABLE",
      ...(/[a-z]/iu.test(value) ? { containsLatin: true as const } : {}),
    }], state.buffer.value);
  }

  const entry = grid.entries.get(state.buffer.entryId)!;
  const start = state.buffer.startIndex;
  const available = entry.cellIds.length - start;
  const count = Math.min(syllables.length, available);
  const cellValues = new Map(state.cellValues);
  for (let offset = 0; offset < Math.max(count, state.buffer.cellCount); offset += 1) {
    const id = entry.cellIds[start + offset]!;
    if (offset < count) cellValues.set(id, syllables[offset]!);
    else cellValues.delete(id);
  }
  // iOS Korean input exposes a complete syllable before later replacing it
  // with its final-consonant form. On a touch keyboard, keeping selection on
  // the last committed syllable avoids announcing the next cell too early.
  const lastCommittedIndex = count === 0 ? start : start + count - 1;
  const selectionIndex = retainLastCommittedCell
    ? Math.min(lastCommittedIndex, entry.cellIds.length - 1)
    : Math.min(start + count, entry.cellIds.length - 1);
  const notices: InputNotice[] = [];
  if (syllables.length > available) notices.push({ code: "ENTRY_OVERFLOW", omittedCount: syllables.length - available });
  if (count === available) notices.push({ code: "ENTRY_END" });
  return result({
    ...idle,
    activeCell: entry.cellIds[selectionIndex]!,
    activeEntry: entry.id,
    direction: entry.direction,
    selectionIndex,
    cellValues,
    buffer: { ...state.buffer, value, cellCount: count },
  }, false, notices);
}

function keydown(grid: InputGrid, state: InputState, action: Extract<InputAction, { type: "keydown" }>): InputTransition {
  // These keys belong to the OS candidate window while composing, including Enter.
  if (state.isComposing || action.isComposing || action.keyCode === 229) return result(state);
  if (action.ctrlKey || action.metaKey || action.altKey) return result(state);
  if (action.key === "Tab") {
    const moved = move(grid, state, action.shiftKey ? -1 : 1);
    // Let native Tab leave the grid at an entry boundary, avoiding a focus trap.
    return { ...moved, preventDefault: moved.notices.length === 0 };
  }
  if (action.key === "Backspace") return backspace(grid, state);
  if (action.key === "Enter") {
    if (grid.cells.get(state.activeCell)!.entryIds.length > 1) return toggle(grid, state);
    const index = grid.entryOrder.indexOf(state.activeEntry);
    return select(grid, state, grid.entryOrder[(index + 1) % grid.entryOrder.length]!, 0);
  }
  const offsets: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0],
  };
  const offset = Object.hasOwn(offsets, action.key) ? offsets[action.key] : undefined;
  if (offset) {
    const current = grid.cells.get(state.activeCell)!;
    const targetId = grid.cellAt.get(coordinateKey(current.row + offset[0], current.column + offset[1]));
    if (targetId === undefined) return result(state, true, [{ code: "ENTRY_BOUNDARY" }]);
    const cell = grid.cells.get(targetId)!;
    const entryId = cell.entryIds.find((id) => grid.entries.get(id)!.direction === state.direction) ?? cell.entryIds[0]!;
    const entry = grid.entries.get(entryId)!;
    return select(grid, state, entry.id, entry.cellIds.indexOf(cell.id));
  }
  return result(state);
}

/** DOM-free reducer. Pass snapshots from one native input; see README for adapter obligations. */
export function reduceInput(grid: InputGrid, state: InputState, action: InputAction): InputTransition {
  switch (action.type) {
    case "compositionstart":
      return result({ ...state, isComposing: true, compositionText: "" });
    case "compositionupdate":
      return result({ ...state, isComposing: true, compositionText: action.text });
    case "compositionend":
      return commit(grid, state, action.value || action.data || state.compositionText, action.retainLastCommittedCell);
    case "compositioncancel":
      if (!state.isComposing) return result(state);
      // Keep the last committed buffer and never turn raw jamo into a cell value.
      return result({ ...state, isComposing: false, compositionText: "" }, false, [], state.buffer.value);
    case "keydown":
      return keydown(grid, state, action);
    case "beforeinput":
      if (action.isComposing || state.isComposing) {
        return result({ ...state, isComposing: true });
      }
      if (action.inputType === "deleteContentBackward" && action.cancelable) return backspace(grid, state);
      return result(state);
    case "input":
      {
        const value = action.value || (action.data ? `${state.buffer.value}${action.data}` : "");
      if (action.isComposing || state.isComposing) {
          // iOS can emit standalone compatibility jamo without composition events.
          // Its next input snapshot is the completed syllable, which commits here.
          if (!action.isComposing && state.isComposing && action.data && isCompleteHangulText(value)) {
            return commit(grid, state, value, action.retainLastCommittedCell);
          }
        return result({ ...state, isComposing: true, compositionText: value || state.compositionText });
      }
      if (action.inputType === "deleteContentBackward") {
        const deleted = backspace(grid, state);
        // Non-cancelable beforeinput has already changed the DOM. Restore it even
        // when an empty boundary cell leaves application selection unchanged.
        return { ...deleted, bufferValue: deleted.bufferValue ?? state.buffer.value };
      }
        const appendedJamo = state.buffer.value && value.startsWith(state.buffer.value)
          ? value.slice(state.buffer.value.length)
          : "";
        if (action.data && isRawHangulJamo(appendedJamo)) {
          return result({ ...state, isComposing: true, compositionText: value });
        }
        if (action.data && isRawHangulJamo(value)) return result({ ...state, isComposing: true, compositionText: value });
      // iOS Safari can report insertText.data while leaving a transparent
      // programmatically-focused input's value snapshot empty.
        return commit(grid, state, value, action.retainLastCommittedCell);
      }
  }

  if (state.isComposing) return result(state, true, [{ code: "COMPOSITION_ACTIVE" }]);
  switch (action.type) {
    case "move":
      return move(grid, state, action.step);
    case "toggle-direction":
      return toggle(grid, state);
    case "select-entry":
      return select(grid, state, action.entryId, 0);
    case "select-cell": {
      const cell = grid.cells.get(action.cellId);
      if (!cell) return result(state, true, [{ code: "INVALID_SELECTION" }]);
      if (cell.id === state.activeCell && cell.entryIds.length > 1) return toggle(grid, state);
      const entryId = cell.entryIds.find((id) => grid.entries.get(id)!.direction === state.direction) ?? cell.entryIds[0]!;
      return select(grid, state, entryId, grid.entries.get(entryId)!.cellIds.indexOf(cell.id));
    }
    case "paste": {
      if (action.text.length === 0) return result(state, true);
      const anchored = select(grid, state, state.activeEntry, state.selectionIndex).state;
      const pasted = commit(grid, anchored, action.text);
      if (pasted.notices.some((notice) => notice.code === "INVALID_HANGUL_SYLLABLE")) {
        return result(state, true, pasted.notices);
      }
      return { ...pasted, preventDefault: true, bufferValue: action.text };
    }
  }
}
