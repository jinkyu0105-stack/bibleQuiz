import { z } from "zod";
export const privacyStatusSchema = z.enum(["received", "reviewing", "resolved", "rejected"]);
const safeText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\p{Cc}\p{Cf}]/u.test(v));
export const privacyFieldsSchema = z.strictObject({ requestType: z.enum(["delete_submission", "privacy_question"]),
  quizSlug: z.string().trim().max(128).nullable(), submittedName: safeText(0, 100).nullable(), message: safeText(2, 1000) });
export const privacyRequestSchema = privacyFieldsSchema.extend({ requestKey: z.uuid(), turnstileToken: z.string().min(1).max(2048) });
export const privacyTokenSchema = z.string().regex(/^PRV-[0-9a-f]{64}$/u);
export const privacyReceiptSchema = z.strictObject({ lookupToken: privacyTokenSchema });
export const privacyViewSchema = z.strictObject({ requestType: z.enum(["delete_submission", "privacy_question"]), createdAt: z.iso.datetime(),
  status: privacyStatusSchema, adminResponse: z.string().nullable() });
export const privacyAdminItemSchema = privacyViewSchema.extend({ id: z.uuid(), quizSlug: z.string().nullable(),
  submittedName: z.string().nullable(), message: z.string(), updatedAt: z.iso.datetime() });
export const privacyAdminListSchema = z.strictObject({ items: z.array(privacyAdminItemSchema) });
export const privacyReplySchema = z.strictObject({ status: privacyStatusSchema, adminResponse: safeText(0, 1000), expectedUpdatedAt: z.iso.datetime() });
export const privacyLabels = { received: "접수됨", reviewing: "확인 중", resolved: "처리 완료", rejected: "처리 불가" } as const;
