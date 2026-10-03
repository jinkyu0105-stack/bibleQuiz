import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const e2ePersistPath = process.env.BIBLEQUIZ_E2E_D1_PATH;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      ...(e2ePersistPath ? { persistState: { path: e2ePersistPath } } : {}),
      ...(process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG
        ? { configPath: process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG }
        : {}),
    }),
  ],
});
