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
// Deliberate deep import: the registration seam stays off the curated barrel.
import {
  useDocumentSaveRegistry,
  type DocumentSaveContributor,
} from '../../editor/core/documentSave'

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
 *   Coded rejections the SDK reacts to: {@link STALE_CONTENT} on `add`
 *   (review-mode creates), {@link PARENT_DELETED} on `reply`. Anchor writes
 *   have no adapter channel — they ride the consumer's save envelope.
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
  /** Tooltip of the pendingSave sync indicator (riding the next envelope). */
  anchorPendingSave: string
  /** Tooltip of the saving sync indicator (envelope in flight). */
  anchorSaving: string
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
  anchorPendingSave: 'Waiting for the next save',
  anchorSaving: 'Saving…',
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

/** Where a comment's anchor stands relative to the backend under the
 *  envelope model: `pendingSave` = drifted from the last confirmed save,
 *  riding the next envelope; `saving` = collected into an envelope currently
 *  in flight. Absence = synced. (`saveFailed` died with the per-anchor
 *  channel — a failed envelope persists NOTHING and retries wholesale.) */
export type CommentSyncState = 'pendingSave' | 'saving'

/** A comment created inside the save envelope (edit mode): `tempId` is the
 *  provider's placeholder, mapped back to the minted row by the backend's
 *  response. */
export interface CommentSaveCreate {
  tempId: string
  text: string
  nodes: CommentNodeSegment[]
  quote: string
}

/**
 * Comments' slice of the atomic save envelope: every anchor that drifted and
 * every comment created since the last confirmed save. The DOCUMENT it belongs
 * with is snapshotted by the save layer in the same synchronous frame (the
 * coherence law) — which is why this carries no doc of its own: two readings
 * are two chances to disagree.
 *
 * On success the save layer calls {@link CommentAnchorSync.confirmSaved} with
 * the token (and the backend's created-row mapping), on failure
 * {@link CommentAnchorSync.discardSave} — nothing was persisted, everything
 * stays queued, and the next collect supersedes this one with fresher state.
 */
export interface CommentSavePayload {
  token: number
  anchors: CommentAnchorReport[]
  creates: CommentSaveCreate[]
}

/** The bridge {@link CommentsLayer} registers: the editor-side reads/writes
 *  the envelope needs, all against the LIVE editor state. */
export interface CommentAnchorBridge {
  collect(): CommentAnchorReport[]
  confirm(reports: CommentAnchorReport[]): void
  dirtyIds(): string[]
  /** ONE tracked anchor's CURRENT payload (queued creates ride the plugin
   *  under their `tempId`) — null when nothing of it is live any more. */
  payloadFor(id: string): CommentAnchorPayload | null
}

/**
 * The anchor side of the atomic save envelope: what the UI reads, and what
 * comments' {@link DocumentSaveContributor} is a thin adapter over. Exposed on
 * the context as an escape hatch for a shell that drives the cycle itself.
 */
