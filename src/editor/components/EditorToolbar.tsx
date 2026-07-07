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
  /** Override the container class — restyle without forking. */
  className?: string
  /** Show only a subset of contributions (e.g. a marks-only bubble menu). */
  filter?: (item: ToolbarItem) => boolean
  /** Override how each button renders, keeping the live state. */
  renderButton?: (button: ToolbarButton) => ReactNode
  /** Arbitrary custom controls appended at the end. */
  children?: ReactNode
}

/**
 * The registry-driven button row over {@link useToolbar} — the BUBBLE's
 * content engine and the mock-seam test surface (render it against
 * `createMockEditor` to test toolbar wiring without ProseMirror). The
 * container itself ships unstyled (the product has no static formatting
 * bar); every part is overridable — `className` to restyle, `renderButton`
 * to change markup, `children` for custom controls, and a feature's own
 * `ToolbarItem.render` for bespoke ones. For a totally different toolbar,
 * skip this and use `useToolbar` directly.
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
