// isWellFormed is native in the supported Worker runtime. Keep the ES2023
// fallback for other consumers without changing text or accepting lone surrogates.
const nativeIsWellFormed = (String.prototype as string & {
  isWellFormed?: (this: string) => boolean;
}).isWellFormed;

export function isWellFormedText(text: string): boolean {
  return nativeIsWellFormed ? nativeIsWellFormed.call(text) : !/[\uD800-\uDFFF]/u.test(text);
}
