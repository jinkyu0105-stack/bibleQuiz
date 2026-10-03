/** Reading localStorage itself can throw in privacy-restricted browsers. */
export function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
