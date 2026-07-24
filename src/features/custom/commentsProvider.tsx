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
 * archive-a-resolved either). Only OPEN comments keep a mark in the document
 * — resolving/archiving sheds the highlight via reconciliation.
 */
export type CommentStatus = 'open' | 'resolved' | 'archived'

/**
 * A direct reply to a comment. ONE level only — a reply cannot be replied to,
 * which is why the type has no `canReply`. Replies have no anchor of their
 * own: they ride the parent comment's mark.
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
 * A comment as the BACKEND owns it: content only. The ANCHOR lives in the
 * document itself, as a `comment` mark carrying this `id` — so positions move
 * with the text and never appear here. `quote` is kept for context and for
 * showing ORPHANED comments (whose marked text was deleted).
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
}

/**
 * The consumer's endpoint seam — the ONE place that decides which API backs
 * comments. Every mutation is followed by a `list()` refetch (no optimistic
 * updates), so the panel always mirrors the server.
 *
 * - `add` carries no author: the backend stamps it from the session — and it
 *   RETURNS the created id (a full comment satisfies the shape), which the
 *   frontend then anchors into the document as a mark.
 * - `update`/`remove` take a COMMENT id or a REPLY id — the backend mints
 *   globally-unique ids, so an adapter needing the parent (nested REST
 *   routes) resolves it from its own data.
 * - `list` returns comments of EVERY status — the panel does the tab
 *   filtering.
 * - `setStatus` moves a comment through its lifecycle (one input shape so a
 *   future reopen needs no contract change).
 * - ERROR CONTRACT: signal failure by THROWING. A thrown `Error`'s message is
 *   shown VERBATIM in the panel — throw localized, user-facing messages.
 * - The adapter object does NOT need a stable identity — the provider reads
 *   it through a ref, so inline objects are fine.
 */
export interface CommentsAdapter {
  list(): Promise<DocumentComment[]>
  add(input: { text: string; quote: string }): Promise<{ id: string }>
  reply(commentId: string, input: { text: string }): Promise<unknown>
  update(id: string, input: { text: string }): Promise<unknown>
  setStatus(id: string, input: { status: CommentStatus }): Promise<unknown>
  remove(id: string): Promise<unknown>
}

/** A comment being written: the captured selection, before it has an id.
 *  The range IS the pending anchor — it becomes the mark once `add` returns.
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

export interface CommentsContextValue {
  user: CommentUser | null
  comments: DocumentComment[]
  loading: boolean
  /** Last adapter failure of ANY kind (message) — the panel's banner.
   *  Cleared by the next successful fetch. */
  error: string | null
  /** Last FETCH failure only — gates reconciliation (a failed mutation must
   *  not freeze mark stripping; the list itself is still known-good). */
  listError: string | null
  /** Ids anchored this session that the backend has not listed yet (read
   *  lag) — reconciliation must preserve their marks until they appear. */
  pendingAnchorIds: ReadonlySet<string>
  /** Ids with a mutation in flight — the UI disables their actions. */
  busyIds: ReadonlySet<string>
  /** Merged label set ({@link DEFAULT_COMMENTS_LABELS} + `labels` prop). */
  labels: CommentsLabels
  draft: CommentDraft | null
  /** The comment highlighted in the document (clicked in the panel). */
  activeId: string | null
  refresh(): Promise<void>
  /**
   * Sends the draft. Resolves `true` when saved (draft cleared, list
   * refetched). `applyAnchor` receives the backend's id BETWEEN the save and
   * the refetch — the caller (the panel's composer) marks the draft range in
   * the document there, so the anchor exists before the comment lands in
   * state. If anchoring fails, the comment simply shows as orphaned.
   */
  addComment(text: string, applyAnchor?: (id: string) => void): Promise<boolean>
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

/** How many fetches a just-anchored id survives without the backend listing
 *  it (read replicas lag their write path) before its mark is strippable. */
const PENDING_ANCHOR_FETCHES = 3

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
  const [listError, setListError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<CommentDraft | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingAnchorIds, setPendingAnchorIds] = useState<ReadonlySet<string>>(new Set())
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  // Latest adapter without dependency churn: an inline adapter object must
  // not recreate refresh (that useEffect would refetch-loop).
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  // Race guard: only the LATEST fetch may land — a slow older list() must not
  // overwrite the refetch that followed a mutation.
  const fetchSeq = useRef(0)
  // Grace ledger for HIGH-consistency backends' read lag: id → fetches left.
  const pendingAnchorsRef = useRef(new Map<string, number>())
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
      // Grace bookkeeping: ids the backend now lists are done; unseen ids
      // survive a few more fetches, then expire (strippable).
      const pending = pendingAnchorsRef.current
      for (const [id, left] of pending) {
        if (list.some((comment) => comment.id === id) || left <= 1) pending.delete(id)
        else pending.set(id, left - 1)
      }
      setPendingAnchorIds(new Set(pending.keys()))
      setComments(list)
      setError(null)
      setListError(null)
    } catch (failure) {
      // Keep the last good list — an offline blip must not blank the panel.
      if (fetchSeq.current === ticket) {
        setError(messageOf(failure))
        setListError(messageOf(failure))
      }
    } finally {
      if (fetchSeq.current === ticket) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
    async (text: string, applyAnchor?: (id: string) => void) => {
      const body = text.trim()
      if (!draft || !body) return false
      let created: { id: string }
      try {
        created = await adapterRef.current.add({ text: body, quote: draft.quote })
      } catch (failure) {
        // The draft (and the composer's text, which the composer owns) survive
        // a failed save — nothing typed is lost.
        setError(messageOf(failure))
        return false
      }
      try {
        applyAnchor?.(created.id)
      } catch {
        // The comment is already saved backend-side; without its mark it
        // surfaces as orphaned in the panel — no reason to fail the save.
      }
      // The fresh mark must survive reconciliation even if the backend's
      // read path lags its write path and the refetch misses the comment.
      pendingAnchorsRef.current.set(created.id, PENDING_ANCHOR_FETCHES)
      setPendingAnchorIds(new Set(pendingAnchorsRef.current.keys()))
      setDraftState(null)
      await refresh()
      return true
    },
    [draft, refresh],
  )

  const replyToComment = useCallback(
    async (commentId: string, text: string) => {
      const body = text.trim()
      if (!body) return false
      return runExclusive(commentId, async () => {
        try {
          await adapterRef.current.reply(commentId, { text: body })
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
        // A resolved/archived comment leaves the open tab (and its mark leaves
        // the doc) — a lingering active highlight would point at nothing.
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
      listError,
      pendingAnchorIds,
      busyIds,
      labels: mergedLabels,
      draft,
      activeId,
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
    [user, comments, loading, error, listError, pendingAnchorIds, busyIds, mergedLabels, draft, activeId, refresh, addComment, replyToComment, updateComment, setCommentStatus, removeComment, setDraft, clearDraft],
  )

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

/** Null outside a provider — comment UI components render nothing then. */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext)
}
