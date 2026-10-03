import config from './playwright.config';
import {defineConfig} from '@playwright/test';
// The existing local synthetic Vite server can be reused. Operations requests
// are intercepted by this suite; no remote environment or actual DB is used.
export default defineConfig({...config,testMatch:'admin-operations.spec.ts',webServer:{...config.webServer,command:'node scripts/start-e2e-server.mjs',url:'http://127.0.0.1:4173/api/health',reuseExistingServer:true}});
