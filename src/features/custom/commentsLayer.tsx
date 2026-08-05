import { useEffect, useMemo } from 'react'
import Button from '@mui/material/Button'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { POPUP_CLASS, useFeatureState } from '../../editor'
import type { Editor } from '../../editor'
import { icons } from '../icons'
import { deriveAnchorPayload, getCommentsStorage, type CommentAnchorRecord } from './comments'
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
 * yields a working review surface). A custom panel/balloon calls this
 * directly. Jobs:
 *
 * 1. Wires the kernel's highlight-click reporting into `activeId`.
 * 2. Keeps the kernel's storage in sync with the provider (draft, active
 *    highlight) and nudges a re-render — decorations and the balloon's
 *    `shouldShow` both re-evaluate on transactions.
 * 3. REMAPS the draft range through document changes (typing before the
 *    range in edit mode, programmatic loads) — the pending anchor must stay
 *    glued to its text; a range that collapses cancels the draft.
 * 4. Lands the OPEN `nodes[]`-carrying rows in the kernel storage (the
 *    segments plugin's population — resolved/archived/soft-deleted rows shed
 *    their highlight by simply not landing; a backend comment nothing
 *    anchors stays visible as an ORPHANED card in the panel), points the
 *    reporter's sink at the provider's sync queue, mirrors
 *    `editor.isEditable` into `queueCreates`, and registers the live
 *    fresh-payload source `retryAnchor` reads.
 *
 * Nothing here ever writes to the document — highlights are decorations over
 * external anchors, so review mode is zero-write by construction.
 */
export function useCommentsBridge(editor: Editor | null): void {
  const context = useComments()
  const comments = context?.comments ?? null
  const draft = context?.draft ?? null
  const activeId = context?.activeId ?? null
  const setActiveId = context?.setActiveId ?? null
  const setDraft = context?.setDraft ?? null
  const clearDraft = context?.clearDraft ?? null
  const enqueueReport = context?.anchorSync?.enqueue ?? null
  const clearAnchorQueue = context?.anchorSync?.clear ?? null
  const setQueueCreates = context?.setQueueCreates ?? null
  const registerAnchorPayloadSource = context?.registerAnchorPayloadSource ?? null
  const registerPendingReportsFlush = context?.registerPendingReportsFlush ?? null

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
  // along. A collapsed range means the commented text is gone — cancel rather
  // than anchor the wrong characters.
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

  // The segments plugin's population: OPEN, undeleted rows that carry
  // `nodes`. Resolved/archived/soft-deleted rows shed their highlight by
  // exclusion; rows without `nodes` have nothing to resolve (orphan cards).
  const anchorRecords = useMemo<CommentAnchorRecord[] | null>(() => {
    if (comments == null) return null
    return comments
      .filter(
        (comment) =>
          comment.status === 'OPEN' && !comment.isDeleted && (comment.nodes?.length ?? 0) > 0,
      )
      .map((comment) => ({ id: comment.id, nodes: comment.nodes ?? [], quote: comment.quote }))
  }, [comments])

  useEffect(() => {
    if (!editor || editor.isDestroyed || anchorRecords == null) return
    const storage = getCommentsStorage(editor)
    if (!storage || storage.comments === anchorRecords) return
    storage.comments = anchorRecords
    // The storage+nudge idiom again: the no-op dispatch is what runs the
    // segments plugin's membership reconcile over the fresh list.
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, anchorRecords])

  // The reporter's sink: debounced anchor reports land in the provider's sync
  // queue — NEVER the network (the consumer's save pump flushes the queue
  // after its doc save confirms; that call order is the doc-first rule).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !enqueueReport) return
    const storage = getCommentsStorage(editor)
    if (!storage) return
    storage.onAnchorReport = enqueueReport
    return () => {
      storage.onAnchorReport = null
    }
  }, [editor, enqueueReport])

  // The save pump's pre-drain hook: `flushAnchors` delivers the reporter's
  // debounced pendings through this registration before draining the queue.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !registerPendingReportsFlush) return
    registerPendingReportsFlush(() => getCommentsStorage(editor)?.flushPendingReports?.())
    return () => registerPendingReportsFlush(null)
  }, [editor, registerPendingReportsFlush])

  // `documentReplaced` drops the queue — every queued anchor write describes
  // the document that just left.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !clearAnchorQueue) return
    const storage = getCommentsStorage(editor)
    if (!storage) return
    storage.onAnchorsReset = clearAnchorQueue
    return () => {
      storage.onAnchorsReset = null
    }
  }, [editor, clearAnchorQueue])

  // EDIT mode queues creates behind the doc save; review posts immediately.
  // Live: setEditable emits a doc-less update, whose nudge re-runs selectors.
  const editable = useFeatureState(editor, (current) => current.isEditable)
  useEffect(() => {
    setQueueCreates?.(editable === true)
  }, [setQueueCreates, editable])

  // retryAnchor's fresh-payload source: the plugin's CURRENT canonical
  // derivation, read at retry time — a retry never resends what failed.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !registerAnchorPayloadSource) return
    registerAnchorPayloadSource((id) => deriveAnchorPayload(editor, id))
    return () => registerAnchorPayloadSource(null)
  }, [editor, registerAnchorPayloadSource])
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
