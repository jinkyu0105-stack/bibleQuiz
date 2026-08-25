import type { ApiResponse } from "../../../shared/api/envelope";

export interface HealthData {
  service: "biblequiz-app";
  status: "ok";
  timestamp: string;
}

function isHealthData(value: unknown): value is HealthData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    data.service === "biblequiz-app" &&
    data.status === "ok" &&
    typeof data.timestamp === "string"
  );
}

export async function getHealth(): Promise<HealthData> {
  const response = await fetch("/api/health", {
    headers: { accept: "application/json" },
  });
  const body = (await response.json()) as ApiResponse<unknown>;

  if (!response.ok || !("data" in body) || !isHealthData(body.data)) {
    throw new Error("백엔드 상태를 확인하지 못했습니다.");
  }

  return body.data;
}
