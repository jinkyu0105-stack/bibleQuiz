import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "./app";
import { success,failure } from "../../shared/api/envelope";
import { readSameOriginJson,MutationRequestError } from "../_shared/http/mutation-request";
import { readBackups,requestBackup,BackupError } from "../_shared/services/backup-storage";
import { readOperationsUsage,refreshOperationsUsage,confirmOperationsMonth,OperationsError } from "../_shared/services/operations-usage";
import { manual, memberAuth } from "../_shared/manual-content";
export const operationsRoutes=new Hono<AppEnvironment>();
const paths=["/api/admin/usage-summary","/api/admin/usage-summary/refresh","/api/admin/operations/monthly-check","/api/admin/backups","/api/admin/manual","/api/admin/manual/future/member-auth"];
operationsRoutes.use("*",async(c,next)=>{
  if(!paths.includes(c.req.path)){await next();return;}
  c.header("Cache-Control","private, no-store");
  if(new URL(c.req.url).search) return c.json(failure({code:"INVALID_OPERATIONS_REQUEST",message:"검색 조건을 사용할 수 없습니다.",requestId:c.get("requestId")}),400);
  await next();
});
operationsRoutes.get("/api/admin/usage-summary",async c=>c.json(success(await readOperationsUsage(c.env))));
operationsRoutes.post("/api/admin/usage-summary/refresh",async c=>{
  z.strictObject({}).parse(await readSameOriginJson(c.req.raw));
  return c.json(success(await refreshOperationsUsage(c.env)));
});
operationsRoutes.post("/api/admin/operations/monthly-check",async c=>c.json(success(await confirmOperationsMonth(c.env,await readSameOriginJson(c.req.raw),c.get("accessIdentity").email))));
operationsRoutes.get("/api/admin/backups",async c=>c.json(success(await readBackups(c.env))));
operationsRoutes.post("/api/admin/backups",async c=>c.json(success(await requestBackup(c.env,await readSameOriginJson(c.req.raw))),202));
operationsRoutes.get("/api/admin/manual",c=>c.json(success({markdown:manual,updatedAt:"2026-10-03",verification:"운영 문서 · 검증 기록은 P8-02",deployment:`${c.env.OPERATIONS_ENVIRONMENT??"미연결"} · version ${z.uuid().safeParse(c.env.CF_VERSION_METADATA?.id).success?c.env.CF_VERSION_METADATA!.id:"미연결"}`})));
operationsRoutes.get("/api/admin/manual/future/member-auth",c=>c.json(success({markdown:memberAuth,updatedAt:"2026-10-03",verification:"향후 검토 문서",deployment:`${c.env.OPERATIONS_ENVIRONMENT??"미연결"} · version ${z.uuid().safeParse(c.env.CF_VERSION_METADATA?.id).success?c.env.CF_VERSION_METADATA!.id:"미연결"}`})));
for(const path of paths)operationsRoutes.all(path,c=>c.json(failure({code:"METHOD_NOT_ALLOWED",message:"지원하지 않는 요청 방식입니다.",requestId:c.get("requestId")}),405));
operationsRoutes.onError((error,c)=>{
  const code=error instanceof MutationRequestError?error.code:error instanceof BackupError||error instanceof OperationsError?error.code:error instanceof z.ZodError?"INVALID_OPERATIONS_REQUEST":"OPERATIONS_UNAVAILABLE";
  const status=error instanceof MutationRequestError?error.status:error instanceof z.ZodError?400:code.endsWith("CONFLICT")?409:503;
  return c.json(failure({code,message:code==="BACKUP_NOT_CONNECTED"?"백업 실행이 꺼져 있거나 연결 설정이 부족합니다. 운영 설정을 확인해 주세요.":code==="METRICS_REFRESH_BUSY"?"사용량을 갱신 중입니다. 잠시 후 다시 조회해 주세요.":"운영 기록을 확인하지 못했습니다. 기존 자료를 보존하고 다시 조회해 주세요.",requestId:c.get("requestId")}),status);
});
