// FAKE comments backend for the demo — the shape a real integration takes:
// implement `CommentsAdapter` over your HTTP client and hand it to
// `<CommentsProvider adapter={…}>`. Every call here logs the endpoint it
// stands in for and answers after ~300ms, so the refetch-after-write flow
// (add/delete → list) is visible in the console and in the panel.
import type { CommentsAdapter, CommentUser, DocumentComment } from '../features'

export const MOCK_USER: CommentUser = { id: 'u-diego', name: 'Diego Rodrigues' }

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function newId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createFakeCommentsAdapter(): CommentsAdapter {
  // The "database" — starts empty (the demo document starts blank too).
  let db: DocumentComment[] = []

  return {
    async list() {
      console.log('[comments api] GET /comments')
      await delay(300)
      return [...db]
    },
    async add(input) {
      console.log('[comments api] POST /comments', input)
      await delay(300)
      // The backend stamps identity (from the session) and timestamps.
      db = [...db, { ...input, id: newId(), author: MOCK_USER, createdAt: new Date().toISOString() }]
    },
    async remove(id) {
      console.log(`[comments api] DELETE /comments/${id}`)
      await delay(300)
      db = db.filter((comment) => comment.id !== id)
    },
  }
}