export interface CommentAnchorSync {
  /** Per-comment sync state — drives the card badge; absence = synced. */
  states: ReadonlyMap<string, CommentSyncState>
  /** Snapshot comments' slice of the envelope: dirty anchors + queued creates,
   *  read in the save layer's own synchronous frame. Null while no editor
   *  bridge is mounted. Marks the collected anchors `saving` until
   *  confirmed/discarded; a newer collect supersedes an unconfirmed older
   *  one. */
  collectSavePayload(): CommentSavePayload | null
  /** The envelope was persisted: anchors become baselines, created rows land
   *  (their composer promises resolve `true`) and the list refetches. */
  confirmSaved(
    token: number,
    result?: { created?: Array<{ tempId: string; row: DocumentComment }> },
  ): void
  /** The envelope failed — nothing persisted. Everything stays queued; the
   *  anchors drop back to `pendingSave` and the next collect resends fresher
   *  state. `stopped` (the save layer gave up for good) also
   *  settles every queued create with `false`, so no composer promise hangs
   *  forever. */
  discardSave(token: number, options?: { stopped?: boolean }): void
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
  /** The anchor side of the save envelope (collect/confirm/discard). */
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
  /** Bridge-internal: {@link CommentsLayer} registers the live-editor bridge
   *  the envelope reads through. Unregistering passes the bridge being
   *  retired as `previous`: a cleanup whose registration was already replaced
   *  (both the layer and the panel run the hook) is then ignored. */
  registerAnchorBridge(
    bridge: CommentAnchorBridge | null,
    previous?: CommentAnchorBridge | null,
  ): void
  /** Bridge-internal: the segments plugin's dirty ledger changed — badge
   *  states re-derive. */
  notifyAnchorLedgerChanged(): void
  /** Comments submitted in EDIT mode and waiting for an envelope. The bridge
   *  hands them to the segments plugin under their `tempId` so their range
   *  maps with every edit — the envelope then carries live geometry. */
  pendingCreates: readonly CommentSaveCreate[]
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
  children,
}: {
  user?: CommentUser
  adapter: CommentsAdapter
  labels?: Partial<CommentsLabels>
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
  const [pendingCreates, setPendingCreates] = useState<readonly CommentSaveCreate[]>([])
  const [anchorStates, setAnchorStates] = useState<ReadonlyMap<string, CommentSyncState>>(
    () => new Map(),
  )
  // Latest adapter without dependency churn: an inline adapter object must
  // not recreate refresh (that useEffect would refetch-loop).
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  // The editor-side envelope bridge (registered by CommentsLayer), the
  // creates parked for the next envelope (edit mode) and the latest
  // UNCONFIRMED collect — refs so the callbacks below stay identity-stable.
  const bridgeRef = useRef<CommentAnchorBridge | null>(null)
  const pendingCreatesRef = useRef<
    Array<CommentSaveCreate & { resolve: (ok: boolean) => void }>
  >([])
  /** Mirror the queue into state so the bridge can hand the tempIds to the
   *  plugin (refs do not re-render). */
  const publishPendingCreates = useCallback(() => {
    setPendingCreates(
      pendingCreatesRef.current.map(({ tempId, text, nodes, quote }) => ({
        tempId,
        text,
        nodes,
        quote,
      })),
    )
  }, [])
  const outstandingRef = useRef<{ token: number; anchors: CommentAnchorReport[] } | null>(null)
  const tokenSeqRef = useRef(0)
  const tempSeqRef = useRef(0)
  // The save layer above, when there is one: it owns the cycle and comments
  // merely contributes a slice to its envelope (registration below). Without
  // one there is no envelope, so a create must never be parked for it — it
  // POSTs immediately instead.
  const saveRegistry = useDocumentSaveRegistry()
  const saveRegistryRef = useRef(saveRegistry)
  saveRegistryRef.current = saveRegistry
  /** A queued create is waiting for a cycle (see the effect below). */
  const cycleWantedRef = useRef(false)

  // Badge derivation: ledger-dirty → pendingSave; collected-in-flight →
  // saving. Re-runs on ledger notifications and around collect/confirm.
  const recomputeAnchorStates = useCallback(() => {
    const next = new Map<string, CommentSyncState>()
    for (const id of bridgeRef.current?.dirtyIds() ?? []) next.set(id, 'pendingSave')
    for (const report of outstandingRef.current?.anchors ?? []) next.set(report.id, 'saving')
    setAnchorStates(next)
  }, [])
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
        // REVIEW mode: the backend validates this quote against the SAVED
        // document, so let the save layer land whatever it still holds (the
        // autosave window is the consumer's policy, and may be seconds long)
        // BEFORE the check.
        try {
          await saveRegistryRef.current?.flush()
        } catch {
          // A failed save is the consumer's business — the create still
          // tries, and the backend decides.
        }
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
      if (queueCreates && saveRegistry) {
        // EDIT mode: the create RIDES THE ENVELOPE — its quote and nodes are
        // validated against the very doc the same save carries, so a stale
        // rejection is impossible by construction. The draft clears now
        // (optimistic); the promise settles when an envelope containing this
        // create is confirmed.
        const tempId = `t-${++tempSeqRef.current}`
        setDraftState(null)
        return new Promise<boolean>((resolve) => {
          pendingCreatesRef.current.push({
            tempId,
            text: body,
            nodes: anchor?.nodes ?? [],
            quote: anchor ? anchor.quote : draft.quote,
            resolve,
          })
          publishPendingCreates()
          // The cycle is asked for in an EFFECT (below), not here: the plugin
          // only learns this tempId on the re-render `publishPendingCreates`
          // triggers, and a collect that runs before that finds nothing under
          // it — and evicts the create as "text removed".
          cycleWantedRef.current = true
        })
      }
      return runCreate()
    },
    [draft, refresh, queueCreates, publishPendingCreates, saveRegistry],
  )

  const collectSavePayload = useCallback((): CommentSavePayload | null => {
    const bridge = bridgeRef.current
    if (!bridge) return null
    // THE COHERENCE LAW: this runs inside the save layer's collect frame, so
    // everything below is derived from the very editor state whose document
    // the envelope carries — never a snapshot taken a tick earlier.
    //
    // Anchor reports are ROW updates; a queued create has no row — its truth
    // rides `creates` below, re-derived through payloadFor. Without this
    // filter, a tracked tempId whose geometry drifted (or whose text died —
    // the ledger now writes proven detaches) would ship a phantom anchor for
    // a row the backend has never heard of.
    const queued = new Set(pendingCreatesRef.current.map((create) => create.tempId))
    const anchors = bridge.collect().filter((report) => !queued.has(report.id))
    // Creates are RE-DERIVED, never replayed: the plugin tracks each queued
    // create under its tempId, so its range moved with every edit since
    // submit. A create whose text is gone (the user deleted what they were
    // commenting on) can never validate — settle it false and drop it
    // instead of poisoning every future envelope.
    const creates: CommentSaveCreate[] = []
    const doomed: string[] = []
    for (const create of pendingCreatesRef.current) {
      const live = create.nodes.length > 0 ? bridge.payloadFor(create.tempId) : null
      if (create.nodes.length > 0 && !live) {
        doomed.push(create.tempId)
        continue
      }
      creates.push({
        tempId: create.tempId,
        text: create.text,
        nodes: live ? live.nodes : create.nodes,
        quote: live ? live.quote : create.quote,
      })
    }
    if (doomed.length > 0) {
      for (const tempId of doomed) {
        const index = pendingCreatesRef.current.findIndex((create) => create.tempId === tempId)
        if (index === -1) continue
        const [create] = pendingCreatesRef.current.splice(index, 1)
        create.resolve(false)
      }
      setError('The commented text was removed before the comment could be saved.')
      publishPendingCreates()
    }
    const token = ++tokenSeqRef.current
    // A newer collect supersedes an unconfirmed older one — after a failed
    // save, the retry simply snapshots fresher state.
    outstandingRef.current = { token, anchors }
    recomputeAnchorStates()
    return { token, anchors, creates }
  }, [recomputeAnchorStates, publishPendingCreates])

  const confirmSaved = useCallback(
    (token: number, result?: { created?: Array<{ tempId: string; row: DocumentComment }> }) => {
      const outstanding = outstandingRef.current
      if (outstanding?.token === token) {
        outstandingRef.current = null
        bridgeRef.current?.confirm(outstanding.anchors)
      }
      // Settle the creates the backend minted: resolve composer promises and
      // land the rows optimistically (the refetch replaces wholesale).
      for (const { tempId, row } of result?.created ?? []) {
        const index = pendingCreatesRef.current.findIndex((create) => create.tempId === tempId)
        if (index === -1) continue
        const [create] = pendingCreatesRef.current.splice(index, 1)
        create.resolve(true)
        setComments((current) =>
          current.some((comment) => comment.id === row.id) ? current : [...current, row],
        )
      }
      if (result?.created?.length) {
        publishPendingCreates()
        void refresh()
      }
      recomputeAnchorStates()
    },
    [refresh, recomputeAnchorStates, publishPendingCreates],
  )

  const discardSave = useCallback(
    (token: number, options?: { stopped?: boolean }) => {
      if (outstandingRef.current?.token === token) outstandingRef.current = null
      if (options?.stopped) {
        // Saving gave up for good (a version conflict: every retry would be
        // rejected identically). Settle every queued create instead of
        // leaving composer promises hanging forever.
        for (const create of pendingCreatesRef.current.splice(0)) create.resolve(false)
        publishPendingCreates()
      }
      recomputeAnchorStates()
    },
    [recomputeAnchorStates, publishPendingCreates],
  )

  // COMMENTS AS A CONTRIBUTOR: the anchors and the queued creates are a SLICE
  // of the document's save envelope, not a channel of their own — which is the
  // whole point of the atomic model. The save layer owns the cycle (debounce,
  // one-in-flight, stopping for good) and calls straight into the seams below,
  // the collect/confirm/discard logic itself is untouched by the arrangement.
  const saveContributor = useMemo<DocumentSaveContributor>(
    () => ({
      collect: () => {
        const payload = collectSavePayload()
        if (!payload) return null
        return {
          token: payload.token,
          slice: { anchors: payload.anchors, creates: payload.creates },
        }
      },
      confirm: (token, result) =>
        confirmSaved(token, result as Parameters<typeof confirmSaved>[1]),
      discard: discardSave,
    }),
    [collectSavePayload, confirmSaved, discardSave],
  )
  useEffect(
    () => saveRegistry?.registerContributor(saveContributor),
    [saveRegistry, saveContributor],
  )
  // Submitting a comment changes no text, so no save window arms and the
  // envelope would wait for the next organic edit — which may never come. Ask
  // for a cycle instead, but only HERE: this effect runs after the bridge (a
  // child) has landed the new tempId in the plugin, so the collect finds it
  // alive instead of evicting it.
  useEffect(() => {
    if (!cycleWantedRef.current) return
    cycleWantedRef.current = false
    void saveRegistry?.requestCycle()
  }, [pendingCreates, saveRegistry])

  const registerAnchorBridge = useCallback(
    (bridge: CommentAnchorBridge | null, previous?: CommentAnchorBridge | null) => {
      // OWNER-CHECKED unregistration: CommentsLayer and CommentsPanel both run
      // the bridge hook, so a cleanup must only clear ITS OWN registration —
      // last-writer-wins plus blind nulling would leave the provider
      // bridge-less while a live editor is still mounted (silently disabling
      // every envelope: collectSavePayload would return null).
      if (bridge === null && previous != null && bridgeRef.current !== previous) return
      bridgeRef.current = bridge
      recomputeAnchorStates()
    },
    [recomputeAnchorStates],
  )

  const notifyAnchorLedgerChanged = useCallback(() => {
    recomputeAnchorStates()
  }, [recomputeAnchorStates])

  const anchorSync = useMemo<CommentAnchorSync>(
    () => ({ states: anchorStates, collectSavePayload, confirmSaved, discardSave }),
    [anchorStates, collectSavePayload, confirmSaved, discardSave],
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
      registerAnchorBridge,
      notifyAnchorLedgerChanged,
      pendingCreates,
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
    [user, comments, loading, error, busyIds, mergedLabels, draft, activeId, anchorSync, queueCreates, createError, clearCreateError, parentDeletedId, registerAnchorBridge, notifyAnchorLedgerChanged, pendingCreates, refresh, addComment, replyToComment, updateComment, setCommentStatus, removeComment, setDraft, clearDraft],
  )

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

/** Null outside a provider — comment UI components render nothing then. */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext)
}
