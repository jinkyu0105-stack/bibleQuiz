import { useState, type ReactNode } from "react";
import { WorkflowSave } from "./workflow-save";
import { SaveContext } from "./useWorkflowSave";
export function WorkflowSaveProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new WorkflowSave());
  return <SaveContext value={store}>{children}</SaveContext>;
}
