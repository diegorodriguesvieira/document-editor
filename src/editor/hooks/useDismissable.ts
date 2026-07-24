import { useEffect, useRef, type RefObject } from 'react'

type MaybeRef = RefObject<HTMLElement | null>

/**
 * Escape closes surfaces innermost-first — with FOCUS as the tiebreaker:
 * capture-phase listeners on document fire in registration order, so without
 * coordination a long-lived surface (e.g. an open header/footer region) would
 * swallow the Escape meant for a popover opened after it. Each enabled
 * instance registers here; the surface whose root CONTAINS the focused
 * element closes per press (with two composers open, Escape must not destroy
 * the one the user is NOT typing in), falling back to the most recently
 * enabled surface when focus sits in none of them.
 */
interface EscapeEntry {
  /** null = an external owner (MUI modal, suggestion popup) — everyone yields. */
  close: (() => void) | null
  owns: (node: Node) => boolean
}

const escapeStack: EscapeEntry[] = []

/**
 * Non-React surfaces join the same innermost-first Escape coordination (the
 * caret suggestion popups live in TipTap plugin callbacks, not components).
 * While the returned marker tops the stack, every `useDismissable` instance
 * leaves Escape alone — no close, no preventDefault — so the unprevented
 * event reaches the surface's OWN exit handler (Suggestion's, for popups).
 * Returns an idempotent unregister; call it on the surface's exit.
 */
export function registerEscapeSurface(): () => void {
  const marker: EscapeEntry = { close: null, owns: () => false }
  escapeStack.push(marker)
  return () => {
    const index = escapeStack.indexOf(marker)
    if (index >= 0) escapeStack.splice(index, 1)
  }
}

/**
 * React face of {@link registerEscapeSurface} for surfaces whose Escape is
 * owned by SOMEONE ELSE — an MUI Menu/Popover/Dialog handles its own
 * `onClose(…, 'escapeKeyDown')`. While `enabled`, the older useDismissable
 * surfaces (an open page region, the pinned variables panel) yield the press
 * instead of closing in the newer surface's place.
 */
export function useEscapeSurface(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return registerEscapeSurface()
  }, [enabled])
}

/**
 * The dismiss contract every floating surface shares — capture-phase outside
 * click (so it wins over ProseMirror's own mousedown handling) + Escape, and
 * optionally scroll/resize for surfaces anchored to fixed page coordinates
 * that would drift. One owner, so behavior fixes land once instead of once
 * per popover: the color picker, the variables panel (variable-chip), the
 * prompt forms and open page regions (header/footer) all sit on this hook —
 * usually through PopupShell — and a feature shipping its own popover should
 * too. A surface whose dismissal MUI already owns (Menu/Popover/Dialog)
 * coordinates via {@link useEscapeSurface} instead.
 *
 * `refs` are the elements that count as "inside" (e.g. the popover AND the
 * button that toggles it, so the toggle doesn't insta-reopen).
 *
 * `isOutsideClick` replaces the default "not inside refs" test when a surface
 * has a narrower exit rule — e.g. a page region that closes on clicks
 * elsewhere in the document but stays open for toolbar/popover clicks.
 */
export function useDismissable(
  refs: MaybeRef | readonly MaybeRef[],
  onClose: () => void,
  options: {
    closeOnScroll?: boolean
    enabled?: boolean
    isOutsideClick?: (target: Node) => boolean
  } = {},
): void {
  const { closeOnScroll = false, enabled = true } = options
  // Latest refs/callbacks without re-subscribing every render.
  const refsRef = useRef(refs)
  refsRef.current = refs
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const isOutsideClickRef = useRef(options.isOutsideClick)
  isOutsideClickRef.current = options.isOutsideClick

  useEffect(() => {
    if (!enabled) return
    const close = () => onCloseRef.current()
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      const custom = isOutsideClickRef.current
      if (custom) {
        if (custom(target)) close()
        return
      }
      const current = refsRef.current
      const list = Array.isArray(current) ? current : [current as MaybeRef]
      const inside = list.some((ref) => ref.current?.contains(target))
      if (!inside) close()
    }
    const entry: EscapeEntry = {
      close,
      owns: (node) => {
        const current = refsRef.current
        const list = Array.isArray(current) ? current : [current as MaybeRef]
        return list.some((ref) => ref.current?.contains(node) ?? false)
      },
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const top = escapeStack[escapeStack.length - 1]
      // An external owner (MUI modal, suggestion popup) tops the stack —
      // yield the press entirely.
      if (!top || top.close == null) return
      // FOCUS decides: the surface holding the focused element closes; when
      // focus sits in none, the most recently enabled surface does.
      const active = document.activeElement
      let chosen = top
      if (active) {
        for (let index = escapeStack.length - 1; index >= 0; index--) {
          const candidate = escapeStack[index]
          if (candidate.close != null && candidate.owns(active)) {
            chosen = candidate
            break
          }
        }
      }
      if (chosen !== entry) return
      event.preventDefault()
      close()
    }
    escapeStack.push(entry)
    document.addEventListener('mousedown', onDown, true)
    // Capture phase: ProseMirror consumes Escape (preventDefault) inside the
    // editable, which would starve a bubble-phase listener — capture runs
    // first. The defaultPrevented check still layers with other consumers.
    document.addEventListener('keydown', onKey, true)
    if (closeOnScroll) {
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
    }
    return () => {
      const index = escapeStack.indexOf(entry)
      if (index >= 0) escapeStack.splice(index, 1)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      if (closeOnScroll) {
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('resize', close)
      }
    }
  }, [enabled, closeOnScroll])
}
