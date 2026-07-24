// FAKE comments backend for the demo, split the way a REAL integration is:
//
//   ┌─ THE "SERVER" ──────────────────────────────────────────────────┐
//   │ one function per endpoint; owns the rows, mints ids, stamps      │
//   │ authorship and COMPUTES the permission flags per request         │
//   └──────────────────────────────────────────────────────────────────┘
//                              ▲
//   ┌─ THE ADAPTER ────────────┴───────────────────────────────────────┐
//   │ six one-liners mapping the SDK seam onto those endpoints — this  │
//   │ is ALL the frontend integration is                               │
//   └──────────────────────────────────────────────────────────────────┘
//
// Every endpoint logs the route it stands in for and answers after ~300ms,
// so the refetch-after-write flow (mutation → list) is visible in the
// console and in the panel.
import type {
  CommentStatus,
  CommentsAdapter,
  CommentUser,
  DocumentComment,
} from '../features'

export const MOCK_USER: CommentUser = { id: 'u-diego', name: 'Diego Rodrigues' }

/* ────────────────────────── THE "SERVER" ────────────────────────── */

/** What the server STORES — note: no permission flags. Flags are not data,
 *  they are decisions, computed per request by the serializer below. */
export interface StoredReply {
  id: string
  text: string
  author: CommentUser
  createdAt: string
}

export interface StoredComment {
  id: string
  quote: string
  text: string
  author: CommentUser
  createdAt: string
  status: CommentStatus
  replies: StoredReply[]
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * A whole fake comments BACKEND: its own rows (optionally seeded), one
 * function per endpoint, and the permission serializer. `sessionUser` is who
 * the requests run as (a real server reads it from auth); `ownerId` is the
 * document's owner — the moderator (defaults to the session user).
 */
export function createFakeCommentsBackend({
  sessionUser,
  ownerId = sessionUser.id,
  seed = [],
  latencyMs = 300,
}: {
  sessionUser: CommentUser
  ownerId?: string
  seed?: StoredComment[]
  latencyMs?: number
}): CommentsAdapter {
  // The "database".
  let db: StoredComment[] = seed.map((row) => ({ ...row, replies: [...row.replies] }))

  /**
   * The permission SERIALIZER — the one genuinely non-trivial piece of a
   * real backend integration. For each row it answers "what may the user of
   * THIS session do with THIS comment?", and the editor renders buttons from
   * these booleans alone. Change the rules here and the right buttons
   * appear/vanish with zero frontend changes.
   */
  const serializeComment = (row: StoredComment): DocumentComment => {
    const isAuthor = row.author.id === sessionUser.id
    const isOwner = ownerId === sessionUser.id
    const isOpen = row.status === 'open'
    return {
      id: row.id,
      quote: row.quote,
      text: row.text,
      author: row.author,
      createdAt: row.createdAt,
      status: row.status,
      // You may edit YOUR words; the doc owner may moderate (delete)
      // anything; any session may reply/resolve/archive an open thread.
      canEdit: isAuthor && isOpen,
      canReply: isOpen,
      canDelete: isAuthor || isOwner,
      canResolve: isOpen,
      canArchive: isOpen,
      replies: row.replies.map((reply) => ({
        ...reply,
        canEdit: reply.author.id === sessionUser.id,
        canDelete: reply.author.id === sessionUser.id || isOwner,
      })),
    }
  }

  /** GET /documents/:docId/comments */
  async function getComments(): Promise<DocumentComment[]> {
    console.log('[comments api] GET /comments')
    await delay(latencyMs)
    return db.map(serializeComment)
  }

  /** POST /documents/:docId/comments — mints the id and RETURNS it: the
   *  editor anchors the comment's mark with it. */
  async function postComment(body: { text: string; quote: string }): Promise<{ id: string }> {
    console.log('[comments api] POST /comments', body)
    await delay(latencyMs)
    const created: StoredComment = {
      ...body,
      id: newId('c'),
      author: sessionUser,
      createdAt: new Date().toISOString(),
      status: 'open',
      replies: [],
    }
    db = [...db, created]
    return { id: created.id }
  }

  /** POST /comments/:commentId/replies */
  async function postReply(commentId: string, body: { text: string }): Promise<void> {
    console.log(`[comments api] POST /comments/${commentId}/replies`, body)
    await delay(latencyMs)
    const reply: StoredReply = {
      ...body,
      id: newId('r'),
      author: sessionUser,
      createdAt: new Date().toISOString(),
    }
    db = db.map((row) =>
      row.id === commentId ? { ...row, replies: [...row.replies, reply] } : row,
    )
  }

  /** PATCH /comments/:id — ids are globally unique, so the server resolves
   *  comment-vs-reply here (a nested-route API would do the same lookup). */
  async function patchComment(id: string, body: { text: string }): Promise<void> {
    console.log(`[comments api] PATCH /comments/${id}`, body)
    await delay(latencyMs)
    db = db.map((row) =>
      row.id === id
        ? { ...row, text: body.text }
        : {
            ...row,
            replies: row.replies.map((reply) =>
              reply.id === id ? { ...reply, text: body.text } : reply,
            ),
          },
    )
  }

  /** PATCH /comments/:id/status */
  async function patchCommentStatus(id: string, body: { status: CommentStatus }): Promise<void> {
    console.log(`[comments api] PATCH /comments/${id}/status`, body)
    await delay(latencyMs)
    db = db.map((row) => (row.id === id ? { ...row, status: body.status } : row))
  }

  /** DELETE /comments/:id — comment OR reply id, same as PATCH. */
  async function deleteComment(id: string): Promise<void> {
    console.log(`[comments api] DELETE /comments/${id}`)
    await delay(latencyMs)
    db = db
      .filter((row) => row.id !== id)
      .map((row) => ({ ...row, replies: row.replies.filter((reply) => reply.id !== id) }))
  }

  /* ──────────────────────── THE ADAPTER ──────────────────────── */

  // The whole frontend integration: one line per SDK method, delegating to
  // your endpoints. A real app swaps each call for its HTTP client
  // (`api.get('/documents/42/comments')`, …) — the session user comes from
  // the auth layer instead of the closure.
  return {
    list: () => getComments(),
    add: (input) => postComment(input),
    reply: (commentId, input) => postReply(commentId, input),
    update: (id, input) => patchComment(id, input),
    setStatus: (id, input) => patchCommentStatus(id, input),
    remove: (id) => deleteComment(id),
  }
}

/** The demo app's backend: empty database, you are author AND doc owner. */
export function createFakeCommentsAdapter(): CommentsAdapter {
  return createFakeCommentsBackend({ sessionUser: MOCK_USER })
}
