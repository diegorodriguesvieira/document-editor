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

/** Who is reviewing. Provided by the consumer; omit for anonymous commenting. */
export interface CommentUser {
  id: string
  name: string
  avatarUrl?: string
}

/**
 * A comment as the BACKEND owns it. The anchor is a plain `{from,to}` range in
 * the document the review is looking at (plus the quoted text for context /
 * future re-anchoring) — comments are rendered as decorations, so the document
 * itself never carries them.
 */
export interface DocumentComment {
  id: string
  from: number
  to: number
  quote: string
  text: string
  author: CommentUser
  createdAt: string
}

/**
 * The consumer's endpoint seam — the ONE place that decides which API backs
 * comments. Every mutation is followed by a `list()` refetch (no optimistic
 * updates), so the panel always mirrors the server.
 * `add` carries no author: the backend stamps it from the session.
 */
export interface CommentsAdapter {
  list(): Promise<DocumentComment[]>
  add(input: { text: string; quote: string; from: number; to: number }): Promise<unknown>
  remove(id: string): Promise<unknown>
}

/** A comment being written: the captured selection, before it has an id. */
export interface CommentDraft {
  from: number
  to: number
  quote: string
}

export interface CommentsContextValue {
  user: CommentUser | null
  comments: DocumentComment[]
  loading: boolean
  /** Last adapter failure (message) — cleared by the next successful fetch. */
  error: string | null
  draft: CommentDraft | null
  /** The comment highlighted in the document (clicked in the panel). */
  activeId: string | null
  refresh(): Promise<void>
  /** Sends the draft. Resolves `true` when saved (draft cleared, list refetched). */
  addComment(text: string): Promise<boolean>
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
 * Review-mode comments state, owned by the CONSUMER's shell (same pattern as
 * {@link DocumentVariablesProvider}: context, not the `features` list, so
 * fetches never recreate the editor). Fetches on mount and after every
 * mutation; the adapter decides the endpoints.
 */
export function CommentsProvider({
  user,
  adapter,
  children,
}: {
  user?: CommentUser
  adapter: CommentsAdapter
  children: ReactNode
}) {
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<CommentDraft | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Race guard: only the LATEST fetch may land — a slow older list() must not
  // overwrite the refetch that followed a mutation.
  const fetchSeq = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++fetchSeq.current
    setLoading(true)
    try {
      const list = await adapter.list()
      if (fetchSeq.current !== ticket) return
      setComments(list)
      setError(null)
    } catch (failure) {
      // Keep the last good list — an offline blip must not blank the panel.
      if (fetchSeq.current === ticket) setError(messageOf(failure))
    } finally {
      if (fetchSeq.current === ticket) setLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addComment = useCallback(
    async (text: string) => {
      const body = text.trim()
      if (!draft || !body) return false
      try {
        await adapter.add({ text: body, quote: draft.quote, from: draft.from, to: draft.to })
      } catch (failure) {
        // The draft (and the composer's text, which the composer owns) survive
        // a failed save — nothing typed is lost.
        setError(messageOf(failure))
        return false
      }
      setDraftState(null)
      await refresh()
      return true
    },
    [adapter, draft, refresh],
  )

  const removeComment = useCallback(
    async (id: string) => {
      try {
        await adapter.remove(id)
      } catch (failure) {
        setError(messageOf(failure))
        return false
      }
      setActiveId((current) => (current === id ? null : current))
      await refresh()
      return true
    },
    [adapter, refresh],
  )

  const setDraft = useCallback((next: CommentDraft) => setDraftState(next), [])
  const clearDraft = useCallback(() => setDraftState(null), [])

  const value = useMemo<CommentsContextValue>(
    () => ({
      user: user ?? null,
      comments,
      loading,
      error,
      draft,
      activeId,
      refresh,
      addComment,
      removeComment,
      setDraft,
      clearDraft,
      setActiveId,
    }),
    [user, comments, loading, error, draft, activeId, refresh, addComment, removeComment, setDraft, clearDraft],
  )

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

/** Null outside a provider — comment UI components render nothing then. */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext)
}
