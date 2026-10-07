import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const localPersistPath = process.env.BIBLEQUIZ_E2E_D1_PATH ?? process.env.BIBLEQUIZ_LOCAL_D1_PATH;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      ...(localPersistPath ? { persistState: { path: localPersistPath } } : {}),
      ...(process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG
        ? { configPath: process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG }
        : {}),
    }),
  ],
});
