import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  CommentAnchorPayload,
  CommentAnchorReport,
  CommentNodeSegment,
} from './commentAnchor'
import { createCommentSyncQueue, type CommentSyncState } from './commentSync'

/** Who is reviewing. Provided by the consumer; omit for anonymous commenting.
 *  The SDK reads only `name`/`avatarUrl` (composer avatar); `id` exists for
 *  the consumer's own wiring — permissions come from the backend flags. */
export interface CommentUser {
  id: string
  name: string
  avatarUrl?: string
}

/**
 * Where a comment sits in its lifecycle. ONE-WAY for now: open→resolved and
 * open→archived (the resolved/archived tabs are read-only, so there is no
 * archive-a-resolved either). Only OPEN comments highlight in the document —
 * the bridge hands only open rows to the segments plugin.
 */
export type CommentStatus = 'OPEN' | 'RESOLVED' | 'ARCHIVED'

/**
 * A direct reply to a comment. ONE level only — a reply cannot be replied to,
 * which is why the type has no `canReply`. Replies have no anchor of their
 * own: they ride the parent comment's anchor.
 */
export interface CommentReply {
  id: string
  text: string
  author: CommentUser
  /** ISO 8601 — rendered as a relative timestamp in the panel. */
  createdAt: string
  canEdit: boolean
  canDelete: boolean
}

/**
 * A comment as the BACKEND owns it. The comment is fully external to the
 * document: `nodes` is its anchor (uid + node-local offsets), `quote` the
 * text those segments covered at the last anchor write — the backend's
 * stale-content checksum, and the panel's context line for ORPHANED comments
 * (whose anchored text was deleted; orphan-forever — the card persists).
 *
 * `canEdit`/`canReply`/`canDelete`/`canResolve`/`canArchive` are stamped by
 * the backend per comment — the UI renders actions from these flags alone
 * (authorship is the backend's business, never inferred client-side).
 */
export interface DocumentComment {
  id: string
  quote: string
  text: string
  author: CommentUser
  /** ISO 8601 — rendered as a relative timestamp in the panel. */
  createdAt: string
  status: CommentStatus
  canEdit: boolean
  canReply: boolean
  canDelete: boolean
  canResolve: boolean
  canArchive: boolean
  replies: CommentReply[]
  /** The multi-segment anchor: external `nodes[]` against node uids, mapped
   *  straight from the backend row. Empty/absent = nothing to highlight (a
   *  document-level comment, or an adapter without anchors) — the card then
   *  renders orphan-style. */
  nodes?: CommentNodeSegment[]
  /** Soft delete (plan: `list()` keeps returning tombstoned rows, for delta
   *  sync). The UI treats these as gone: no card, no highlight — but a reply
   *  RACING the deletion gets the backend's `PARENT_DELETED` rejection. */
  isDeleted?: boolean
}

/**
 * The consumer's endpoint seam — the ONE place that decides which API backs
 * comments. Every mutation is followed by a `list()` refetch (no optimistic
 * updates beyond the full-row insert below), so the panel mirrors the server.
 *
 * - `add` carries no author: the backend stamps it from the session — and it
 *   RETURNS the created id (a full comment satisfies the shape).
 * - `update`/`remove` take a COMMENT id or a REPLY id — the backend mints
 *   globally-unique ids, so an adapter needing the parent (nested REST
 *   routes) resolves it from its own data.
 * - `list` returns comments of EVERY status — the panel does the tab
 *   filtering.
 * - `setStatus` moves a comment through its lifecycle (one input shape so a
 *   future reopen needs no contract change).
 * - ERROR CONTRACT: signal failure by THROWING. A thrown `Error`'s message is
 *   shown VERBATIM in the panel — throw localized, user-facing messages.
 *   Coded rejections the SDK reacts to: {@link STALE_CONTENT} on `add`/
 *   `updateAnchor`, {@link PARENT_DELETED} on `reply`.
 * - The adapter object does NOT need a stable identity — the provider reads
 *   it through a ref, so inline objects are fine.
 */
