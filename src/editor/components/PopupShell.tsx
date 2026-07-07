import { useRef, type ComponentProps, type ReactNode } from 'react'
import Paper from '@mui/material/Paper'
import Popper, { type PopperProps } from '@mui/material/Popper'
import { useDismissable } from '../hooks/useDismissable'
import { POPUP_CLASS } from '../base.styles'
import { tokenVar } from '../theme'

/**
 * The SDK's NON-modal floating surface: Popper (portal + positioning, no
 * backdrop, no focus trap — the editor keeps focus/selection, chips stay
 * draggable) + Paper, with `useDismissable` as the dismiss owner. Every
 * non-modal popover rides this shell so two product invariants live in ONE
 * place instead of per-surface comments:
 *
 * - The `document-editor-popup` MARKER always rides the Popper ROOT — the
 *   header/footer region gate reads it to keep an open region open for
 *   clicks inside the surface (and there is no backdrop to mis-mark).
 * - The anchor element counts as "inside" for dismissal, so toggling the
 *   trigger doesn't close-then-instantly-reopen.
 *
 * Modal MUI surfaces (the context menu's Menu) do NOT use this — they own
 * their dismissal and only coordinate Escape via `useEscapeSurface`.
 */
export function PopupShell({
  anchorEl,
  dismissEl,
  open,
  onClose,
  surfaceClassName,
  role,
  ariaLabel,
  placement = 'bottom-start',
  offset,
  isOutsideClick,
  popperProps,
  paperProps,
  children,
}: {
  /** Popper anchor — an element or a virtual `{ getBoundingClientRect }`. */
  anchorEl: PopperProps['anchorEl']
  /** The element treated as "inside" for outside-click dismissal (the toggle
   *  button). Defaults to `anchorEl` when that is a real element — pass this
   *  explicitly when the Popper anchor is VIRTUAL. */
  dismissEl?: HTMLElement | null
  open: boolean
  onClose: () => void
  /** Surface class(es) appended after the marker, e.g. 'color-picker'. */
  surfaceClassName: string
  role: string
  ariaLabel: string
  placement?: PopperProps['placement']
  /** [skidding, distance] offset from the anchor. */
  offset?: [number, number]
  /** Narrower exit rule (e.g. the pinned panel ignores outside clicks). */
  isOutsideClick?: (target: Node) => boolean
  popperProps?: Partial<Omit<PopperProps, 'open' | 'anchorEl' | 'placement'>>
  paperProps?: ComponentProps<typeof Paper> & { component?: React.ElementType }
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef<HTMLElement | null>(null)
  dismissRef.current = dismissEl ?? (anchorEl instanceof HTMLElement ? anchorEl : null)
  useDismissable([cardRef, dismissRef], onClose, { enabled: open, isOutsideClick })

  const { sx: paperSx, ...paperRest } = paperProps ?? {}
  return (
    <Popper
      ref={cardRef}
      open={open}
      anchorEl={anchorEl}
      placement={placement}
      modifiers={offset ? [{ name: 'offset', options: { offset } }] : undefined}
      className={`${POPUP_CLASS} ${surfaceClassName}`}
      role={role}
      aria-label={ariaLabel}
      {...popperProps}
    >
      <Paper
        sx={[
          { borderRadius: '12px', boxShadow: tokenVar('--editor-shadow-pop') },
          ...(Array.isArray(paperSx) ? paperSx : paperSx ? [paperSx] : []),
        ]}
        {...paperRest}
      >
        {children}
      </Paper>
    </Popper>
  )
}
