import type { ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { ThemeProvider } from '@mui/material/styles'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { POPUP_CLASS } from '../base.styles'
import { editorDarkTheme } from '../theme'
import type { EditorApi, EditorStateView } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { BubbleItem, NodeBubbleSection } from '../core/types'
import { useNodeBubbleBar } from '../hooks/useBar'
import type { BubbleBarProps } from './BubbleBar'
import { RegistryBar } from './RegistryBar'

export interface NodeBubbleToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Which contributions to show in the bubble (default: all matched). */
  filter?: (item: BubbleItem) => boolean
  /** Class for the floating container (TipTap positions it via Floating UI). */
  className?: string
  /** Override how each button renders — same seam as the sibling bars. */
  renderButton?: BubbleBarProps['renderButton']
  /** Custom controls appended after the contributions. */
  children?: ReactNode
}

/**
 * Presentation rules for the NODE bubble — the exact mirror of
 * `bubbleShouldShow`: it shows only where the text bubble refuses to (a
 * NodeSelection), and only while some section claims the selected node and
 * the editor is editable (read-only chrome must not offer mutations).
 */
export function nodeBubbleShouldShow(
  editor: Editor,
  state: EditorStateView,
  sections: NodeBubbleSection[],
): boolean {
  if (!editor.isEditable) return false
  if (!(editor.state.selection instanceof NodeSelection)) return false
  return sections.some((section) => section.when(state))
}

/** The registry-driven button row of the NODE bubble — the mock-seam test
 *  surface (render it against `createMockEditor` to test wiring without
 *  ProseMirror), same role `BubbleBar` plays for the text bubble. */
export function NodeBubbleBar({
  editor,
  api,
  resolved,
  filter,
  renderButton,
  className,
  children,
}: NodeBubbleToolbarProps) {
  const buttons = useNodeBubbleBar(editor, api, resolved)
  return (
    <RegistryBar
      editor={editor}
      api={api}
      buttons={buttons}
      filter={filter}
      renderButton={renderButton}
      className={className ?? 'bubble-toolbar__inner'}
      buttonClassName="bubble-bar__btn"
      ariaLabel="Selected node actions"
      iconFallback={(item) => item.label}
    >
      {children}
    </RegistryBar>
  )
}

/**
 * The Docs-style floating toolbar over a selected NODE (image, divider…) —
 * the sibling of {@link BubbleToolbar}, which handles TEXT selections. Same
 * chrome (dark pill), its own BubbleMenu plugin instance, placed BELOW the
 * node so it never sits on an image's top resize handles. Content comes from
 * the `nodeBubble` channel: the items of every section whose `when` matches.
 */
export function NodeBubbleToolbar({
  editor,
  api,
  resolved,
  filter,
  className,
  renderButton,
  children,
}: NodeBubbleToolbarProps) {
  if (!editor) return null
  // Nothing contributed → no bubble (no empty dark pill on node selections).
  if (resolved.nodeBubble.length === 0 && !children) return null

  return (
    <BubbleMenu
      editor={editor}
      // Its own plugin instance NEXT TO the text bubble's (default key).
      pluginKey="nodeBubbleMenu"
      // Portal to <body>, like every other floating surface: inside the page
      // subtree the CSS `zoom` would scale the bubble and feed Floating UI
      // zoom-unaware rects (mispositioned bubble at any zoom ≠ 1).
      appendTo={() => document.body}
      options={{ placement: 'bottom' }}
      // The popup namespace is FUNCTIONAL, not cosmetic: the region-editing
      // gate keeps an open header/footer open for clicks inside any surface
      // carrying it — it must survive a consumer-supplied className.
      className={`${POPUP_CLASS} ${className ?? 'bubble-toolbar node-bubble-toolbar'}`}
      shouldShow={({ editor: current }) => nodeBubbleShouldShow(current, api, resolved.nodeBubble)}
    >
      {/* Dark chrome for the pill: the theme (not CSS overrides) recolors the
          MUI buttons inside. */}
      <ThemeProvider theme={editorDarkTheme}>
        <NodeBubbleBar
          editor={editor}
          api={api}
          resolved={resolved}
          filter={filter}
          renderButton={renderButton}
        >
          {children}
        </NodeBubbleBar>
      </ThemeProvider>
    </BubbleMenu>
  )
}
