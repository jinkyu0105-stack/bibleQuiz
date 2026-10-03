import { useEffect, useRef, useState } from "react";

const SCRIPT_ID = "biblequiz-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type ChallengeState = "error" | "expired" | "loading" | "ready" | "unavailable";
type TestChallenge =
  | { outcome: "error" }
  | { outcome: "ready"; token: string };

interface TurnstileApi {
  remove(widgetId: string): void;
  render(container: HTMLElement, options: {
    action: string;
    callback(token: string): void;
    "error-callback"(): void;
    "expired-callback"(): void;
    language: string;
    sitekey: string;
    theme: "auto";
  }): string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    /** Installed only by local browser tests. Production builds ignore it. */
    __BIBLEQUIZ_TEST_TURNSTILE__?: () => TestChallenge;
  }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const fail = (message: string) => {
      script.remove();
      reject(new Error(message));
    };
    const loaded = () => window.turnstile ? resolve(window.turnstile) : fail("Turnstile unavailable");
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => fail("Turnstile load failed"), { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  scriptPromise = loading;
  return loading;
}

function stateText(state: ChallengeState): string {
  switch (state) {
    case "loading": return "사람 확인을 준비하고 있습니다.";
    case "ready": return "사람 확인이 완료되었습니다.";
    case "expired": return "사람 확인 시간이 끝났습니다. 다시 확인해 주세요.";
    case "error": return "사람 확인에 실패했습니다. 다시 시도해 주세요.";
    case "unavailable": return "사람 확인 기능이 아직 준비되지 않았습니다.";
  }
}

export function TurnstileChallenge({
  onState,
  onToken,
  refreshKey,
  action = "quiz_submission",
}: {
  onState(state: ChallengeState): void;
  onToken(token: string | null): void;
  refreshKey: number;
  action?: "quiz_submission" | "privacy_request";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ChallengeState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    const update = (next: ChallengeState, token: string | null = null) => {
      if (!active) return;
      setState(next);
      onState(next);
      onToken(token);
    };
    const testChallenge = import.meta.env.DEV
      ? window.__BIBLEQUIZ_TEST_TURNSTILE__?.()
      : undefined;
    if (testChallenge) {
      queueMicrotask(() => testChallenge.outcome === "ready"
        ? update("ready", testChallenge.token)
        : update("error"));
      return () => { active = false; onToken(null); };
    }

    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
    if (!siteKey) {
      queueMicrotask(() => update("unavailable"));
      return () => { active = false; onToken(null); };
    }

    void loadTurnstile().then((api) => {
      if (!active || !containerRef.current) return;
      widgetId = api.render(containerRef.current, {
        action,
        callback: (token) => update("ready", token),
        "error-callback": () => update("error"),
        "expired-callback": () => update("expired"),
        language: "ko",
        sitekey: siteKey,
        theme: "auto",
      });
    }).catch(() => update("error"));

    return () => {
      active = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onToken(null);
    };
  }, [action, attempt, onState, onToken, refreshKey]);

  return <div className="turnstile-boundary">
    <div ref={containerRef} aria-hidden={state === "unavailable"} />
    <p role="status">{stateText(state)}</p>
    {(state === "error" || state === "expired") && <button type="button" onClick={() => {
      setState("loading");
      setAttempt((value) => value + 1);
    }}>사람 확인 다시 시도</button>}
  </div>;
}
