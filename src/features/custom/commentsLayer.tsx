import { useEffect } from 'react'
import Button from '@mui/material/Button'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { POPUP_CLASS } from '../../editor'
import type { Editor } from '../../editor'
import { icons } from '../icons'
import { getCommentsStorage } from './comments'
import { useComments } from './commentsProvider'

/** 6px below the selection — the spec'd balloon spot (Floating UI options). */
const BALLOON_OPTIONS = { placement: 'bottom', offset: 6 } as const

/**
 * When the "Add comment" balloon shows — the review-mode mirror of
 * `bubbleShouldShow` (which requires an EDITABLE editor, so the two floating
 * surfaces are mutually exclusive by construction): read-only, a real text
 * selection, and no draft already being composed.
 */
export function commentBalloonShouldShow(editor: Editor): boolean {
  const { selection, doc } = editor.state
  if (editor.isEditable || editor.isEmpty || selection.empty) return false
  // A selected image/divider has its own chrome and nothing quotable.
  if (selection instanceof NodeSelection) return false
  if (getCommentsStorage(editor)?.draft != null) return false
  return doc.textBetween(selection.from, selection.to, ' ').trim().length > 0
}

// Module-scope so the BubbleMenu effect deps stay referentially stable —
// inline objects would tear down and rebuild the plugin on every render.
const shouldShow = ({ editor }: { editor: Editor }) => commentBalloonShouldShow(editor)
const appendToBody = () => document.body

/**
 * The single mount point for the review-comments overlay. Mount it alongside
 * the formatting bubble (`renderBubble`); it renders nothing outside a
 * {@link CommentsProvider}. Two jobs:
 *
 * 1. Keeps the decoration kernel's storage in sync with the provider
 *    (comments, draft, active highlight) and nudges a re-render — decorations
 *    and the balloon's `shouldShow` both re-evaluate on transactions.
 * 2. Floats the "Add comment" balloon 6px below a read-only text selection;
 *    clicking it captures the selection as the DRAFT (the panel opens its
 *    composer on that) — the `comment--draft` decoration keeps the range
 *    visible once focus moves into the composer field.
 */
export function CommentsLayer({ editor }: { editor: Editor | null }) {
  const context = useComments()
  const comments = context?.comments ?? null
  const draft = context?.draft ?? null
  const activeId = context?.activeId ?? null
  const setActiveId = context?.setActiveId ?? null

  // Document clicks on a highlight activate the comment (panel card lights
  // up); clicks on plain text deactivate — the kernel's handleClick reports
  // through this callback.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !setActiveId) return
    const storage = getCommentsStorage(editor)
    if (!storage) return
    storage.onCommentClick = setActiveId
    return () => {
      storage.onCommentClick = null
    }
  }, [editor, setActiveId])

  useEffect(() => {
    if (!editor || editor.isDestroyed || comments == null) return
    const storage = getCommentsStorage(editor)
    if (!storage) return // CommentsFeature not enabled — nothing to decorate
    storage.comments = comments
    storage.draft = draft
    storage.activeId = activeId
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, comments, draft, activeId])

  if (!editor || !context) return null

  const capture = () => {
    const { from, to } = editor.state.selection
    context.setActiveId(null)
    context.setDraft({ from, to, quote: editor.state.doc.textBetween(from, to, ' ') })
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="commentsBalloon"
      // Portal to <body>, like every floating surface (CSS zoom vs Floating UI).
      appendTo={appendToBody}
      className={`${POPUP_CLASS} comment-balloon`}
      options={BALLOON_OPTIONS}
      shouldShow={shouldShow}
    >
      <Button
        size="small"
        className="comment-balloon__button"
        startIcon={icons.comment}
        // Keep the selection while clicking the balloon.
        onMouseDown={(event) => event.preventDefault()}
        onClick={capture}
      >
        Add comment
      </Button>
    </BubbleMenu>
  )
}