export interface CommentsAdapter {
  list(): Promise<DocumentComment[]>
  /** `nodes` + `quote` are the anchor recomputed at SUBMIT time — the backend
   *  validates the quote against the SAVED doc and rejects with
   *  {@link STALE_CONTENT} on divergence. `nodes` absent = an anchorless
   *  create (no editor mounted) — the comment lives as an orphan card.
   *  Returning the FULL row instead of `{ id }` lets the provider show the
   *  card optimistically. */
  add(input: { text: string; quote: string; nodes?: CommentNodeSegment[] }): Promise<{ id: string }>
  /** Replying to a soft-deleted parent is REJECTED with
   *  {@link PARENT_DELETED} — the panel keeps the typed text and says so. */
  reply(commentId: string, input: { text: string }): Promise<unknown>
  update(id: string, input: { text: string }): Promise<unknown>
  setStatus(id: string, input: { status: CommentStatus }): Promise<unknown>
  remove(id: string): Promise<unknown>
  /** Anchor writes: PATCH a comment's `nodes[]` + `quote` — a channel
   *  separate from the text, NOT gated by `canEdit` (whoever edits the
   *  document reshapes anchors of any author). Same quote validation as
   *  `add`. Implementing this is what turns the anchor sync queue on. */
  updateAnchor?(id: string, payload: CommentAnchorPayload): Promise<unknown>
}

/**
 * The backend's quote-validation rejection code: the submitted `quote` no
 * longer matches the SAVED document (someone saved over the text meanwhile).
 * Creates surface it as `createError: 'stale'` — the user reloads and redoes
 * the comment; the provider never auto-retries a create.
 */
export const STALE_CONTENT = 'STALE_CONTENT'

/**
 * The backend's rejection code for a reply whose PARENT was soft-deleted
 * meanwhile (the list is a snapshot — another reviewer's delete may not have
 * reached this panel yet). The panel KEEPS the typed text and shows the
 * "comment was deleted" notice; nothing is retried.
 */
export const PARENT_DELETED = 'PARENT_DELETED'

/** Recognizes a coded rejection however the adapter shaped it: an error (or
 *  plain object) carrying `code`, or a message containing the code. */
function hasErrorCode(failure: unknown, wanted: string): boolean {
  if (failure == null) return false
  if (typeof failure === 'string') return failure.includes(wanted)
  if (typeof failure !== 'object') return false
  const { code, message } = failure as { code?: unknown; message?: unknown }
  if (code === wanted) return true
  return typeof message === 'string' && message.includes(wanted)
}

/** {@link STALE_CONTENT}, in any of the recognized shapes. */
export function isStaleContentError(failure: unknown): boolean {
  return hasErrorCode(failure, STALE_CONTENT)
}

/** {@link PARENT_DELETED}, in any of the recognized shapes. */
export function isParentDeletedError(failure: unknown): boolean {
  return hasErrorCode(failure, PARENT_DELETED)
}

/** Whether an `add` resolution is a full row (the spec'd backend returns one)
 *  rather than the minimal `{ id }` — full rows land in state optimistically,
 *  to be replaced by the next `list()`. */
function isFullCommentRow(created: { id: string }): created is DocumentComment {
  const candidate = created as Partial<DocumentComment>
  return (
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.status === 'string' &&
    candidate.author != null &&
    Array.isArray(candidate.replies)
  )
}

/** A comment being written: the captured selection, before it has an id.
 *  The range IS the pending anchor — the composer derives the `nodes[]` +
 *  `quote` payload from it at SUBMIT time (never at capture).
 *  {@link CommentsLayer} remaps it through doc changes while it lives. */
export interface CommentDraft {
  from: number
  to: number
  quote: string
}

/**
 * Every user-facing string of the comments UI, overridable per-provider via
 * the `labels` prop — the SDK's i18n seam. Defaults are English.
 */
