import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import { EditorToolbar } from './EditorToolbar'
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
}

/**
 * A floating formatting toolbar that appears over the current text selection.
 * Positioning/visibility is handled by TipTap's BubbleMenu; the *content* is
 * the same registry-driven `EditorToolbar`, so opt-in features show up here too.
 * Needs a real editor — for unit-testing the content, render `EditorToolbar`
 * with `createMockEditor` instead.
 */
export function BubbleToolbar({ editor, api, resolved, filter, className }: BubbleToolbarProps) {
  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      className={className ?? 'bubble-toolbar'}
      // Presentation rule: no bubble over "nothing" — a select-all on an EMPTY
      // document produces a technically-non-empty selection (the empty
      // paragraph) that would summon the bubble for no reason.
      shouldShow={({ editor: current }) =>
        current.isEditable && !current.state.selection.empty && !current.isEmpty
      }
    >
      <EditorToolbar
        editor={editor}
        api={api}
        resolved={resolved}
        filter={filter}
        className="bubble-toolbar__inner"
      />
    </BubbleMenu>
  )
}
