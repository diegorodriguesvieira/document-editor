/**
 * The payload-or-prompt idiom shared by the example features (link, image,
 * comments): commands take a typed payload — the promptForms controls, custom
 * controls and tests pass it — and fall back to a bare `window.prompt` only
 * when exec'd WITHOUT one (keymaps, headless calls). Deliberately kept as the
 * last-resort fallback; the shipped UI is the non-modal forms in
 * promptForms.tsx.
 *
 * `null` means the user CANCELLED the prompt (Escape) — callers must abort,
 * never treat it as a submitted empty string. `''` is a deliberate empty
 * submit (e.g. link.set clears the link on it).
 */
export function promptOr(value: unknown, message: string): string | null {
  if (typeof value === 'string') return value
  return typeof window !== 'undefined' ? window.prompt(message) : null
}
