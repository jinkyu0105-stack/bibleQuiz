import { useLayoutEffect, useRef } from "react";
import { useLocation, type Location } from "react-router-dom";

type ScrollController = { commit(location: Location): void; destroy(): void };

/** Keep Router history/restoration; only animate deliberate same-page links and wheel sections. */
export function useHomeSectionScroll(home: boolean) {
  const location = useLocation();
  const controller = useRef<ScrollController | null>(null);
  useLayoutEffect(() => {
    if (!home) return;
    const current = installHomeScroll();
    controller.current = current;
    return () => { current.destroy(); controller.current = null; };
  }, [home]);
  // Parent layout effects run after ScrollRestoration. Restore the captured start
  // before paint, then animate; deep links and Back/Forward keep Router's position.
  useLayoutEffect(() => { controller.current?.commit(location); }, [location]);
}

function installHomeScroll(): ScrollController {
  const root = document.documentElement;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  let frame = 0, direction = 0, lastWheel = -Infinity, intent = 0, suppressMomentum = false;
  let pending: { hash: string; search: string; from: number } | null = null;
  const maxScroll = () => Math.max(0, root.scrollHeight - innerHeight);
  const clamp = (top: number) => Math.max(0, Math.min(maxScroll(), top));
  const jump = (top: number) => window.scrollTo({ top, behavior: "instant" });
  function cancel() {
    cancelAnimationFrame(frame); frame = 0;
    delete root.dataset.homeScrollAnimating;
  }
  function animate(top: number, from = scrollY) {
    cancel();
    const destination = clamp(top), distance = destination - from;
    if (reduced.matches || Math.abs(distance) < 2) { jump(destination); return; }
    root.dataset.homeScrollAnimating = "true";
    jump(from);
    const started = performance.now();
    // A full section takes 1.2s; the longer footer return gets a little more time.
    const duration = Math.min(1600, Math.max(900, Math.abs(distance) / innerHeight * 1200));
    function tick(now: number) {
      const progress = Math.min(1, (now - started) / duration);
      const ease = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      jump(from + distance * ease);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { jump(destination); cancel(); }
    }
    frame = requestAnimationFrame(tick);
  }
  function syncMode() {
    cancel();
    root.dataset.homeScroll = fine.matches ? "managed" : "native";
  }
  syncMode();
  reduced.addEventListener("change", syncMode, { signal });
  fine.addEventListener("change", syncMode, { signal });

  function nestedScroll(target: EventTarget | null, delta: number) {
    if (!(target instanceof Element)) return false;
    if (target.closest("input, textarea, select, [contenteditable=true], dialog") || document.querySelector("dialog[open]")) return true;
    for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
      if (element.scrollHeight <= element.clientHeight + 1 || !/(auto|scroll)/u.test(getComputedStyle(element).overflowY)) continue;
      if (delta > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0) return true;
    }
    return false;
  }
  function wheelTarget(delta: number) {
    const y = scrollY;
    const sections = [...document.querySelectorAll<HTMLElement>("#home-view > section, .home-shell .site-footer")].map(element => {
      const box = element.getBoundingClientRect();
      return { start: clamp(box.top + y), end: clamp(box.bottom + y - innerHeight) };
    });
    let index = sections.findLastIndex(section => section.start <= y + 2);
    if (index < 0) index = 0;
    const section = sections[index];
    if (!section) return null;
    if (delta > 0) {
      // Read tall sections naturally, but do not skip their last content on a big wheel tick.
      if (y < section.end - 2) return y + delta >= section.end ? section.end : null;
      return sections[index + 1]?.start ?? null;
    }
    if (y > section.start + 2) {
      if (section.end > section.start + 2) return y + delta <= section.start ? section.start : null;
      return section.start;
    }
    const previous = sections[index - 1];
    return previous ? Math.max(previous.start, previous.end) : null;
  }
  window.addEventListener("wheel", event => {
    if (reduced.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1);
    if (!delta || nestedScroll(event.target, delta)) return;
    const now = performance.now(), nextDirection = Math.sign(delta);
    const continuing = nextDirection === direction && now - lastWheel < 160;
    lastWheel = now;
    if (!continuing) suppressMomentum = false;
    if (frame && nextDirection === direction) { event.preventDefault(); return; }
    if (frame) cancel();
    const destination = wheelTarget(delta);
    if (destination === null || Math.abs(destination - scrollY) < 2) { intent = 0; direction = nextDirection; return; }
    event.preventDefault();
    // Consume momentum from the same gesture after landing instead of skipping another section.
    if (continuing && suppressMomentum) return;
    intent = continuing ? intent + delta : delta;
    direction = nextDirection;
    if (Math.abs(intent) < 36) return;
    intent = 0; suppressMomentum = true;
    animate(destination);
  }, { passive: false, signal });

  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target || link.hasAttribute("download") || link.classList.contains("skip-link")) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !["#weekly", "#main-content"].includes(url.hash)) return;
    pending = { hash: url.hash, search: url.search, from: scrollY };
  }, { capture: true, signal });
  const interrupt = () => { cancel(); intent = 0; pending = null; };
  window.addEventListener("pointerdown", interrupt, { passive: true, signal });
  window.addEventListener("touchstart", interrupt, { passive: true, signal });
  window.addEventListener("keydown", interrupt, { signal });
  window.addEventListener("resize", interrupt, { signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) interrupt(); }, { signal });
  return {
    commit(next) {
      cancel();
      const requested = pending; pending = null;
      if (!requested || next.hash !== requested.hash || next.search !== requested.search) return;
      const element = document.getElementById(next.hash.slice(1));
      if (element) animate(element.getBoundingClientRect().top + scrollY, requested.from);
    },
    destroy() { cancel(); lifetime.abort(); delete root.dataset.homeScroll; },
  };
}
