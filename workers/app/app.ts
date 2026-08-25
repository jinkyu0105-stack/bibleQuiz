import { Hono } from "hono";

import { failure, success } from "../../shared/api/envelope";

interface AppVariables {
  requestId: string;
}

interface HealthData {
  service: "biblequiz-app";
  status: "ok";
  timestamp: string;
}

export const app = new Hono<{ Variables: AppVariables }>();

app.use("/api/*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("x-request-id", requestId);
});

app.get("/api/health", (context) => {
  return context.json(
    success<HealthData>({
      service: "biblequiz-app",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );
});

app.notFound((context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();

  return context.json(
    failure({
      code: "NOT_FOUND",
      message: "요청한 API를 찾을 수 없습니다.",
      requestId,
    }),
    404,
  );
});

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  return context.json(
    failure({
      code: "INTERNAL_ERROR",
      message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }),
    500,
  );
});
