import { useEffect, useEffectEvent, useRef } from "react";
import { useWorkflowSavePart } from "./useWorkflowSave";
/** Use the existing version-checked writer once per changed draft. Failures wait
 * for an explicit retry or a new edit; they never loop in the background. */
export function useAutosave(signature:string|null,enabled:boolean,save:()=>Promise<boolean>, scope: "server" | "browser" = "server") {
  const attempted=useRef<string|null>(null);
  const saveNow = useWorkflowSavePart({ signature, enabled, scope, save: async () => {
    attempted.current = signature;
    return save();
  } });
  const perform=useEffectEvent(()=>saveNow("auto"));
  useEffect(()=>{
    if(!signature||!enabled||attempted.current===signature)return;
    const timer=window.setTimeout(()=>{if(attempted.current!==signature){attempted.current=signature;void perform();}},900);
    return()=>window.clearTimeout(timer);
  },[signature,enabled]);
  useEffect(()=>{
    if(!signature)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[signature]);
  return () => saveNow("manual");
}
