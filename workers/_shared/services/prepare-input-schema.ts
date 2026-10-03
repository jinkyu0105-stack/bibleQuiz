import { ZodObject, ZodUnion, ZodDiscriminatedUnion, ZodArray, ZodNullable, ZodOptional, ZodDefault, ZodRecord, ZodString, ZodNumber, type z } from "zod";

const prepared = new WeakSet<z.core.$ZodType>();

/** Prepare this private, synchronous schema graph at module initialization.
 * Only public Zod APIs are used. Required fields / discriminators are absent and
 * intentionally rejected: no accepted dummy document, hash, DB call or request
 * is executed. Every real input still goes through the unchanged schema.
 * This moves lazy rule setup to startup; it does not eliminate its cost.
 * Scalar leaves in this selected graph must contain built-in checks only;
 * this is not an initializer for arbitrary refinements or transformations.
 */
export function prepareInputSchema<T extends z.core.$ZodType>(schema: T): T {
  if (prepared.has(schema)) return schema;
  prepared.add(schema);
  if (schema instanceof ZodObject) {
    for (const child of Object.values(schema.shape)) prepareInputSchema(child);
    // Both the generic and Worker non-eval object parser prepare their keys here.
    if (schema.safeParse({}, { jitless: true }).success) {
      throw new Error("Input initialization requires a schema with required fields");
    }
  } else if (schema instanceof ZodUnion) {
    for (const option of schema.options) prepareInputSchema(option);
    if (schema instanceof ZodDiscriminatedUnion) {
      // Populate the action/format lookup, without selecting a valid command.
      schema.safeParse({}, { jitless: true });
    }
  } else if (schema instanceof ZodArray) {
    prepareInputSchema(schema.element);
  } else if (schema instanceof ZodNullable || schema instanceof ZodOptional) {
    prepareInputSchema(schema.unwrap());
  } else if (schema instanceof ZodString) {
    // The selected graph contains built-in checks only at scalar leaves.
    // Missing object fields do not initialize regex/length checks; an empty
    // scalar does. It is not an accepted source, command, or stored document.
    schema.safeParse("");
  } else if (schema instanceof ZodNumber) {
    schema.safeParse(0);
  }
  return schema;
}

const preparedReads = new WeakSet<z.core.$ZodType>();
/** Initialize selected read parsers without accepted data or custom callbacks.
 * An undefined object is always rejected before refinements. No request, DB,
 * crypto operation or sample document is executed during Worker startup. */
export function prepareReadSchema<T extends z.core.$ZodType>(schema: T): T {
  if (preparedReads.has(schema)) return schema;
  preparedReads.add(schema);
  if (schema instanceof ZodObject) {
    for (const child of Object.values(schema.shape)) prepareReadSchema(child);
    schema.safeParse(undefined, { jitless: true });
  } else if (schema instanceof ZodUnion) {
    for (const option of schema.options) prepareReadSchema(option);
    if (schema instanceof ZodDiscriminatedUnion) schema.safeParse(undefined, { jitless: true });
  } else if (schema instanceof ZodArray) prepareReadSchema(schema.element);
  else if (schema instanceof ZodRecord) { prepareReadSchema(schema.keyType); prepareReadSchema(schema.valueType); }
  else if (schema instanceof ZodNullable || schema instanceof ZodOptional || schema instanceof ZodDefault) prepareReadSchema(schema.unwrap());
  return schema;
}
