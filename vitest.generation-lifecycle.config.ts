import { defineConfig } from "vitest/config";
import bridge from "./vitest.generation-bridge.config.ts";

// P5-43: Node-only contracts. No Cloudflare test plugin, setup, D1 or network.
export default defineConfig({
  test: { environment: "node", include: [
    ...(bridge.test?.include ?? []),
    "workers/app/generation-context-codec.test.ts",
    "workers/app/generation-lifecycle.test.ts",
    "workers/app/generation-domain.test.ts",
    "workers/app/generation-domain-codec.test.ts",
  ] },
});
