import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prepareInputSchema, prepareReadSchema } from "../_shared/services/prepare-input-schema";
import { sermonInputCommandSchema } from "../_shared/services/sermon-input";
import { inputEventSchema } from "../_shared/repositories/sermon-input-store";

describe("private input schema initialization", () => {
  it("initializes built-in scalar checks without accepting a document", () => {
    const text = z.string().min(1).regex(/^[a-z]+$/u);
    const version = z.int().positive();
    const textParse = vi.spyOn(text, "safeParse");
    const numberParse = vi.spyOn(version, "safeParse");
    const schema = z.strictObject({ text, version });
    prepareInputSchema(schema);
    expect(textParse).toHaveBeenCalledExactlyOnceWith("");
    expect(numberParse).toHaveBeenCalledExactlyOnceWith(0);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ text: "", version: 0 }).success).toBe(false);
    expect(schema.parse({ text: "valid", version: 1 })).toEqual({ text: "valid", version: 1 });
  });
  it("returns the same schema, initializes shared children once and never runs a valid-data refinement", () => {
    const refinement = vi.fn(() => true);
    const child = z.strictObject({ text: z.string() }).refine(refinement);
    const parse = vi.spyOn(child, "safeParse");
    const schema = z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("a"), items: z.array(child) }),
      z.strictObject({ action: z.literal("b"), selected: child.nullable().optional() }),
    ]);
    expect(prepareInputSchema(schema)).toBe(schema);
    prepareInputSchema(schema);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith({}, { jitless: true });
    expect(refinement).not.toHaveBeenCalled();
    expect(schema.parse({ action: "a", items: [{ text: "TEST_ONLY" }] })).toEqual({ action: "a", items: [{ text: "TEST_ONLY" }] });
    expect(refinement).toHaveBeenCalledTimes(1);
  });

  it("preserves strict rejection and cloned results after preparation", () => {
    const create = () => z.strictObject({ items: z.array(z.strictObject({ id: z.string().regex(/^[a-z]+$/u) })), optional: z.string().optional() });
    const original = create(), prepared = prepareInputSchema(create());
    for (const input of [null, undefined, {}, { items: [] }, { items: [{ id: "valid" }] }, { items: [{ id: 5 }] }, { items: [{ id: "wrong!" }] }, { items: [], secret: "TEST_ONLY" }]) {
      const before = original.safeParse(input), after = prepared.safeParse(input);
      expect(after.success).toBe(before.success);
      if (before.success && after.success) expect(after.data).toEqual(before.data);
      if (!before.success && !after.success) expect(after.error.issues).toEqual(before.error.issues);
    }
    const input = { items: [{ id: "valid" }] };
    const parsed = prepared.parse(input);
    input.items[0]!.id = "changed";
    expect(parsed.items[0]!.id).toBe("valid");
  });

  it("does not treat the initialization inputs as accepted commands or stored metadata", () => {
    for (const schema of [sermonInputCommandSchema, inputEventSchema]) {
      expect(schema.safeParse(undefined).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(sermonInputCommandSchema.safeParse({ action: "confirm", expectedVersion: 1, sourceId: "s", documentId: "d", documentSha256: "a".repeat(64), reviewed: false }).success).toBe(false);
  });
});

it("prepares read objects without running scalar/object refinements or accepted sample values", () => {
  const scalar = vi.fn(() => true), object = vi.fn(() => true);
  const create = () => z.strictObject({ items: z.array(z.strictObject({ text: z.string().refine(scalar) }).refine(object)),
    optional: z.strictObject({ text: z.string() }).nullable().optional(), record: z.record(z.string(), z.strictObject({ text: z.string() })).default({}) });
  const original = create(), prepared = prepareReadSchema(create());
  expect(scalar).not.toHaveBeenCalled(); expect(object).not.toHaveBeenCalled();
  for (const input of [undefined, {}, { items: [] }, { items: [{ text: "TEST_ONLY" }] }, { items: [{ text: 5 }] }, { items: [], private: true }]) {
    const before = original.safeParse(input), after = prepared.safeParse(input);
    expect(after.success).toBe(before.success);
    if (before.success && after.success) expect(after.data).toEqual(before.data);
    if (!before.success && !after.success) expect(after.error.issues).toEqual(before.error.issues);
  }
});
