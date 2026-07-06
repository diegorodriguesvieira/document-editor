/**
 * The payload-or-prompt idiom shared by the example features (link, image,
 * comments): commands take a typed payload — tests and custom controls pass
 * it — and fall back to a bare `window.prompt` as placeholder UI. One home,
 * so swapping the prompt for a dialog happens once.
 *
 * `null` means the user CANCELLED the prompt (Escape) — callers must abort,
 * never treat it as a submitted empty string. `''` is a deliberate empty
 * submit (e.g. link.set clears the link on it).
 */
export function promptOr(value: unknown, message: string): string | null {
  if (typeof value === 'string') return value
  return typeof window !== 'undefined' ? window.prompt(message) : null
}
