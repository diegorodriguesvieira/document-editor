// FAKE comments backend for the demo app and the Storybook stories, split the
// way a REAL integration is:
//
//   ┌─ THE "SERVER" ──────────────────────────────────────────────────┐
//   │ one function per endpoint; owns the rows AND the saved document, │
//   │ mints ids, stamps authorship, computes permission flags per      │
//   │ request and VALIDATES anchor quotes against the saved JSON       │
//   └──────────────────────────────────────────────────────────────────┘
//                              ▲
//   ┌─ THE ADAPTER ────────────┴───────────────────────────────────────┐
//   │ one-liners mapping the SDK seam onto those endpoints — this is   │
//   │ ALL the frontend integration is                                  │
//   └──────────────────────────────────────────────────────────────────┘
//
// Demo knobs (plan §8): `latencyMs` delays every endpoint, `failNext` injects
// failures per endpoint kind (a kind stays failing while toggled on — the
// sync queue's automatic in-flush retry would otherwise eat a single-shot
// failure before anyone saw `saveFailed`), and `log` records every call so
// the stories can PROVE ordering (the doc PUT lands before any anchor PATCH).
import type { DocumentJSON } from '../editor'
import {
  PARENT_DELETED,
  STALE_CONTENT,
  type CommentNodeSegment,
  type CommentStatus,
  type CommentsAdapter,
  type CommentUser,
  type DocumentComment,
} from '../features'

export const MOCK_USER: CommentUser = { id: 'u-diego', name: 'Diego Rodrigues' }

/** ProseMirror JSON node, spelled through the SDK envelope — the app import
 *  boundary keeps `@tiptap/*` types out of this module (like a real backend). */
type JsonNode = DocumentJSON['doc']

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
  /** The external anchor (uid + node-local offsets) — see commentAnchor.ts. */
  nodes: CommentNodeSegment[]
  /** Soft delete: the row stays in `list()` as a tombstone (delta sync). */
  isDeleted?: boolean
  replies: StoredReply[]
}

/** An endpoint kind whose calls fail while toggled into {@link MockCommentsApi.failNext}. */
export type MockFailureKind = 'save' | 'add' | 'anchor'

export interface MockCommentsApi {
  /** Simulated network latency per endpoint call. Mutable — the story knob. */
  latencyMs: number
  /** Endpoint kinds currently failing (toggle on/off from the story). */
  readonly failNext: Set<MockFailureKind>
  /** Every endpoint call, in arrival order — the stories' ordering proof. */
  readonly log: string[]
  /** Notified after every log entry / row change (story inspectors). */
  subscribe(listener: () => void): () => void
  /** Snapshot of the raw rows — the stories' `nodes[]` inspector. */
  peekComments(): StoredComment[]

  /** PUT /template — the document save the doc-first pipeline waits on. */
  saveTemplate(json: DocumentJSON): Promise<{ savedAt: string }>
  listComments(): Promise<DocumentComment[]>
  addComment(input: {
    content: string
    quote: string
    nodes: CommentNodeSegment[]
  }): Promise<DocumentComment>
  updateAnchor(
    id: string,
    payload: { nodes: CommentNodeSegment[]; quote: string },
  ): Promise<DocumentComment>
  reply(commentId: string, input: { text: string }): Promise<void>
  update(id: string, input: { text: string }): Promise<void>
  setStatus(id: string, input: { status: CommentStatus }): Promise<void>
  remove(id: string): Promise<void>

  /** The SDK seam over this backend — hand it to `CommentsProvider`. */
  adapter: CommentsAdapter
}

const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/* ── The quote validator ─────────────────────────────────────────────
 *
 * Mirrors the backend's quote validator for demo purposes only — production
 * validation lives server-side. It resolves each `{id, from, to}` against the
 * SAVED JSON under the shared offset norm (the FE/BE contract pinned by
 * src/features/custom/commentAnchor.golden.ts): offsets are node-local
 * content offsets, 0-based, end-exclusive; text counts one per character;
 * NON-TEXT inline nodes (variable chips, hardBreak) count exactly 1 position
 * and quote nothing. Overshooting offsets clamp (read-side repair); a segment
 * that resolves to nothing contributes ''. Plain-JSON walk on purpose — this
 * module must not touch @tiptap (the app import boundary), exactly like the
 * real backend won't.
 */

function findByUid(node: JsonNode, uid: string): JsonNode | null {
  if ((node.attrs as Record<string, unknown> | undefined)?.uid === uid) return node
  for (const child of node.content ?? []) {
    const found = findByUid(child, uid)
    if (found) return found
  }
  return null
}

