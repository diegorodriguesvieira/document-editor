import { useEffect } from 'react'
import Button from '@mui/material/Button'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { POPUP_CLASS, useFeatureState } from '../../editor'
import type { Editor } from '../../editor'
import { icons } from '../icons'
import { getCommentsStorage } from './comments'
import { collectCommentAnchors, stripDanglingCommentAnchors } from './commentAnchors'
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
 * The editor↔provider bridge — the headless heart of the comments feature,
 * mounted by BOTH {@link CommentsLayer} and {@link CommentsPanel} (every job
 * is idempotent, so double-mounting is free and mounting EITHER component
 * yields a correct document). A custom panel/balloon calls this directly.
 * Jobs:
 *
 * 1. Wires the kernel's highlight-click reporting into `activeId`.
 * 2. Keeps the kernel's storage in sync with the provider (draft, active
 *    highlight) and nudges a re-render — decorations and the balloon's
 *    `shouldShow` both re-evaluate on transactions.
 * 3. REMAPS the draft range through document changes (typing before the
 *    range in edit mode, programmatic loads) — the pending anchor must stay
 *    glued to its text; a range that collapses cancels the draft.
 * 4. RECONCILES the doc against the backend list: comment marks whose id is
 *    not an OPEN backend comment (deleted/resolved/archived elsewhere,
 *    undo-resurrected content, hand-crafted JSON) are silently stripped —
 *    except ids anchored this session that the backend has not listed yet
 *    (`pendingAnchorIds`: read-replica lag must not orphan fresh comments).
 *    The reverse case — a backend comment with no mark — stays visible as an
 *    ORPHANED card in the panel.
 */
export function useCommentsBridge(editor: Editor | null): void {
  const context = useComments()
  const comments = context?.comments ?? null
  const loading = context?.loading ?? true
  const listError = context?.listError ?? null
  const pendingAnchorIds = context?.pendingAnchorIds ?? null
  const draft = context?.draft ?? null
  const activeId = context?.activeId ?? null
  const setActiveId = context?.setActiveId ?? null
  const setDraft = context?.setDraft ?? null
  const clearDraft = context?.clearDraft ?? null

  // Document clicks on a highlight activate the comment (panel card lights
  // up); clicks on plain text deactivate — the kernel's handleClick reports
  // through this callback. Idempotent across double-mounts: both assign the
  // same context callback.
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
    if (!editor || editor.isDestroyed) return
    const storage = getCommentsStorage(editor)
    if (!storage) return // CommentsFeature not enabled — nothing to decorate
    if (storage.draft === draft && storage.activeId === activeId) return
    storage.draft = draft
    storage.activeId = activeId
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, draft, activeId])

  // Draft remapping: while a draft lives, every doc change moves its range
  // along (mark-only transactions map to identity, so anchor/strip dispatches
  // are no-ops here). A collapsed range means the commented text is gone —
  // cancel rather than anchor the wrong characters.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !draft || !setDraft || !clearDraft) return
    const remap = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      const from = transaction.mapping.map(draft.from, 1)
      const to = transaction.mapping.map(draft.to, -1)
      if (from === draft.from && to === draft.to) return
      if (from >= to) clearDraft()
      else setDraft({ from, to, quote: draft.quote })
    }
    editor.on('transaction', remap)
    return () => {
      editor.off('transaction', remap)
    }
  }, [editor, draft, setDraft, clearDraft])

  // Which ids are anchored in the doc, as a stable key — the dep that re-runs
  // reconciliation when the DOC changes (e.g. an undo resurrects text carrying
  // an already-deleted comment's mark), not just when the list does.
  const anchoredKey = useFeatureState(editor, (current) =>
    [...collectCommentAnchors(current.state.doc).keys()].sort().join('\u0000'),
  )

  useEffect(() => {
    // Only a KNOWN-GOOD backend list may strip marks: never mid-fetch and
    // never on a failed fetch (an offline blip must not shed anchors) — but a
    // failed MUTATION does not gate this (the list is still known-good).
    // Only OPEN comments keep an anchor — resolving/archiving is what sheds
    // the highlight — plus this session's pending anchors (backend read lag).
    if (!editor || editor.isDestroyed || comments == null || loading || listError != null) return
    const keep = new Set(
      comments.filter((comment) => comment.status === 'open').map((comment) => comment.id),
    )
    for (const id of pendingAnchorIds ?? []) keep.add(id)
    stripDanglingCommentAnchors(editor, keep)
  }, [editor, comments, loading, listError, pendingAnchorIds, anchoredKey])
}

/**
 * The comments overlay: the {@link useCommentsBridge} bridge plus the
 * review-only "Add comment" balloon, floated 6px below a read-only text
 * selection — clicking it captures the selection as the DRAFT (the panel
 * opens its composer on that); the `comment--draft` decoration keeps the
 * range visible once focus moves into the composer field. Mount it alongside
 * the formatting bubble (`renderBubble`) in BOTH modes. Renders nothing
 * outside a {@link CommentsProvider}.
 */
export function CommentsLayer({ editor }: { editor: Editor | null }) {
  const context = useComments()
  useCommentsBridge(editor)

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
        {context.labels.addCommentBalloon}
      </Button>
    </BubbleMenu>
  )
}
