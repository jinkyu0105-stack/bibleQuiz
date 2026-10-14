import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./admin-menu.module.css";

type Box = { x: number; y: number; width: number; height: number };
type Selection = Box & { icon: Box | null };
const itemSelector = "[data-admin-menu-item]";

function measureSelection(nav: HTMLElement, item: HTMLElement | null): Selection | null {
  if (!item || !item.getClientRects().length) return null;
  const parent = nav.getBoundingClientRect(), box = item.getBoundingClientRect();
  const icon = item.querySelector<HTMLElement>("[data-admin-menu-icon]")?.getBoundingClientRect();
  return {
    x: box.left - parent.left, y: box.top - parent.top, width: box.width, height: box.height,
    icon: icon ? { x: icon.left - box.left, y: icon.top - box.top, width: icon.width, height: icon.height } : null,
  };
}

/** Shared selection surface for admin navigation, topics and workflow steps. */
export function AdminMenu({ label, selectionKey, className = "", children }: {
  label: string; selectionKey: string; className?: string | undefined; children: ReactNode;
}) {
  const navigation = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  function show(item: HTMLElement | null) {
    const nav = navigation.current;
    // Locked workflow steps never acquire the travelling, actionable surface.
    const target = item?.matches(':disabled, [aria-disabled="true"]') ? nav?.querySelector<HTMLElement>(`${itemSelector}[aria-current]`) ?? null : item;
    setSelection(nav ? measureSelection(nav, target) : null);
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
      setSelection(measureSelection(nav, item));
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
    {selection && <span className={styles.selection} data-admin-menu-selection aria-hidden="true" style={{ transform: `translate(${selection.x}px, ${selection.y}px)`, width: selection.width, height: selection.height }}>
      {selection.icon && <span className={styles.iconSurface} data-admin-menu-icon-surface style={{ left: selection.icon.x, top: selection.icon.y, width: selection.icon.width, height: selection.icon.height }}/>}
    </span>}
    {children}
  </nav>;
}

export function AdminMenuIcon({ children }: { children: ReactNode }) {
  return <span className={styles.icon} data-admin-menu-icon aria-hidden="true">{children}</span>;
}
