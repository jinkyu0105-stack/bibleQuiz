import { defineConfig } from "vitest/config";

// P40-G01: pure contracts and existing memory-domain regressions. No Worker,
// migration setup, D1, network provider, or deployed binding is initialized.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "workers/app/generation-bridge.test.ts",
      "workers/app/sermon-intent.test.ts",
      "workers/app/sermon-summary.test.ts",
      "workers/app/sermon-candidates.test.ts",
      "workers/app/candidate-placement.test.ts",
      "workers/app/ai-draft-provider.test.ts",
      "workers/app/transcript-corrections.test.ts",
    ],
  },
});
