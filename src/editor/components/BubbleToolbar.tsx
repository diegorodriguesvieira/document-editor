import type { ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { ThemeProvider } from '@mui/material/styles'
import type { Editor } from '@tiptap/core'
import { POPUP_CLASS } from '../base.styles'
import { editorDarkTheme } from '../theme'
import type { Fragment } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorApi } from '../core/EditorApi'
import { BubbleBar, type BubbleBarProps } from './BubbleBar'
import type { ResolvedFeatures } from '../core/registry'
import type { BubbleItem } from '../core/types'

/**
 * Whether `fragment` is, once whitespace-only text is ignored, nothing but a
 * single atomic node — drilling through the "open" wrapper(s) a selection's
 * `Slice` adds (e.g. `Selection.content()` for a range fully inside one
 * paragraph wraps it in a same-type paragraph so it can merge back into
 * context; the atom sits one level deeper, not at the fragment's own top).
 */
function isAtomOnlyContent(fragment: Fragment): boolean {
  const significant = fragment.content.filter((node) => !(node.isText && !node.text?.trim()))
  if (significant.length !== 1) return false
  const [only] = significant
  // Plain text nodes are technically "atoms" too (leaf, no content) — that is
  // not the case this guards against; only a genuinely atomic NODE
  // (variable, image…) makes the selection unformattable.
  if (only.isText) return false
  if (only.isAtom) return true
  return only.content.childCount > 0 && isAtomOnlyContent(only.content)
}

export interface BubbleToolbarProps {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
  /** Which contributions to show in the bubble (default: all). */
  filter?: (item: BubbleItem) => boolean
  /** Class for the floating container (TipTap positions it via Floating UI). */
  className?: string
  /** Override how each button renders — same seam as the sibling bars. */
  renderButton?: BubbleBarProps['renderButton']
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
  const { selection } = editor.state
  if (
    !editor.isEditable ||
    selection.empty ||
    editor.isEmpty ||
    selection instanceof NodeSelection
  ) {
    return false
  }
  // A TEXT selection that amounts to nothing but a single atomic inline node
  // (e.g. a variable chip) has nothing formattable in it — same reason the
  // NodeSelection case above is excluded, just reached a different way: a
  // drop's default handling can leave a lone atom text-selected instead of
  // node-selected (ProseMirror opens externally-sourced HTML slices as wide
  // as they'll go, which skips the NodeSelection branch in its own drop
  // handler). Whitespace alongside the atom (a trailing space from a chip
  // insert) doesn't count against it.
  return !isAtomOnlyContent(selection.content().content)
}

/**
 * A floating formatting toolbar that appears over the current text selection.
 * Positioning/visibility is handled by TipTap's BubbleMenu; the *content* is
 * the same registry-driven `BubbleBar`, so opt-in features show up here too.
 * Needs a real editor — for unit-testing the content, render `BubbleBar`
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
  // bubble items floats an EMPTY dark pill over every selection.
  const items = filter ? resolved.bubble.filter(filter) : resolved.bubble
  if (items.length === 0 && !children) return null

  return (
    <BubbleMenu
      editor={editor}
      // Portal to <body>, like every other floating surface: inside the page
      // subtree the CSS `zoom` would scale the bubble and feed Floating UI
      // zoom-unaware rects (mispositioned bubble at any zoom ≠ 1).
      appendTo={() => document.body}
      // The popup namespace is FUNCTIONAL, not cosmetic: the region-editing
      // gate keeps an open header/footer open for clicks inside any surface
      // carrying it — it must survive a consumer-supplied className.
      className={`${POPUP_CLASS} ${className ?? 'bubble-toolbar'}`}
      shouldShow={({ editor: current }) => bubbleShouldShow(current)}
    >
      {/* Dark chrome for the pill: the theme (not CSS overrides) recolors the
          MUI buttons inside. */}
      <ThemeProvider theme={editorDarkTheme}>
        <BubbleBar
          editor={editor}
          api={api}
          resolved={resolved}
          filter={filter}
          renderButton={renderButton}
          className="bubble-toolbar__inner"
        >
          {children}
        </BubbleBar>
      </ThemeProvider>
    </BubbleMenu>
  )
}
