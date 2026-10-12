import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const localPersistPath = process.env.BIBLEQUIZ_E2E_D1_PATH ?? process.env.BIBLEQUIZ_LOCAL_D1_PATH;

export default defineConfig(({ command }) => {
  const localDemo = process.env.BIBLEQUIZ_LOCAL_ADMIN_DEMO === "true";
  const demoConfig = process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG?.replaceAll("\\", "/").endsWith("/.wrangler/local-demo/wrangler.jsonc");
  if ((localDemo || demoConfig) && (command !== "serve" || !localDemo || !demoConfig || !process.env.BIBLEQUIZ_LOCAL_D1_PATH?.replaceAll("\\", "/").endsWith("/.wrangler/ui-demo-state"))) throw new Error("로컬 관리자 시험 모드는 전용 저장소의 개발 서버에서만 실행할 수 있습니다.");
  return {
    plugins: [
      ...(localDemo ? [{
        name: "local-demo-browser",
        transformIndexHtml() { return [{ tag: "script", injectTo: "head" as const, children: "window.__BIBLEQUIZ_TEST_TURNSTILE__ = () => ({outcome: 'ready', token: location.pathname.startsWith('/privacy') ? 'local-demo-privacy_request' : 'local-demo-quiz_submission'}); document.title = '[로컬 연습] ' + document.title;" }]; },
      }] : []),
      react(),
      tailwindcss(),
      cloudflare({
        ...(localPersistPath ? { persistState: { path: localPersistPath } } : {}),
        ...(process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG
          ? { configPath: process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG }
          : {}),
      }),
    ],
  };
});
