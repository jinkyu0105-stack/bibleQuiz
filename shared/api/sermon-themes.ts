import { z } from "zod";

export const sermonMonthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u);
export const sermonThemeTextSchema = z.string().trim().max(120).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), "한 줄로 입력해 주세요.");
export const sermonThemeSchema = z.strictObject({
  month: sermonMonthSchema,
  theme: sermonThemeTextSchema,
  revision: z.iso.datetime().nullable(),
});
export const saveSermonThemeSchema = z.strictObject({
  theme: sermonThemeTextSchema,
  expectedRevision: z.iso.datetime().nullable(),
});
export type SermonTheme = z.infer<typeof sermonThemeSchema>;
