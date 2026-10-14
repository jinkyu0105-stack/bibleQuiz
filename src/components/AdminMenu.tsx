import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./admin-menu.module.css";

type Selection = { x: number; y: number; width: number; height: number };
const itemSelector = "[data-admin-menu-item]";

/** Shared selection surface for the app navigation and the manual's topic navigation. */
export function AdminMenu({ label, selectionKey, className = "", children }: {
  label: string; selectionKey: string; className?: string | undefined; children: ReactNode;
}) {
  const navigation = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  function show(item: HTMLElement | null) {
    const nav = navigation.current;
    if (!nav || !item || !item.getClientRects().length) { setSelection(null); return; }
    const parent = nav.getBoundingClientRect(), box = item.getBoundingClientRect();
    setSelection({ x: box.left - parent.left, y: box.top - parent.top, width: box.width, height: box.height });
  }
  function restore() {
    show(navigation.current?.querySelector<HTMLElement>(`${itemSelector}[aria-current]`) ?? null);
  }
  useLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const update = () => {
      // Expanding a topic group can resize the nav after focus has moved into it.
      const focused = nav.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>(itemSelector) : null;
      const item = focused ?? nav.querySelector<HTMLElement>(`${itemSelector}[aria-current]`);
      if (!item || !item.getClientRects().length) { setSelection(null); return; }
      const parent = nav.getBoundingClientRect(), box = item.getBoundingClientRect();
      setSelection({ x: box.left - parent.left, y: box.top - parent.top, width: box.width, height: box.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [selectionKey]);

  return <nav ref={navigation} aria-label={label} className={`${styles.menu} ${className}`} data-admin-menu
    onPointerOver={event => { if (event.pointerType !== "touch") { const item = (event.target as HTMLElement).closest<HTMLElement>(itemSelector); if (item) show(item); } }}
    onPointerLeave={restore}
    onFocus={event => { const item = (event.target as HTMLElement).closest<HTMLElement>(itemSelector); if (item) show(item); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) restore(); }}>
    {selection && <span className={styles.selection} data-admin-menu-selection aria-hidden="true" style={{ transform: `translate(${selection.x}px, ${selection.y}px)`, width: selection.width, height: selection.height }}/>}
    {children}
  </nav>;
}

export function AdminMenuIcon({ children }: { children: ReactNode }) {
  return <span className={styles.icon} aria-hidden="true">{children}</span>;
}
