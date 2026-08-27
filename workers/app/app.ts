import { Hono } from "hono";

import { failure, success } from "../../shared/api/envelope";
import { createDatabase } from "../_shared/db/client";
import { createFoundationRepository } from "../_shared/repositories/foundation-repository";

interface AppBindings {
  DB: D1Database;
}

interface AppVariables {
  requestId: string;
}

interface HealthData {
  service: "biblequiz-app";
  status: "ok";
  timestamp: string;
}

interface DatabaseHealthData {
  database: "d1";
  status: "ok";
  timestamp: string;
}

export const app = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

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

app.get("/api/health/database", async (context) => {
  const repository = createFoundationRepository(createDatabase(context.env.DB));
  const isReady = await repository.isDatabaseReady();

  if (!isReady) {
    throw new Error("D1 readiness query returned an invalid result.");
  }

  return context.json(
    success<DatabaseHealthData>({
      database: "d1",
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
