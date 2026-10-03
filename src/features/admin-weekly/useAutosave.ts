import { useEffect, useEffectEvent, useRef } from "react";
/** Use the existing version-checked writer once per changed draft. Failures wait
 * for an explicit retry or a new edit; they never loop in the background. */
export function useAutosave(signature:string|null,enabled:boolean,save:()=>Promise<unknown>) {
  const attempted=useRef<string|null>(null);
  const perform=useEffectEvent(()=>save());
  useEffect(()=>{
    if(!signature||!enabled||attempted.current===signature)return;
    const timer=window.setTimeout(()=>{attempted.current=signature;void perform();},900);
    return()=>window.clearTimeout(timer);
  },[signature,enabled]);
  useEffect(()=>{
    if(!signature)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[signature]);
}
