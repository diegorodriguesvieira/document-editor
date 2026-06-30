import { Fragment, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'
import { useInsertBar, type ToolbarButton } from '../hooks/useToolbar'

export interface InsertToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Extra items appended after the feature contributions. */
  extraItems?: ToolbarItem[]
  /** Show only a subset of inserts. */
  filter?: (item: ToolbarItem) => boolean
  /** Override how each button renders, keeping the live state. */
  renderButton?: (button: ToolbarButton) => ReactNode
  className?: string
  /** Domain insert actions appended below the built-ins (e.g. merge field). */
  children?: ReactNode
}

/**
 * Vertical "insert" rail to the left of the page — now the same registry-driven,
 * headless skin as {@link EditorToolbar}, just vertical and reading the
 * `resolved.inserts` channel. A feature contributes inserts via
 * `FeatureDefinition.insert`, so the rail is pure opt-in. Renders `null` when
 * there's nothing to show.
 */
export function InsertToolbar({
  editor,
  api,
  resolved,
  extraItems,
  filter,
  renderButton,
  className,
  children,
}: InsertToolbarProps) {
  const buttons = useInsertBar(editor, api, resolved, extraItems)
  const shown = filter ? buttons.filter((button) => filter(button.item)) : buttons

  if (shown.length === 0 && !children) return null

  return (
    <div
      className={className ?? 'insert-rail'}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Insert"
    >
      {shown.map((button) => {
        if (button.item.render) {
          return <Fragment key={button.item.id}>{button.item.render({ editor, api })}</Fragment>
        }
        if (renderButton) {
          return <Fragment key={button.item.id}>{renderButton(button)}</Fragment>
        }
        return <InsertButton key={button.item.id} button={button} />
      })}
      {children}
    </div>
  )
}

function InsertButton({ button }: { button: ToolbarButton }) {
  const { item, active, disabled, run } = button
  return (
    <button
      type="button"
      className="insert-rail__btn"
      data-group={item.group}
      aria-label={item.label}
      aria-pressed={active}
      disabled={disabled}
      title={item.label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {item.icon ?? item.label.charAt(0)}
    </button>
  )
}
