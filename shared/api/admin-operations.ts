import { z } from "zod";
import { serviceIds } from "../../src/config/service-registry";
export const serviceIdSchema=z.enum(serviceIds);
export const metricSchema=z.strictObject({
  buildLimitReached:z.number().int().min(0).max(1).nullable().optional(),
  requests:z.number().nonnegative().nullable().optional(),cpuMs:z.number().nonnegative().nullable().optional(),resourceErrors:z.number().nonnegative().nullable().optional(),
  storageBytes:z.number().nonnegative().nullable().optional(),objectCount:z.number().nonnegative().nullable().optional(),classA:z.number().nonnegative().nullable().optional(),classB:z.number().nonnegative().nullable().optional(),
  rowsRead:z.number().nonnegative().nullable().optional(),rowsWritten:z.number().nonnegative().nullable().optional(),
  steps:z.number().nonnegative().nullable().optional(),instances:z.number().nonnegative().nullable().optional(),failures:z.number().nonnegative().nullable().optional(),retries:z.number().nonnegative().nullable().optional(),
  durationGbSeconds:z.number().nonnegative().nullable().optional(),buildMinutes:z.number().nonnegative().nullable().optional(),activeSeats:z.number().nonnegative().nullable().optional(),
  costMicroUsd:z.number().nonnegative().nullable().optional(),unknownCalls:z.number().nonnegative().nullable().optional(),inputTokens:z.number().nonnegative().nullable().optional(),outputTokens:z.number().nonnegative().nullable().optional(),audioSeconds:z.number().nonnegative().nullable().optional(),
});
export const usageItemSchema=z.strictObject({service:serviceIdSchema,scope:z.enum(["account","project","bucket","database"]),scopeId:z.string().max(128),
  periodStart:z.iso.datetime(),periodEnd:z.iso.datetime(),fetchedAt:z.iso.datetime().nullable(),source:z.enum(["app_events","cloudflare_graphql","provider_api","configured"]),
  metrics:metricSchema,status:z.enum(["comfortable","check","warning","delayed"]),errorCode:z.string().regex(/^[A-Z_]+$/u).nullable()});
export const operationsUsageSchema=z.strictObject({items:z.array(usageItemSchema),yearMonth:z.string().regex(/^\d{4}-\d{2}$/u),policyCheckNeeded:z.boolean(),checkedAt:z.iso.datetime().nullable(),pricingVersion:z.string(),
  openAiModels:z.array(z.strictObject({model:z.string().max(128),calls:z.number().int().nonnegative(),inputTokens:z.number().nonnegative(),outputTokens:z.number().nonnegative(),audioSeconds:z.number().nonnegative(),costMicroUsd:z.number().nonnegative(),unknownCalls:z.number().int().nonnegative()}))});
export const backupKindSchema=z.enum(["weekly","pre_migration","manual","deletion_manifest"]);
export const backupParamsSchema=z.strictObject({runId:z.uuid(),kind:backupKindSchema,requestedAt:z.iso.datetime()});
export const backupRequestSchema=z.strictObject({requestKey:z.uuid(),kind:z.enum(["manual","pre_migration"]),confirmation:z.literal("export_may_pause_database")});
export const backupListSchema=z.strictObject({enabled:z.boolean(),weeklyVerifiedCount:z.number().int().nonnegative(),items:z.array(z.strictObject({id:z.uuid(),kind:backupKindSchema,status:z.enum(["queued","running","verified","failed","rotated"]),startedAt:z.iso.datetime(),completedAt:z.iso.datetime().nullable(),sizeBytes:z.number().int().positive().nullable(),checksumPrefix:z.string().regex(/^[a-f0-9]{12}$/u).nullable(),errorCode:z.string().regex(/^[A-Z_]+$/u).nullable()})),manifestUpdatedAt:z.iso.datetime().nullable()});
export const backupAcceptedSchema=z.strictObject({runId:z.uuid(),outcome:z.enum(["started","replayed"])});
export const monthlyCheckSchema=z.strictObject({yearMonth:z.string().regex(/^\d{4}-\d{2}$/u),pricingVersion:z.string(),checkedServices:z.array(serviceIdSchema),confirmation:z.literal("official_policies_reviewed")});
