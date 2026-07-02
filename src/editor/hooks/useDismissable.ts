import { useEffect, useRef, type RefObject } from 'react'

type MaybeRef = RefObject<HTMLElement | null>

/**
 * The dismiss contract every floating surface shares — capture-phase outside
 * click (so it wins over ProseMirror's own mousedown handling) + Escape, and
 * optionally scroll/resize for surfaces anchored to fixed page coordinates
 * that would drift. One owner, so behavior fixes land once instead of once
 * per popover: the context menu, the color picker and the merge-field modal
 * all sit on this hook, and a feature shipping its own popover should too.
 *
 * `refs` are the elements that count as "inside" (e.g. the popover AND the
 * button that toggles it, so the toggle doesn't insta-reopen).
 */
export function useDismissable(
  refs: MaybeRef | readonly MaybeRef[],
  onClose: () => void,
  options: { closeOnScroll?: boolean; enabled?: boolean } = {},
): void {
  const { closeOnScroll = false, enabled = true } = options
  // Latest refs/callback without re-subscribing every render.
  const refsRef = useRef(refs)
  refsRef.current = refs
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const close = () => onCloseRef.current()
    const onDown = (event: MouseEvent) => {
      const current = refsRef.current
      const list = Array.isArray(current) ? current : [current as MaybeRef]
      const inside = list.some((ref) => ref.current?.contains(event.target as Node))
      if (!inside) close()
    }
    const onKey = (event: KeyboardEvent) => {
      // Consume Escape so ONE surface closes per press, not every open one.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    document.addEventListener('mousedown', onDown, true)
    // Capture phase: ProseMirror consumes Escape (preventDefault) inside the
    // editable, which would starve a bubble-phase listener — capture runs
    // first. The defaultPrevented check still layers multiple dismissables.
    document.addEventListener('keydown', onKey, true)
    if (closeOnScroll) {
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
    }
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      if (closeOnScroll) {
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('resize', close)
      }
    }
  }, [enabled, closeOnScroll])
}
