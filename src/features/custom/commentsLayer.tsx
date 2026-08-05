import { useEffect, useMemo } from 'react'
import Button from '@mui/material/Button'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { POPUP_CLASS, useFeatureState } from '../../editor'
import type { Editor } from '../../editor'
import { icons } from '../icons'
import { getCommentsStorage, type CommentAnchorRecord } from './comments'
import {
  useComments,
  type CommentAnchorBridge,
  type CommentSaveCreate,
} from './commentsProvider'

/** Stable empty list — a fresh literal would re-run the records memo. */
const EMPTY_PENDING_CREATES: readonly CommentSaveCreate[] = []

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
 *    anchors stays visible as an ORPHANED card in the panel) TOGETHER with
 *    the comments queued for the next save (under their `tempId`, so their
 *    range maps with every edit), registers the envelope bridge
 *    (`registerAnchorBridge`: the doc snapshot and the collect/confirm seams,
 *    all read from the LIVE editor state), forwards the ledger's changes to
 *    the badge derivation, and mirrors `editor.isEditable` into
 *    `queueCreates`.
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
  const setQueueCreates = context?.setQueueCreates ?? null
  const pendingCreates = context?.pendingCreates ?? EMPTY_PENDING_CREATES
  const registerAnchorBridge = context?.registerAnchorBridge ?? null
  const notifyAnchorLedgerChanged = context?.notifyAnchorLedgerChanged ?? null

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
    return [
      ...comments
        .filter(
          (comment) =>
            comment.status === 'OPEN' && !comment.isDeleted && (comment.nodes?.length ?? 0) > 0,
        )
        .map((comment) => ({ id: comment.id, nodes: comment.nodes ?? [], quote: comment.quote })),
      // Comments submitted in EDIT mode but not yet saved ride the plugin
      // under their tempId: their range maps with every edit, so the envelope
      // carries live geometry instead of a submit-time freeze (and the new
      // highlight shows immediately). They leave when the row arrives.
      ...pendingCreates.map((create) => ({
        id: create.tempId,
        nodes: create.nodes,
        quote: create.quote,
      })),
    ]
  }, [comments, pendingCreates])

  useEffect(() => {
    if (!editor || editor.isDestroyed || anchorRecords == null) return
    const storage = getCommentsStorage(editor)
    if (!storage || storage.comments === anchorRecords) return
    storage.comments = anchorRecords
    // The storage+nudge idiom again: the no-op dispatch is what runs the
    // segments plugin's membership reconcile over the fresh list.
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, anchorRecords])

  // The envelope bridge: the provider's collectSavePayload reads the dirty
  // anchors and the baselines through these editor-side seams — all against
  // the LIVE state, inside the save layer's collect frame (the coherence law;
  // the document half is snapshotted there, from this same editor).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !registerAnchorBridge) return
    const bridge: CommentAnchorBridge = {
      collect: () => getCommentsStorage(editor)?.collectDirtyAnchors?.() ?? [],
      confirm: (reports) => getCommentsStorage(editor)?.confirmAnchorsSaved?.(reports),
      dirtyIds: () => getCommentsStorage(editor)?.dirtyAnchorIds?.() ?? [],
      payloadFor: (id) => getCommentsStorage(editor)?.anchorPayloadFor?.(id) ?? null,
    }
    registerAnchorBridge(bridge)
    // Owner-checked: this hook runs in BOTH the layer and the panel, so a
    // cleanup must not clear a registration the other one already replaced.
    return () => registerAnchorBridge(null, bridge)
  }, [editor, registerAnchorBridge])

  // Badge reactivity: the segments plugin's ledger notifies here after every
  // sweep/reset/confirm that changed the dirty picture.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !notifyAnchorLedgerChanged) return
    const storage = getCommentsStorage(editor)
    if (!storage) return
    storage.onAnchorLedgerChanged = notifyAnchorLedgerChanged
    return () => {
      storage.onAnchorLedgerChanged = null
    }
  }, [editor, notifyAnchorLedgerChanged])

  // EDIT mode rides creates in the envelope; review posts immediately.
  // Live: setEditable emits a doc-less update, whose nudge re-runs selectors.
  const editable = useFeatureState(editor, (current) => current.isEditable)
  useEffect(() => {
    setQueueCreates?.(editable === true)
  }, [setQueueCreates, editable])

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
