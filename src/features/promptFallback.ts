/**
 * The payload-or-prompt idiom shared by the example features (link, image,
 * comments): commands take a typed payload — tests and custom controls pass
 * it — and fall back to a bare `window.prompt` as placeholder UI. Real apps
 * replace the prompt by shipping a `render` control that calls
 * `api.exec(id, payload)` (see ColorFeature). One home, so swapping the
 * prompt for a dialog happens once.
 */
export function promptOr(value: unknown, message: string): string {
  if (typeof value === 'string') return value
  return typeof window !== 'undefined' ? (window.prompt(message) ?? '') : ''
}