function segmentText(saved: JsonNode, segment: CommentNodeSegment): string {
  const node = findByUid(saved, segment.id)
  if (!node) return ''
  // Content pieces under the norm: text spans count their characters, every
  // other inline child occupies ONE position and contributes no text.
  const pieces = (node.content ?? []).map((child) =>
    child.type === 'text'
      ? { length: child.text?.length ?? 0, text: child.text ?? '' }
      : { length: 1, text: '' },
  )
  const size = pieces.reduce((total, piece) => total + piece.length, 0)
  const from = Math.max(0, Math.min(segment.from, size))
  const to = Math.max(0, Math.min(segment.to, size))
  if (from >= to) return ''
  let text = ''
  let offset = 0
  for (const piece of pieces) {
    const start = Math.max(from - offset, 0)
    const end = Math.min(to - offset, piece.length)
    if (start < end) text += piece.text.slice(start, end)
    offset += piece.length
  }
  return text
}

/** The quote a `nodes[]` array covers in the saved doc, in ARRAY order. */
function quoteOf(saved: JsonNode, nodes: readonly CommentNodeSegment[]): string {
  return nodes.map((segment) => segmentText(saved, segment)).join('')
}

const codedError = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

/**
 * A whole fake comments BACKEND: rows + the saved document, one function per
 * endpoint, the permission serializer and the quote validator. `sessionUser`
 * is who the requests run as (a real server reads it from auth); `ownerId` is
 * the document's owner — the moderator (defaults to the session user).
 * `template` seeds the "saved" doc so seeded anchors validate from the start.
 */
