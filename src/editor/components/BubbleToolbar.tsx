import type { ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorApi } from '../core/EditorApi'
import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar'
import type { ResolvedFeatures } from '../core/registry'
import type { ToolbarItem } from '../core/types'

export interface BubbleToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Which contributions to show in the bubble (default: all). */
  filter?: (item: ToolbarItem) => boolean
  /** Class for the floating container (TipTap positions it via Floating UI). */
  className?: string
  /** Override how each button renders — same seam as the sibling bars. */
  renderButton?: EditorToolbarProps['renderButton']
  /** Custom controls appended after the contributions. */
  children?: ReactNode
}

/**
 * Presentation rules for the bubble — exported so the contract is testable:
 * no bubble over "nothing" (a select-all on an EMPTY document produces a
 * technically-non-empty selection of the empty paragraph), and no bubble over
 * NODE selections — a selected image or divider gets its own chrome (resize
 * handles); the TEXT formatting bubble would be noise on top of it.
 */
export function bubbleShouldShow(editor: Editor): boolean {
  return (
    editor.isEditable &&
    !editor.state.selection.empty &&
    !editor.isEmpty &&
    !(editor.state.selection instanceof NodeSelection)
  )
}

/**
 * A floating formatting toolbar that appears over the current text selection.
 * Positioning/visibility is handled by TipTap's BubbleMenu; the *content* is
 * the same registry-driven `EditorToolbar`, so opt-in features show up here too.
 * Needs a real editor — for unit-testing the content, render `EditorToolbar`
 * with `createMockEditor` instead.
 */
export function BubbleToolbar({
  editor,
  api,
  resolved,
  filter,
  className,
  renderButton,
  children,
}: BubbleToolbarProps) {
  if (!editor) return null
  // Nothing to show → no bubble. Without this, a feature set with zero
  // toolbar items floats an EMPTY dark pill over every selection.
  const items = filter ? resolved.toolbar.filter(filter) : resolved.toolbar
  if (items.length === 0 && !children) return null

  return (
    <BubbleMenu
      editor={editor}
      className={className ?? 'bubble-toolbar'}
      shouldShow={({ editor: current }) => bubbleShouldShow(current)}
    >
      <EditorToolbar
        editor={editor}
        api={api}
        resolved={resolved}
        filter={filter}
        renderButton={renderButton}
        className="bubble-toolbar__inner"
      >
        {children}
      </EditorToolbar>
    </BubbleMenu>
  )
}