export interface CommentsLabels {
  /** The review-mode balloon button. */
  addCommentBalloon: string
  commentPlaceholder: string
  replyPlaceholder: string
  editCommentPlaceholder: string
  editReplyPlaceholder: string
  submitComment: string
  submitReply: string
  submitSave: string
  cancel: string
  reply: string
  edit: string
  archive: string
  delete: string
  /** The Delete menu item's second, confirming step. */
  confirmDelete: string
  resolve: string
  originalTextRemoved: string
  /** Badge on a card whose anchor is PARTIALLY live (some segments deleted). */
  partiallyDetached: string
  /** Tooltip of the pendingSave sync indicator (queued behind the doc save). */
  anchorPendingSave: string
  /** Tooltip of the saving sync indicator (anchor write in flight). */
  anchorSaving: string
  /** Tooltip of the saveFailed sync indicator. */
  anchorSaveFailed: string
  /** The saveFailed indicator's manual-recovery button. */
  retry: string
  /** Inline notice when a reply was rejected with {@link PARENT_DELETED}. */
  replyParentDeleted: string
  /** Inline notice when a create was rejected with {@link STALE_CONTENT}. */
  staleCreate: string
  tabOpen: string
  tabResolved: string
  tabArchived: string
  emptyOpen: string
  emptyResolved: string
  emptyArchived: string
  /** aria-label of the panel `<aside>`. */
  panelLabel: string
  /** aria-label of the status `<Tabs>`. */
  statusTabsLabel: string
  /** aria-label of a card's 3-dots. */
  commentActions: string
  /** aria-label of a reply row's 3-dots. */
  replyActions: string
  /** aria-labels of the three text fields. */
  commentText: string
  replyText: string
  editText: string
  /** aria-label of a card's jump body. */
  showInDocument: (author: string) => string
  /** Avatar alt for anonymous reviewers. */
  anonymous: string
  /** Screen-reader announcements after mutations land. */
  announceResolved: string
  announceArchived: string
  announceDeleted: string
  announceReplyAdded: string
}

export const DEFAULT_COMMENTS_LABELS: CommentsLabels = {
  addCommentBalloon: 'Add comment',
  commentPlaceholder: 'Add a comment…',
  replyPlaceholder: 'Reply…',
  editCommentPlaceholder: 'Edit comment…',
  editReplyPlaceholder: 'Edit reply…',
  submitComment: 'Comment',
  submitReply: 'Reply',
  submitSave: 'Save',
  cancel: 'Cancel',
  reply: 'Reply',
  edit: 'Edit',
  archive: 'Archive',
  delete: 'Delete',
  confirmDelete: 'Confirm delete?',
  resolve: 'Resolve',
  originalTextRemoved: 'Original text was removed',
  partiallyDetached: 'Partially detached',
  anchorPendingSave: 'Waiting for document save',
  anchorSaving: 'Saving anchor…',
  anchorSaveFailed: 'Anchor save failed',
  retry: 'Retry',
  replyParentDeleted: 'This comment was deleted.',
  staleCreate: 'The document changed — reload to comment.',
  tabOpen: 'Comments',
  tabResolved: 'Resolved',
  tabArchived: 'Archived',
  emptyOpen: 'No open comments',
  emptyResolved: 'No resolved comments',
  emptyArchived: 'No archived comments',
  panelLabel: 'Comments',
  statusTabsLabel: 'Comment status',
  commentActions: 'Comment actions',
  replyActions: 'Reply actions',
  commentText: 'Comment text',
  replyText: 'Reply text',
  editText: 'Edit text',
  showInDocument: (author) => `Show in document: comment by ${author}`,
  anonymous: 'Anonymous',
  announceResolved: 'Comment resolved',
  announceArchived: 'Comment archived',
  announceDeleted: 'Comment deleted',
  announceReplyAdded: 'Reply added',
}

/**
 * The anchor write pipeline, as the UI and the consumer's save pump see it.
 * Exists only while the adapter implements `updateAnchor`.
 */
export interface CommentAnchorSync {
  /** Per-comment sync state — `pendingSave`/`saving`/`saveFailed` drive the
   *  card indicator; an id absent from the map has nothing in flight. */
  states: ReadonlyMap<string, CommentSyncState>
  /** The consumer's save pump calls this AFTER its document save resolves —
   *  that call order IS the doc-first guarantee (see commentSync.ts). Runs
   *  queued creates first (a comment must exist before its anchor could be
   *  patched), then the anchor queue, sequentially. */
  flushAnchors(): Promise<void>
  /** Manual recovery from `saveFailed`: re-enqueues a FRESH payload read from
   *  the live plugin state (never the payload that failed). The write itself
   *  waits for the next flush. No-op while the comment has nothing live. */
  retryAnchor(id: string): void
  /** Bridge-internal: the sink {@link CommentsLayer} injects into the editor
   *  storage — the reporter's debounced reports land here. */
  enqueue(report: CommentAnchorReport): void
  /** Bridge-internal: drops the whole queue — wired to the plugin's
   *  `documentReplaced` reset (every queued write describes the replaced
   *  document). */
  clear(): void
}

