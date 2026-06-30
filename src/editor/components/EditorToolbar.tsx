import { Fragment, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'
import { useToolbar, type ToolbarButton } from '../hooks/useToolbar'

export interface EditorToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Override the container class — restyle without forking (Level 1/2). */
  className?: string
  /** Extra items appended after the feature contributions. */
  extraItems?: ToolbarItem[]
  /** Show only a subset of contributions (e.g. a marks-only bubble menu). */
  filter?: (item: ToolbarItem) => boolean
  /** Override how each button renders, keeping the live state (Level 2). */
  renderButton?: (button: ToolbarButton) => ReactNode
  /** Arbitrary custom controls appended at the end (Level 2 slot). */
  children?: ReactNode
}

/**
 * Default toolbar skin over {@link useToolbar}. Renders the registry's
 * contributions, but every part is overridable — `className` to restyle,
 * `renderButton` to change markup, `children` to drop in custom controls,
 * and a feature's own `ToolbarItem.render` to ship a bespoke control. For a
 * totally different toolbar, skip this and use `useToolbar` directly.
 */
export function EditorToolbar({
  editor,
  api,
  resolved,
  className,
  extraItems,
  filter,
  renderButton,
  children,
}: EditorToolbarProps) {
  const buttons = useToolbar(editor, api, resolved, extraItems)
  const shown = filter ? buttons.filter((button) => filter(button.item)) : buttons

  return (
    <div className={className ?? 'editor-toolbar'} role="toolbar" aria-label="Formatting">
      {shown.map((button) => {
        // A feature can ship its own control.
        if (button.item.render) {
          return <Fragment key={button.item.id}>{button.item.render({ editor, api })}</Fragment>
        }
        // The consumer can override the default button markup.
        if (renderButton) {
          return <Fragment key={button.item.id}>{renderButton(button)}</Fragment>
        }
        return <DefaultButton key={button.item.id} button={button} />
      })}
      {children}
    </div>
  )
}

function DefaultButton({ button }: { button: ToolbarButton }) {
  const { item, active, disabled, run } = button
  return (
    <button
      type="button"
      className="editor-toolbar__btn"
      data-group={item.group}
      aria-label={item.label}
      aria-pressed={active}
      disabled={disabled}
      title={item.label}
      // Keep the selection while clicking the button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {item.icon ?? item.label}
    </button>
  )
}
