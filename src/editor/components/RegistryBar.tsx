import { Fragment, type ReactNode } from 'react'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { BarItemBase } from '../core/types'
import type { BarButton } from '../hooks/useBar'

/**
 * INTERNAL: the one rendering pipeline behind {@link BubbleBar} and
 * {@link InsertToolbar} (render precedence: a feature's own `render` → the
 * consumer's `renderButton` → the default button; then the `children` slot).
 * Not exported from the barrel — the public components are the API, this just
 * keeps their behavior from diverging.
 */
export function RegistryBar({
  editor,
  api,
  buttons,
  filter,
  renderButton,
  children,
  className,
  buttonClassName,
  ariaLabel,
  iconFallback,
  hideWhenEmpty = false,
}: {
  editor: Editor | null
  api: EditorApi
  buttons: BarButton[]
  filter?: (item: BarItemBase) => boolean
  renderButton?: (button: BarButton) => ReactNode
  children?: ReactNode
  className: string
  buttonClassName: string
  ariaLabel: string
  /** What the default button shows when the item has no icon. */
  iconFallback: (item: BarItemBase) => ReactNode
  hideWhenEmpty?: boolean
}) {
  const shown = filter ? buttons.filter((button) => filter(button.item)) : buttons
  if (hideWhenEmpty && shown.length === 0 && !children) return null

  return (
    <div className={className} role="toolbar" aria-label={ariaLabel}>
      {shown.map((button) => {
        // A feature can ship its own control.
        if (button.item.render) {
          return <Fragment key={button.item.id}>{button.item.render({ editor, api })}</Fragment>
        }
        // The consumer can override the default button markup.
        if (renderButton) {
          return <Fragment key={button.item.id}>{renderButton(button)}</Fragment>
        }
        return (
          <DefaultButton
            key={button.item.id}
            button={button}
            className={buttonClassName}
            iconFallback={iconFallback}
          />
        )
      })}
      {children}
    </div>
  )
}

function DefaultButton({
  button,
  className,
  iconFallback,
}: {
  button: BarButton
  className: string
  iconFallback: (item: BarItemBase) => ReactNode
}) {
  const { item, active, disabled, run } = button
  const common = {
    className,
    'data-group': item.group,
    'aria-label': item.label,
    disabled,
    title: item.label,
    // Keep the selection while clicking the button.
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: run,
  }
  const content = item.icon ?? iconFallback(item)
  // Only TOGGLES announce a pressed state (MUI emits aria-pressed from
  // `selected`) — an action button (insert Table, Undo…) with
  // aria-pressed="false" would read as a stuck toggle.
  return item.isActive ? (
    <ToggleButton value={item.id} selected={active} {...common}>
      {content}
    </ToggleButton>
  ) : (
    <IconButton {...common}>{content}</IconButton>
  )
}