export interface CommentsContextValue {
  user: CommentUser | null
  comments: DocumentComment[]
  loading: boolean
  /** Last adapter failure of ANY kind (message) — the panel's banner.
   *  Cleared by the next successful fetch. */
  error: string | null
  /** Ids with a mutation in flight — the UI disables their actions. */
  busyIds: ReadonlySet<string>
  /** Merged label set ({@link DEFAULT_COMMENTS_LABELS} + `labels` prop). */
  labels: CommentsLabels
  draft: CommentDraft | null
  /** The comment highlighted in the document (clicked in the panel). */
  activeId: string | null
  refresh(): Promise<void>
  /** Anchor write pipeline — null when the adapter has no `updateAnchor`. */
  anchorSync: CommentAnchorSync | null
  /** While true (EDIT mode — the bridge mirrors `editor.isEditable` here),
   *  anchor-model creates are deferred into the flush cycle instead of
   *  POSTing immediately: the backend must never validate a quote against a
   *  document state that was not saved yet. Review mode posts immediately. */
  queueCreates: boolean
  setQueueCreates(value: boolean): void
  /** 'stale' after a create was rejected with {@link STALE_CONTENT} — the UI
   *  tells the user to reload and redo the comment. Never auto-retried;
   *  cleared by `clearCreateError` or the next successful create. */
  createError: 'stale' | null
  clearCreateError(): void
  /** The comment whose LAST reply attempt was rejected with
   *  {@link PARENT_DELETED} — its composer shows the deleted notice while
   *  keeping the typed text. Cleared by that comment's next successful
   *  reply. */
  parentDeletedId: string | null
  /** Bridge-internal: {@link CommentsLayer} registers the live-editor source
   *  `retryAnchor` reads fresh payloads from (null to unregister). */
  registerAnchorPayloadSource(
    source: ((id: string) => CommentAnchorPayload | null) | null,
  ): void
  /** Bridge-internal: {@link CommentsLayer} registers "deliver the reporter's
   *  debounced pending reports NOW" — `flushAnchors` runs it before draining
   *  the queue (null to unregister). */
  registerPendingReportsFlush(flush: (() => void) | null): void
  /**
   * Sends the draft. Resolves `true` when saved (draft cleared, list
   * refetched). `anchor` is the create payload (`nodes` + `quote`, recomputed
   * by the caller from the REMAPPED draft at submit — never the capture-time
   * geometry) — it replaces the draft's quote in the POST; omitted (no editor
   * mounted), the comment saves anchorless and shows as an orphan card. With
   * `queueCreates` on, the POST itself waits for the next flush and the
   * promise settles then.
   */
  addComment(text: string, anchor?: CommentAnchorPayload): Promise<boolean>
  /** Direct reply (one level). Resolves `true` when saved + refetched. */
  replyToComment(commentId: string, text: string): Promise<boolean>
  /** Rewrites a comment's — or a reply's — text. `true` when saved + refetched. */
  updateComment(id: string, text: string): Promise<boolean>
  /** Moves a comment through its lifecycle (resolve/archive). */
  setCommentStatus(id: string, status: CommentStatus): Promise<boolean>
  /** Works for a comment id or a reply id (see {@link CommentsAdapter}). */
  removeComment(id: string): Promise<boolean>
  setDraft(draft: CommentDraft): void
  clearDraft(): void
  setActiveId(id: string | null): void
}

const CommentsContext = createContext<CommentsContextValue | null>(null)

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/**
 * Comments state, owned by the CONSUMER's shell (same pattern as
 * {@link DocumentVariablesProvider}: context, not the `features` list, so
 * fetches never recreate the editor). Fetches on mount and after every
 * mutation; the adapter decides the endpoints.
 */
