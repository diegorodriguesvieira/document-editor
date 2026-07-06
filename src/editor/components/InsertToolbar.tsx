import { type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'
import { useInsertBar, type ToolbarButton } from '../hooks/useToolbar'
import { RegistryBar } from './RegistryBar'

export interface InsertToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Show only a subset of inserts. */
  filter?: (item: ToolbarItem) => boolean
  /** Override how each button renders, keeping the live state. */
  renderButton?: (button: ToolbarButton) => ReactNode
  className?: string
  /** Domain insert actions appended after the built-ins (e.g. merge field). */
  children?: ReactNode
}

/**
 * The insert ACTIONS row — the editor footer's default content (the fixed
 * bar itself is the footer shell; this also drops into a side panel via
 * `className`). Same registry-driven, headless skin as {@link EditorToolbar},
 * reading the `resolved.inserts` channel. A feature contributes inserts via
 * `FeatureDefinition.insert`, so the row is pure opt-in. Renders `null` when
 * there's nothing to show.
 */
export function InsertToolbar({
  editor,
  api,
  resolved,
  filter,
  renderButton,
  className,
  children,
}: InsertToolbarProps) {
  const buttons = useInsertBar(editor, api, resolved)
  return (
    <RegistryBar
      editor={editor}
      api={api}
      buttons={buttons}
      filter={filter}
      renderButton={renderButton}
      className={className ?? 'insert-dock'}
      buttonClassName="insert-dock__btn"
      ariaLabel="Insert"
      iconFallback={(item) => item.label.charAt(0)}
      hideWhenEmpty
    >
      {children}
    </RegistryBar>
  )
}
