// FAKE comments backend for the demo — the shape a real integration takes:
// implement `CommentsAdapter` over your HTTP client and hand it to
// `<CommentsProvider adapter={…}>`. Every call here logs the endpoint it
// stands in for and answers after ~300ms, so the refetch-after-write flow
// (add/reply/edit/delete → list) is visible in the console and in the panel.
//
// Permissions (`canEdit`/`canReply`/`canDelete`) are the BACKEND's to stamp,
// per comment and per reply — this fake grants everything on content it
// creates, the way a real backend grants on your own session's content.
import type { CommentReply, CommentsAdapter, CommentUser, DocumentComment } from '../features'

export const MOCK_USER: CommentUser = { id: 'u-diego', name: 'Diego Rodrigues' }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createFakeCommentsAdapter(): CommentsAdapter {
  // The "database" — starts empty (the demo document starts blank too).
  let db: DocumentComment[] = []

  return {
    async list() {
      console.log('[comments api] GET /comments')
      await delay(300)
      // Deep copy — nested `replies` must not alias the db.
      return db.map((comment) => ({
        ...comment,
        replies: comment.replies?.map((reply) => ({ ...reply })),
      }))
    },
    async add(input) {
      console.log('[comments api] POST /comments', input)
      await delay(300)
      // The backend stamps identity (from the session), timestamps, the ID
      // (returned so the frontend can anchor the comment's mark) and the
      // permission flags.
      const created: DocumentComment = {
        ...input,
        id: newId('c'),
        author: MOCK_USER,
        createdAt: new Date().toISOString(),
        status: 'open',
        canEdit: true,
        canReply: true,
        canDelete: true,
        canResolve: true,
        canArchive: true,
        replies: [],
      }
      db = [...db, created]
      return created
    },
    async reply(commentId, input) {
      console.log(`[comments api] POST /comments/${commentId}/replies`, input)
      await delay(300)
      const reply: CommentReply = {
        ...input,
        id: newId('r'),
        author: MOCK_USER,
        createdAt: new Date().toISOString(),
        canEdit: true,
        canDelete: true,
      }
      db = db.map((comment) =>
        comment.id === commentId
          ? { ...comment, replies: [...(comment.replies ?? []), reply] }
          : comment,
      )
    },
    async update(id, input) {
      console.log(`[comments api] PATCH /comments/${id}`, input)
      await delay(300)
      // IDs are globally unique — resolve comment-or-reply right here.
      db = db.map((comment) =>
        comment.id === id
          ? { ...comment, text: input.text }
          : {
              ...comment,
              replies: comment.replies?.map((reply) =>
                reply.id === id ? { ...reply, text: input.text } : reply,
              ),
            },
      )
    },
    async setStatus(id, input) {
      console.log(`[comments api] PATCH /comments/${id}/status`, input)
      await delay(300)
      db = db.map((comment) =>
        comment.id === id ? { ...comment, status: input.status } : comment,
      )
    },
    async remove(id) {
      console.log(`[comments api] DELETE /comments/${id}`)
      await delay(300)
      db = db
        .filter((comment) => comment.id !== id)
        .map((comment) => ({
          ...comment,
          replies: comment.replies?.filter((reply) => reply.id !== id),
        }))
    },
  }
}
