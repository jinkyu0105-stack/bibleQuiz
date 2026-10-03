import { loadEnv } from "vite";

// Match Vite's production-mode .env loading without printing any values.
const env = loadEnv("production", process.cwd(), "VITE_");
const siteKey = env.VITE_TURNSTILE_SITE_KEY;

if (typeof siteKey !== "string" || siteKey.trim().length === 0) {
  console.error(
    "Preview build 중단: VITE_TURNSTILE_SITE_KEY가 없습니다. " +
    "Workers Builds의 공개 Site key 설정을 확인하세요. 값 자체를 로그에 출력하지 마세요.",
  );
  process.exitCode = 1;
} else if (siteKey !== siteKey.trim() || /\s/.test(siteKey)) {
  console.error("Preview build 중단: VITE_TURNSTILE_SITE_KEY에 공백이 포함되어 있습니다.");
  process.exitCode = 1;
}
