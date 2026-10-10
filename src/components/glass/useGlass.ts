import { useLayoutEffect, useRef } from "react";
import { mountGlassComponents } from "../../../docs/design/phase-9/sky-v2/components/glass.js";

/** Each React owner enhances only its own element, so nested panels never double mount. */
export function useGlass<T extends HTMLElement>(structure = "") {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const glass = mountGlassComponents(ref.current, { descendants: false });
    return () => glass.destroy();
  }, [structure]);
  return ref;
}
