import { Fragment, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ToolbarItem } from '../core/types'
import type { ToolbarButton } from '../hooks/useToolbar'

/**
 * INTERNAL: the one rendering pipeline behind {@link EditorToolbar} and
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
  orientation,
  iconFallback,
  hideWhenEmpty = false,
}: {
  editor: Editor | null
  api: EditorApi
  buttons: ToolbarButton[]
  filter?: (item: ToolbarItem) => boolean
  renderButton?: (button: ToolbarButton) => ReactNode
  children?: ReactNode
  className: string
  buttonClassName: string
  ariaLabel: string
  orientation?: 'vertical'
  /** What the default button shows when the item has no icon. */
  iconFallback: (item: ToolbarItem) => ReactNode
  hideWhenEmpty?: boolean
}) {
  const shown = filter ? buttons.filter((button) => filter(button.item)) : buttons
  if (hideWhenEmpty && shown.length === 0 && !children) return null

  return (
    <div className={className} role="toolbar" aria-orientation={orientation} aria-label={ariaLabel}>
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
  button: ToolbarButton
  className: string
  iconFallback: (item: ToolbarItem) => ReactNode
}) {
  const { item, active, disabled, run } = button
  return (
    <button
      type="button"
      className={className}
      data-group={item.group}
      aria-label={item.label}
      aria-pressed={active}
      disabled={disabled}
      title={item.label}
      // Keep the selection while clicking the button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {item.icon ?? iconFallback(item)}
    </button>
  )
}
