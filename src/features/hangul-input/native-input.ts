import { reduceInput } from "./controller";
import type { InputAction, InputGrid, InputState, InputTransition } from "./types";

/** Synchronous DOM bridge: native event ordering must not wait for a React render. */
export function connectNativeInput(
  element: HTMLInputElement,
  grid: InputGrid,
  initial: InputState,
  onTransition: (transition: InputTransition) => void,
) {
  let state = initial;
  let nativeBufferDeletion = false;
  const cleanups: (() => void)[] = [];
  const window = element.ownerDocument.defaultView;
  const hasCoarsePointer = window?.matchMedia("(pointer: coarse)").matches === true;
  function dispatch(action: InputAction, event?: Event): InputTransition {
    const transition = reduceInput(grid, state, action);
    state = transition.state;
    if (transition.preventDefault && event?.cancelable) event.preventDefault();
    if (!state.isComposing && transition.bufferValue !== undefined) {
      element.value = transition.bufferValue;
      element.setSelectionRange(element.value.length, element.value.length);
    }
    onTransition(transition);
    return transition;
  }
  function listen<K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void) {
    element.addEventListener(type, listener);
    cleanups.push(() => element.removeEventListener(type, listener));
  }
  listen("compositionstart", () => dispatch({ type: "compositionstart" }));
  // The following input event carries the up-to-date whole buffer. Do not invent
  // a combined syllable from CompositionEvent.data and the preceding snapshot.
  listen("compositionupdate", (event) => dispatch({ type: "compositionupdate", text: element.value || (event as CompositionEvent).data }));
  listen("compositionend", (event) => dispatch({
    type: "compositionend", value: element.value, data: (event as CompositionEvent).data,
    retainLastCommittedCell: hasCoarsePointer,
  }));
  listen("beforeinput", (event) => {
    if (event.inputType === "deleteContentBackward" && hasCoarsePointer && !state.isComposing
      && state.buffer.value.length > 0 && element.value === state.buffer.value) {
      // The iOS Korean keyboard has no composition session. It replaces the
      // last syllable by performing a real DOM delete followed by insertText.
      // Let the input own both edits so its next whole-value snapshot remains
      // authoritative; treating this beforeinput as app Backspace loses the
      // stable buffer anchor before the replacement arrives.
      nativeBufferDeletion = true;
      return;
    }
    nativeBufferDeletion = false;
    dispatch({ type: "beforeinput", inputType: event.inputType, isComposing: event.isComposing, cancelable: event.cancelable }, event);
  });
  listen("input", (event) => {
    const input = event as InputEvent;
    if (input.inputType === "deleteContentBackward" && nativeBufferDeletion) {
      nativeBufferDeletion = false;
      dispatch({
        type: "input", value: element.value, data: input.data, inputType: "insertText", isComposing: false,
        retainLastCommittedCell: hasCoarsePointer,
      }, event);
      return;
    }
    nativeBufferDeletion = false;
    dispatch({
      type: "input", value: element.value, data: input.data, inputType: input.inputType ?? "insertText",
      isComposing: input.isComposing === true, retainLastCommittedCell: hasCoarsePointer,
    }, event);
  });
  listen("keydown", (event) => dispatch({
    type: "keydown", key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
    metaKey: event.metaKey, altKey: event.altKey, isComposing: event.isComposing, keyCode: event.keyCode,
  }, event));
  listen("paste", (event) => {
    if (event.clipboardData) dispatch({ type: "paste", text: event.clipboardData.getData("text/plain") }, event);
  });
  const isExplicitCompositionCancellation = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const choice = target.closest("[data-composition-cancel]");
    // Re-clicking the already active crossing cell remains an application
    // direction command. Only another cell is the explicit cancellation route.
    return choice !== null && (choice.getAttribute("data-cell") === null || choice.getAttribute("data-cell") !== state.activeCell);
  };
  const guardComposition = (event: Event) => {
    if (!state.isComposing || event.target === element) return;
    // Only the user's direct choice of another grid cell or a difficulty tab
    // abandons the IME's raw text. All app commands remain unavailable while
    // composing, so they cannot create an accidental move or save.
    if (isExplicitCompositionCancellation(event)) {
      if (event.type === "pointerdown") dispatch({ type: "compositioncancel" }, event);
      return;
    }
    if (event.cancelable) event.preventDefault();
    if (event.type === "click") event.stopPropagation();
    onTransition({ state, preventDefault: true, notices: [{ code: "COMPOSITION_ACTIVE" }] });
  };
  // Prevent a tab/button/link pointer action from blurring the IME before its
  // click handler gets a chance to inspect composition state.
  for (const type of ["pointerdown", "click"] as const) {
    element.ownerDocument.addEventListener(type, guardComposition, true);
    cleanups.push(() => element.ownerDocument.removeEventListener(type, guardComposition, true));
  }
  return { dispatch, getState: () => state, destroy: () => cleanups.forEach((cleanup) => cleanup()) };
}