export function createMockCommentsApi({
  sessionUser,
  ownerId = sessionUser.id,
  seed = [],
  template = null,
  latencyMs = 400,
}: {
  sessionUser: CommentUser
  ownerId?: string
  seed?: StoredComment[]
  template?: DocumentJSON | null
  latencyMs?: number
}): MockCommentsApi {
  // The "database": comment rows + the last-saved document JSON.
  let db: StoredComment[] = seed.map((row) => ({ ...row, replies: [...row.replies] }))
  let savedDoc: JsonNode | null = template?.doc ?? null

  const log: string[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const failNext = new Set<MockFailureKind>()

  /** Latency + logging + failure injection — every endpoint enters here. */
  const call = async (kind: MockFailureKind | null, entry: string) => {
    log.push(entry)
    console.log(`[comments api] ${entry}`)
    notify()
    await new Promise((resolve) => setTimeout(resolve, api.latencyMs))
    if (kind && failNext.has(kind)) {
      throw new Error(`Injected ${kind} failure (story toggle)`)
    }
  }

  /**
   * The permission SERIALIZER — the one genuinely non-trivial piece of a real
   * backend integration. For each row it answers "what may the user of THIS
   * session do with THIS comment?", and the editor renders buttons from these
   * booleans alone. Soft-deleted tombstones grant nothing.
   */
  const serialize = (row: StoredComment): DocumentComment => {
    const isAuthor = row.author.id === sessionUser.id
    const isOwner = ownerId === sessionUser.id
    const isOpen = row.status === 'OPEN' && !row.isDeleted
    return {
      id: row.id,
      quote: row.quote,
      text: row.text,
      author: row.author,
      createdAt: row.createdAt,
      status: row.status,
      nodes: row.nodes.map((segment) => ({ ...segment })),
      ...(row.isDeleted ? { isDeleted: true } : {}),
      canEdit: isAuthor && isOpen,
      canReply: isOpen,
      canDelete: !row.isDeleted && (isAuthor || isOwner),
      canResolve: isOpen,
      canArchive: isOpen,
      replies: row.replies.map((reply) => ({
        ...reply,
        canEdit: !row.isDeleted && reply.author.id === sessionUser.id,
        canDelete: !row.isDeleted && (reply.author.id === sessionUser.id || isOwner),
      })),
    }
  }

  const rowOf = (id: string): StoredComment => {
    const row = db.find((candidate) => candidate.id === id)
    if (!row) throw new Error(`Comment ${id} not found`)
    return row
  }

  /** STALE_CONTENT gate shared by create + anchor PATCH. Nothing saved yet →
   *  nothing to validate against (demo convenience; a real backend always
   *  has the stored doc). */
  const validateQuote = (nodes: readonly CommentNodeSegment[], quote: string) => {
    if (!savedDoc) return
    if (quoteOf(savedDoc, nodes) !== quote) {
      throw codedError(STALE_CONTENT, 'The quoted text no longer matches the saved document.')
    }
  }

  /** Structural nodes[] validation (contract §9.3): integer offsets with
   *  0 ≤ from < to, per-id segments non-overlapping with touching ones fused,
   *  a ~100-entry cap; `nodes: []` stays legal (a document-level comment).
   *  Mirrors the backend's checks for demo purposes only — production
   *  validation lives server-side. */
  const validateNodes = (nodes: readonly CommentNodeSegment[]) => {
    if (nodes.length > 100) {
      throw codedError('INVALID_NODES', 'nodes[] exceeds the 100-entry cap.')
    }
    const perId = new Map<string, CommentNodeSegment[]>()
    for (const segment of nodes) {
      if (
        !Number.isInteger(segment.from) ||
        !Number.isInteger(segment.to) ||
        segment.from < 0 ||
        segment.from >= segment.to
      ) {
        throw codedError('INVALID_NODES', 'Each segment needs integers 0 <= from < to.')
      }
      const list = perId.get(segment.id) ?? []
      list.push(segment)
      perId.set(segment.id, list)
    }
    for (const list of perId.values()) {
      const sorted = [...list].sort((a, b) => a.from - b.from)
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from <= sorted[i - 1].to) {
          throw codedError('INVALID_NODES', 'Per-id segments must not overlap or touch — fuse them.')
        }
      }
    }
  }

  const api: MockCommentsApi = {
    latencyMs,
    failNext,
    log,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    peekComments: () => db.map((row) => ({ ...row, replies: [...row.replies] })),

    saveTemplate: async (json) => {
      await call('save', 'PUT /template')
      savedDoc = json.doc
      notify()
      return { savedAt: new Date().toISOString() }
    },

    listComments: async () => {
      await call(null, 'GET /comments')
      return db.map(serialize)
    },

    addComment: async (input) => {
      await call('add', 'POST /comments')
      validateNodes(input.nodes)
      validateQuote(input.nodes, input.quote)
      const created: StoredComment = {
        id: newId('c'),
        quote: input.quote,
        text: input.content,
        author: sessionUser,
        createdAt: new Date().toISOString(),
        status: 'OPEN',
        nodes: input.nodes.map((segment) => ({ ...segment })),
        replies: [],
      }
      db = [...db, created]
      notify()
      return serialize(created) // full row — the optimistic card
    },

    updateAnchor: async (id, payload) => {
      await call('anchor', `PATCH /comments/${id}/anchor`)
      validateNodes(payload.nodes)
      validateQuote(payload.nodes, payload.quote)
      const row = rowOf(id)
      db = db.map((candidate) =>
        candidate.id === id
          ? { ...candidate, nodes: payload.nodes.map((s) => ({ ...s })), quote: payload.quote }
          : candidate,
      )
      notify()
      return serialize({ ...row, nodes: payload.nodes.map((s) => ({ ...s })), quote: payload.quote })
    },

    reply: async (commentId, input) => {
      await call(null, `POST /comments/${commentId}/replies`)
      const row = rowOf(commentId)
      // Replying to a soft-deleted parent is REJECTED (410) — the panel keeps
      // the typed text and says so.
      if (row.isDeleted) throw codedError(PARENT_DELETED, 'This comment was deleted.')
      const reply: StoredReply = {
        id: newId('r'),
        text: input.text,
        author: sessionUser,
        createdAt: new Date().toISOString(),
      }
      db = db.map((candidate) =>
        candidate.id === commentId
          ? { ...candidate, replies: [...candidate.replies, reply] }
          : candidate,
      )
      notify()
    },

    update: async (id, input) => {
      await call(null, `PATCH /comments/${id}`)
      db = db.map((row) =>
        row.id === id
          ? { ...row, text: input.text }
          : {
              ...row,
              replies: row.replies.map((reply) =>
                reply.id === id ? { ...reply, text: input.text } : reply,
              ),
            },
      )
      notify()
    },

    setStatus: async (id, input) => {
      await call(null, `PATCH /comments/${id}/status`)
      db = db.map((row) => (row.id === id ? { ...row, status: input.status } : row))
      notify()
    },

    remove: async (id) => {
      await call(null, `DELETE /comments/${id}`)
      // SOFT delete for comment rows (tombstone stays in list); replies are
      // simply removed from their thread.
      db = db.map((row) =>
        row.id === id
          ? { ...row, isDeleted: true }
          : { ...row, replies: row.replies.filter((reply) => reply.id !== id) },
      )
      notify()
    },

    /* ──────────────────────── THE ADAPTER ──────────────────────── */
    // The whole frontend integration: one line per SDK method, delegating to
    // the endpoints above. A real app swaps each call for its HTTP client —
    // the session user comes from the auth layer instead of the closure.
    adapter: {
      list: () => api.listComments(),
      add: (input) =>
        api.addComment({ content: input.text, quote: input.quote, nodes: input.nodes ?? [] }),
      reply: (commentId, input) => api.reply(commentId, input),
      update: (id, input) => api.update(id, input),
      setStatus: (id, input) => api.setStatus(id, input),
      remove: (id) => api.remove(id),
      updateAnchor: (id, payload) => api.updateAnchor(id, payload),
    },
  }

  return api
}

/** The demo app's backend: empty database, you are author AND doc owner. */
export function createFakeCommentsApi(): MockCommentsApi {
  return createMockCommentsApi({ sessionUser: MOCK_USER, latencyMs: 300 })
}