export function CommentsProvider({
  user,
  adapter,
  labels,
  onFlushNeeded,
  children,
}: {
  user?: CommentUser
  adapter: CommentsAdapter
  labels?: Partial<CommentsLabels>
  /** Called when a write got QUEUED behind the next doc save (a deferred
   *  create, a manual anchor retry): the consumer's save pump should run a
   *  save-then-flushAnchors cycle now — otherwise the queued write waits for
   *  the next organic edit, which in review mode never comes. */
  onFlushNeeded?: () => void
  children: ReactNode
}) {
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<CommentDraft | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [createError, setCreateError] = useState<'stale' | null>(null)
  const [parentDeletedId, setParentDeletedId] = useState<string | null>(null)
  const [queueCreates, setQueueCreates] = useState(false)
  const [anchorStates, setAnchorStates] = useState<ReadonlyMap<string, CommentSyncState>>(
    () => new Map(),
  )
  // Latest adapter without dependency churn: an inline adapter object must
  // not recreate refresh (that useEffect would refetch-loop).
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  // retryAnchor's fresh-payload source — the bridge registers the live-editor
  // derivation here — and the creates parked for the next flush (edit mode).
  const payloadSourceRef = useRef<((id: string) => CommentAnchorPayload | null) | null>(null)
  const pendingCreatesRef = useRef<Array<() => Promise<void>>>([])
  // The reporter's pre-drain hook (bridge-registered) and the consumer's pump
  // trigger — behind refs so the callbacks below stay identity-stable.
  const pendingReportsFlushRef = useRef<(() => void) | null>(null)
  const onFlushNeededRef = useRef<(() => void) | undefined>(onFlushNeeded)
  onFlushNeededRef.current = onFlushNeeded

  // One anchor sync queue per adapter CAPABILITY (updateAnchor implemented),
  // never per adapter identity — inline adapter objects must not recreate it.
  // The network call reads the latest adapter through the ref.
  const hasUpdateAnchor = typeof adapter.updateAnchor === 'function'
  const queue = useMemo(
    () =>
      hasUpdateAnchor
        ? createCommentSyncQueue({
            updateAnchor: (id, payload) =>
              adapterRef.current.updateAnchor?.(id, payload) ??
              Promise.reject(new Error('adapter.updateAnchor removed')),
          })
        : null,
    [hasUpdateAnchor],
  )

  useEffect(() => {
    if (!queue) return
    return queue.subscribe(() => setAnchorStates(queue.states()))
  }, [queue])
  // Race guard: only the LATEST fetch may land — a slow older list() must not
  // overwrite the refetch that followed a mutation.
  const fetchSeq = useRef(0)
  const busyRef = useRef(new Set<string>())

  const mergedLabels = useMemo<CommentsLabels>(
    () => ({ ...DEFAULT_COMMENTS_LABELS, ...labels }),
    [labels],
  )

  const refresh = useCallback(async () => {
    const ticket = ++fetchSeq.current
    setLoading(true)
    try {
      const list = await adapterRef.current.list()
      if (fetchSeq.current !== ticket) return
      setComments(list)
      setError(null)
    } catch (failure) {
      // Keep the last good list — an offline blip must not blank the panel.
      if (fetchSeq.current === ticket) {
        setError(messageOf(failure))
      }
    } finally {
      if (fetchSeq.current === ticket) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // activeId reconciliation: a REMOTE lifecycle change (resolved, archived,
  // soft-deleted, gone from the list) must not leave the highlight pointing
  // at a card that no longer renders — only OPEN, undeleted comments are
  // activatable. Local mutations already clear it eagerly below.
  useEffect(() => {
    setActiveId((current) => {
      if (current == null) return current
      const row = comments.find((comment) => comment.id === current)
      return row && row.status === 'OPEN' && !row.isDeleted ? current : null
    })
  }, [comments])

  /** Per-id mutation lock: repeat invocations while one is in flight are
   *  ignored (double-clicking Resolve/Delete must not double-hit the API). */
  const runExclusive = useCallback(async (id: string, action: () => Promise<boolean>) => {
    if (busyRef.current.has(id)) return false
    busyRef.current.add(id)
    setBusyIds(new Set(busyRef.current))
    try {
      return await action()
    } finally {
      busyRef.current.delete(id)
      setBusyIds(new Set(busyRef.current))
    }
  }, [])

  const addComment = useCallback(
    async (text: string, anchor?: CommentAnchorPayload) => {
      const body = text.trim()
      if (!draft || !body) return false
      const runCreate = async (): Promise<boolean> => {
        let created: { id: string }
        try {
          created = await adapterRef.current.add({
            text: body,
            // The anchor payload's quote is the one recomputed at submit —
            // the backend validates it against the saved doc.
            quote: anchor ? anchor.quote : draft.quote,
            ...(anchor ? { nodes: anchor.nodes } : {}),
          })
        } catch (failure) {
          // The draft (and the composer's text, which the composer owns) survive
          // a failed save — nothing typed is lost. A STALE_CONTENT rejection is
          // surfaced separately ("reload and redo") and NEVER auto-retried.
          if (isStaleContentError(failure)) setCreateError('stale')
          setError(messageOf(failure))
          return false
        }
        setCreateError(null)
        // Optimistic row: an adapter whose `add` resolves with the FULL row
        // gets its card into state immediately (highlight included — the
        // bridge lands its `nodes` in the plugin) — the next list() replaces
        // it wholesale.
        if (isFullCommentRow(created)) {
          setComments((current) =>
            current.some((comment) => comment.id === created.id) ? current : [...current, created],
          )
        }
        setDraftState(null)
        await refresh()
        return true
      }
      if (queueCreates && queue) {
        // EDIT mode: the POST rides the flush cycle — after the doc save —
        // so the backend never validates a quote against an unsaved document
        // (the needless STALE_CONTENT round-trip the queue exists to avoid).
        return new Promise<boolean>((resolve) => {
          pendingCreatesRef.current.push(async () => {
            resolve(await runCreate())
          })
          // Without a pump cycle this promise settles only after the next
          // ORGANIC edit — ask the consumer to run save-then-flush now.
          onFlushNeededRef.current?.()
        })
      }
      return runCreate()
    },
    [draft, refresh, queueCreates, queue],
  )

  const flushAnchors = useCallback(async () => {
    // Doc-first, enforced by the CALLER: the consumer's save pump invokes
    // this only after its document save resolved. FIRST deliver everything
    // still inside the reporter's debounce window (plan §7 — payloads are
    // recomputed from live state at flush time; without this the trailing
    // edits of every burst miss their own save cycle, since the report
    // debounce is longer than the save debounce). Queued creates go next —
    // a comment must exist backend-side before any anchor patch for it.
    pendingReportsFlushRef.current?.()
    const creates = pendingCreatesRef.current.splice(0)
    for (const create of creates) await create()
    await queue?.flush()
  }, [queue])

  const retryAnchor = useCallback(
    (id: string) => {
      // FRESH payload only, recomputed from the live plugin state through the
      // source the bridge registered — never the payload that failed. Unknown
      // or all-dormant ids have nothing valid to write: no-op.
      const fresh = payloadSourceRef.current?.(id)
      if (!fresh || !queue) return
      queue.retry(id, fresh)
      // The write itself waits for a flush, and in review mode no organic
      // save ever comes — ask the consumer to run its pump now.
      onFlushNeededRef.current?.()
    },
    [queue],
  )

  const registerAnchorPayloadSource = useCallback(
    (source: ((id: string) => CommentAnchorPayload | null) | null) => {
      payloadSourceRef.current = source
    },
    [],
  )

  const registerPendingReportsFlush = useCallback((flush: (() => void) | null) => {
    pendingReportsFlushRef.current = flush
  }, [])

  const enqueueReport = useCallback(
    (report: CommentAnchorReport) => {
      queue?.enqueue(report)
    },
    [queue],
  )

  const anchorSync = useMemo<CommentAnchorSync | null>(
    () =>
      queue
        ? {
            states: anchorStates,
            flushAnchors,
            retryAnchor,
            enqueue: enqueueReport,
            clear: () => queue.clear(),
          }
        : null,
    [queue, anchorStates, flushAnchors, retryAnchor, enqueueReport],
  )

  const clearCreateError = useCallback(() => setCreateError(null), [])

  // Reply, setStatus and remove stay OUTSIDE the anchor sync queue — they do
  // not depend on the document, so they hit the network immediately (decided).
  const replyToComment = useCallback(
    async (commentId: string, text: string) => {
      const body = text.trim()
      if (!body) return false
      return runExclusive(commentId, async () => {
        try {
          await adapterRef.current.reply(commentId, { text: body })
        } catch (failure) {
          // PARENT_DELETED = the parent was soft-deleted remotely (snapshot
          // list — the delete may not have reached this panel yet). Marked
          // per comment so ITS composer shows the notice; the typed text is
          // the composer's own state and survives the `false` return.
          if (isParentDeletedError(failure)) setParentDeletedId(commentId)
          setError(messageOf(failure))
          return false
        }
        setParentDeletedId((current) => (current === commentId ? null : current))
        await refresh()
        return true
      })
    },
    [refresh, runExclusive],
  )

  const updateComment = useCallback(
    async (id: string, text: string) => {
      const body = text.trim()
      if (!body) return false
      return runExclusive(id, async () => {
        try {
          await adapterRef.current.update(id, { text: body })
        } catch (failure) {
          setError(messageOf(failure))
          return false
        }
        await refresh()
        return true
      })
    },
    [refresh, runExclusive],
  )

  const setCommentStatus = useCallback(
    async (id: string, status: CommentStatus) =>
      runExclusive(id, async () => {
        try {
          await adapterRef.current.setStatus(id, { status })
        } catch (failure) {
          setError(messageOf(failure))
          return false
        }
        // A resolved/archived comment leaves the open tab (and its highlight
        // the doc) — a lingering active id would point at nothing.
        setActiveId((current) => (current === id ? null : current))
        await refresh()
        return true
      }),
    [refresh, runExclusive],
  )

  const removeComment = useCallback(
    async (id: string) =>
      runExclusive(id, async () => {
        try {
          await adapterRef.current.remove(id)
        } catch (failure) {
          setError(messageOf(failure))
          return false
        }
        // No-op for reply ids — only comment ids ever become active.
        setActiveId((current) => (current === id ? null : current))
        await refresh()
        return true
      }),
    [refresh, runExclusive],
  )

  const setDraft = useCallback((next: CommentDraft) => setDraftState(next), [])
  const clearDraft = useCallback(() => setDraftState(null), [])

  const value = useMemo<CommentsContextValue>(
    () => ({
      user: user ?? null,
      comments,
      loading,
      error,
      busyIds,
      labels: mergedLabels,
      draft,
      activeId,
      anchorSync,
      queueCreates,
      setQueueCreates,
      createError,
      clearCreateError,
      parentDeletedId,
      registerAnchorPayloadSource,
      registerPendingReportsFlush,
      refresh,
      addComment,
      replyToComment,
      updateComment,
      setCommentStatus,
      removeComment,
      setDraft,
      clearDraft,
      setActiveId,
    }),
    [user, comments, loading, error, busyIds, mergedLabels, draft, activeId, anchorSync, queueCreates, createError, clearCreateError, parentDeletedId, registerAnchorPayloadSource, registerPendingReportsFlush, refresh, addComment, replyToComment, updateComment, setCommentStatus, removeComment, setDraft, clearDraft],
  )

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

/** Null outside a provider — comment UI components render nothing then. */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext)
}

/**
 * Reaches `flushAnchors` from OUTSIDE the provider subtree — the consumer's
 * save pump usually lives beside the provider, not inside it, so it cannot
 * call {@link useComments} itself. Render this inside the provider and read
 * the bound function from wherever the pump keeps its ref.
 */
export function AnchorFlushBinder({
  bind,
}: {
  bind: (flush: (() => Promise<void>) | null) => void
}) {
  const flush = useComments()?.anchorSync?.flushAnchors ?? null
  useEffect(() => {
    bind(flush)
    return () => bind(null)
  }, [bind, flush])
  return null
}
