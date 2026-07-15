import { type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { BubbleItem } from '../core/types'
import { useBubbleBar, type BarButton } from '../hooks/useBar'
import { RegistryBar } from './RegistryBar'

export interface BubbleBarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Override the container class — restyle without forking. */
  className?: string
  /** Show only a subset of contributions (e.g. a marks-only bubble menu). */
  filter?: (item: BubbleItem) => boolean
  /** Override how each button renders, keeping the live state. */
  renderButton?: (button: BarButton) => ReactNode
  /** Arbitrary custom controls appended at the end. */
  children?: ReactNode
}

/**
 * The registry-driven button row over {@link useBubbleBar} — the BUBBLE's
 * content engine and the mock-seam test surface (render it against
 * `createMockEditor` to test bubble wiring without ProseMirror). The
 * container itself ships unstyled (the product has no static formatting
 * bar); every part is overridable — `className` to restyle, `renderButton`
 * to change markup, `children` for custom controls, and a feature's own
 * `BubbleItem.render` for bespoke ones. For a totally different bar,
 * skip this and use `useBubbleBar` directly.
 */
export function BubbleBar({
  editor,
  api,
  resolved,
  className,
  filter,
  renderButton,
  children,
}: BubbleBarProps) {
  const buttons = useBubbleBar(editor, api, resolved)
  return (
    <RegistryBar
      editor={editor}
      api={api}
      buttons={buttons}
      filter={filter}
      renderButton={renderButton}
      className={className ?? 'bubble-bar'}
      buttonClassName="bubble-bar__btn"
      ariaLabel="Formatting"
      iconFallback={(item) => item.label}
    >
      {children}
    </RegistryBar>
  )
}
