import { createContext, useContext, useLayoutEffect, useId, useRef, useSyncExternalStore } from "react";
import { WorkflowSave, type SavePart } from "./workflow-save";
export const SaveContext = createContext<WorkflowSave | null>(null);
export function useWorkflowSave() {
  const store = useContext(SaveContext);
  if (!store) throw new Error("Workflow save controls require their provider.");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, state };
}
/** Also used by the existing autosave hook; non-weekly screens keep their own writer. */
export function useWorkflowSavePart(part: SavePart) {
  const store = useContext(SaveContext);
  const id = useId(), current = useRef(part);
  useLayoutEffect(() => {
    current.current = part;
    store?.set(id, part);
  });
  useLayoutEffect(() => () => store?.remove(id), [store, id]);
  return (mode: "auto" | "manual" = "manual") => store ? store.saveOne(id, mode) : current.current.save();
}
