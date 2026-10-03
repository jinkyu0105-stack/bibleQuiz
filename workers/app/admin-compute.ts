import { DurableObject } from "cloudflare:workers";
import { failure } from "../../shared/api/envelope";
import { app, type AppBindings } from "./app";

export interface AdminComputeBindings extends AppBindings {
  ADMIN_COMPUTE?: DurableObjectNamespace<AdminCompute> | undefined;
  ADMIN_COMPUTE_ENABLED?: string;
}

export function isAdminPath(path: string) {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

/** Fixed shards bound object creation. One resource always uses the same shard;
 * different sections still arrive as independent requests with their own budget.
 * Neither authentication values nor private content are used as object names. */
export function adminComputeShard(path: string): string {
  const resource = /^\/api\/admin\/(sermons|quiz-sets|submissions)\/([^/]+)/u.exec(path);
  if (!resource) return "admin-v1-global";
  const key = `${resource[1]}/${resource[2]}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `admin-v1-${(hash >>> 0) % 8}`;
}

/** Internal binding only. Authentication and all existing SQL/command guards
 * run here on every request. D1 stays the source of truth: no result/token cache,
 * alarms, background retry, copied data, or durable storage writes are added. */
export class AdminCompute extends DurableObject<AdminComputeBindings> {
  override fetch(request: Request): Promise<Response> | Response {
    if (!isAdminPath(new URL(request.url).pathname)) return new Response(null, { status: 404 });
    return app.fetch(request, this.env, {
      waitUntil: promise => this.ctx.waitUntil(promise),
      // An internal DO has no origin server to pass the request to.
      passThroughOnException: () => { throw new Error("ADMIN_COMPUTE_PASSTHROUGH_UNSUPPORTED"); },
      props: this.ctx.props,
    });
  }
}

export async function fetchWithAdminCompute(
  request: Request,
  bindings: AdminComputeBindings,
  context: ExecutionContext,
) {
  const path = new URL(request.url).pathname;
  if (!isAdminPath(path) || bindings.ADMIN_COMPUTE_ENABLED !== "true") {
    return app.fetch(request, bindings, context);
  }
  try {
    if (!bindings.ADMIN_COMPUTE) throw new Error("ADMIN_COMPUTE_UNAVAILABLE");
    // Pass the body and response through as streams. Parsing here would put
    // the expensive work back in the ordinary Worker's 10ms invocation.
    return await bindings.ADMIN_COMPUTE.getByName(adminComputeShard(path)).fetch(request);
  } catch {
    // A failed response may follow a committed write. Never replay the command
    // through the ordinary app handler or issue an automatic second DO request.
    const requestId = crypto.randomUUID();
    return Response.json(failure({ code: "ADMIN_COMPUTE_UNAVAILABLE",
      message: "관리자 요청을 확인하지 못했습니다. 화면을 새로 조회해 상태를 확인해 주세요.", requestId }),
    { status: 503, headers: { "Cache-Control": "private, no-store", "x-request-id": requestId } });
  }
}
