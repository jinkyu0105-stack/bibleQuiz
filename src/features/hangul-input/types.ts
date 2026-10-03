import type { Direction } from "../../../shared/puzzle/types";

export interface InputEntry {
  readonly id: string;
  readonly direction: Direction;
  readonly cellIds: readonly string[];
}

export interface InputCell {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly entryIds: readonly string[];
}

export interface InputGrid {
  readonly cells: ReadonlyMap<string, InputCell>;
  readonly entries: ReadonlyMap<string, InputEntry>;
  readonly cellAt: ReadonlyMap<string, string>;
  readonly entryOrder: readonly string[];
}

export interface InputState {
  readonly activeCell: string;
  readonly activeEntry: string;
  readonly direction: Direction;
  /** Index within the active entry, not a DOM UTF-16 caret offset. */
  readonly selectionIndex: number;
  readonly cellValues: ReadonlyMap<string, string>;
  readonly compositionText: string;
  readonly isComposing: boolean;
  /** Full native buffer snapshot; its anchor does not follow automatic movement. */
  readonly buffer: {
    readonly entryId: string;
    readonly startIndex: number;
    readonly value: string;
    readonly cellCount: number;
  };
}

export type InputAction =
  | { type: "compositionstart" }
  | { type: "compositionupdate"; text: string }
  | { type: "compositionend"; value: string; data?: string | null; retainLastCommittedCell?: boolean }
  /** An explicit pointer choice abandons only the native IME's uncommitted text. */
  | { type: "compositioncancel" }
  | { type: "beforeinput"; inputType: string; isComposing: boolean; cancelable: boolean }
  | { type: "input"; value: string; data?: string | null; inputType: string; isComposing: boolean; retainLastCommittedCell?: boolean }
  | { type: "keydown"; key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }
  | { type: "select-cell"; cellId: string }
  | { type: "select-entry"; entryId: string }
  | { type: "move"; step: -1 | 1 }
  | { type: "toggle-direction" }
  | { type: "paste"; text: string };

export type InputNotice =
  | { code: "COMPOSITION_ACTIVE" }
  | { code: "INVALID_SELECTION" }
  | { code: "ENTRY_BOUNDARY" }
  | { code: "NO_CROSSING" }
  | { code: "INVALID_HANGUL_SYLLABLE"; containsLatin?: true }
  | { code: "ENTRY_END" }
  | { code: "ENTRY_OVERFLOW"; omittedCount: number };

export interface InputTransition {
  readonly state: InputState;
  readonly preventDefault: boolean;
  /** Write to the native input only when present. Never returned during composition. */
  readonly bufferValue?: string;
  readonly notices: readonly InputNotice[];
}
