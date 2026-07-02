import { type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'
import { useToolbar, type ToolbarButton } from '../hooks/useToolbar'
import { RegistryBar } from './RegistryBar'

export interface EditorToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Override the container class — restyle without forking (Level 1/2). */
  className?: string
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
  filter,
  renderButton,
  children,
}: EditorToolbarProps) {
  const buttons = useToolbar(editor, api, resolved)
  return (
    <RegistryBar
      editor={editor}
      api={api}
      buttons={buttons}
      filter={filter}
      renderButton={renderButton}
      className={className ?? 'editor-toolbar'}
      buttonClassName="editor-toolbar__btn"
      ariaLabel="Formatting"
      iconFallback={(item) => item.label}
    >
      {children}
    </RegistryBar>
  )
}
