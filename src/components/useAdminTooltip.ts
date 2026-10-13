import { useEffect, useId, useRef, type PointerEvent } from "react";

function positionBubble(trigger: HTMLElement, bubble: HTMLSpanElement) {
  const anchor = trigger.getBoundingClientRect(), box = bubble.getBoundingClientRect();
  const desiredLeft = bubble.hasAttribute("data-compact") ? anchor.left + (anchor.width - box.width) / 2 : anchor.left;
  const left = Math.max(12, Math.min(desiredLeft, window.innerWidth - box.width - 12));
  const above = anchor.top - box.height - 8;
  const below = Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - box.height - 12));
  bubble.dataset.side = above >= 12 ? "above" : "below";
  bubble.style.setProperty("--pointer-x", `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - left, box.width - 12))}px`);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${above >= 12 ? above : below}px`;
}

/** Both vocabulary and compact icon tips use the same above-first placement. */
export function useAdminTooltip<T extends HTMLElement>() {
  const id = useId(), trigger = useRef<T>(null), bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false), focused = useRef(false);
  function show() {
    clearTimeout(timer.current);
    if (!trigger.current || !bubble.current) return;
    if (!bubble.current.matches(":popover-open")) bubble.current.showPopover();
    positionBubble(trigger.current, bubble.current);
  }
  function leave() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current && bubble.current?.matches(":popover-open")) bubble.current.hidePopover();
    }, 160);
  }
  useEffect(() => {
    const reposition = () => {
      if (!bubble.current?.matches(":popover-open") || !trigger.current) return;
      const box = trigger.current.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) bubble.current.hidePopover();
      else positionBubble(trigger.current, bubble.current);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, []);
  return { id, triggerRef: trigger, bubbleRef: bubble, show, triggerEvents: {
    onPointerEnter: (event: PointerEvent<T>) => { if (event.pointerType !== "touch") { hovered.current = true; show(); } },
    onPointerLeave: () => { hovered.current = false; leave(); },
    onFocus: () => { focused.current = true; show(); },
    onBlur: () => { focused.current = false; leave(); },
  }, bubbleEvents: {
    onPointerEnter: () => { hovered.current = true; clearTimeout(timer.current); },
    onPointerLeave: () => { hovered.current = false; leave(); },
  } };
}
