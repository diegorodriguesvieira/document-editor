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
// failures per endpoint kind (a kind stays failing while toggled on, so the
// stories can show the retry banner across several pump cycles instead of a
// single-shot blip), and `log` records every call so the stories can PROVE
// the atomicity: ONE `saveEnvelope` entry carries the document, the moved
// anchors and the new comments together.
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
export type MockFailureKind = 'save' | 'add'

/* ── The atomic save envelope ────────────────────────────────────────
 *
 * ONE transactional request replacing PUT-doc-then-PATCH-anchors: the new
 * document travels together with every anchor it moved and every comment it
 * created, and the server writes ALL of it or NONE of it. Two consequences
 * worth naming, because they are the whole point of the shape:
 *
 *   • quotes are validated against the doc IN THE REQUEST, not the stored one
 *     — the frontend derives both from the same snapshot, so a mismatch can
 *     only be a frontend bug, never a concurrent edit;
 *   • `versionId` is the optimistic-concurrency token — only the holder of the
 *     current version may save, so a save can never silently clobber one that
 *     landed in between.
 */

/** Optimistic-concurrency rejection: the envelope carried a stale `versionId`. */
export const VERSION_CONFLICT = 'VERSION_CONFLICT'

/**
 * Recognizes {@link VERSION_CONFLICT} in any of the shapes it may arrive in —
 * lives HERE, next to the code that throws it: whoever defines a rejection
 * owns identifying it, or every caller reinvents a weaker check.
 *
 * This is what a consumer hands the save layer as `shouldStop`: another
 * session owns the document now, so every retry would be rejected identically
 * and saving must stop instead of promising a retry it cannot deliver.
 */
export const isVersionConflict = (failure: unknown): boolean => {
  if (typeof failure === 'string') return failure.includes(VERSION_CONFLICT)
  if (typeof failure !== 'object' || failure === null) return false
  const { code, message } = failure as { code?: unknown; message?: unknown }
  if (code === VERSION_CONFLICT) return true
  return typeof message === 'string' && message.includes(VERSION_CONFLICT)
}

/** An existing comment whose anchor moved in this save. */
export interface SaveEnvelopeAnchor {
  id: string
  nodes: CommentNodeSegment[]
  quote: string
}

/** A comment created in this save. `tempId` is the frontend's placeholder id,
 *  mapped back to the minted row in {@link SaveEnvelopeResult.created}. */
export interface SaveEnvelopeCreate {
  tempId: string
  text: string
  nodes: CommentNodeSegment[]
  quote: string
}

export interface SaveEnvelope {
  /** The version this save is based on — must be the server's current one. */
  versionId: number
  doc: JsonNode
  anchors: SaveEnvelopeAnchor[]
  creates: SaveEnvelopeCreate[]
}

export interface SaveEnvelopeResult {
  /** The version the accepted save produced — the client's new token. */
  versionId: number
  savedAt: string
  created: Array<{ tempId: string; row: DocumentComment }>
}

export interface MockCommentsApi {
  /** Simulated network latency per endpoint call. Mutable — the story knob. */
  latencyMs: number
  /** Endpoint kinds currently failing (toggle on/off from the story). */
  readonly failNext: Set<MockFailureKind>
  /** Every endpoint call, in arrival order — the stories' ordering proof. */
  readonly log: string[]
  /** The document's current version — starts at 1, bumped by every accepted
   *  {@link MockCommentsApi.saveEnvelope}. Only its holder may save. */
  readonly versionId: number
  /** Notified after every log entry / row change (story inspectors). */
  subscribe(listener: () => void): () => void
  /** Snapshot of the raw rows — the stories' `nodes[]` inspector. */
  peekComments(): StoredComment[]

  /** PUT /template (envelope) — doc + moved anchors + new comments, written
   *  as ONE transaction. See {@link SaveEnvelope}. */
  saveEnvelope(envelope: SaveEnvelope): Promise<SaveEnvelopeResult>
  listComments(): Promise<DocumentComment[]>
  addComment(input: {
    content: string
    quote: string
    nodes: CommentNodeSegment[]
  }): Promise<DocumentComment>
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
  let versionId = 1

  const log: string[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const failNext = new Set<MockFailureKind>()

  /** One line in the call log (the dashboard's request list) plus the
   *  inspector ping. Rejections that never reach an endpoint body log here too. */
  const logCall = (entry: string) => {
    log.push(entry)
    notify()
  }

  /* ── The console trace ──────────────────────────────────────────────
   *
   * A demo backend is only useful if you can SEE what crossed the wire, so
   * every call opens a collapsed group carrying the actual payload: what the
   * editor sent, and what came back. Anchors and comment rows print as tables
   * (one line per segment/row) because that is the shape people actually
   * compare; the document goes in as an object you can expand.
   */
  /** Silent under Vitest: the trace is a DEMO affordance (Storybook / the app
   *  in a browser), and tables in the test reporter are just noise. */
  const TRACING =
    typeof process === 'undefined' || (process as { env?: Record<string, unknown> }).env?.VITEST == null

  const BADGE = 'padding:1px 5px;border-radius:3px;font-weight:600;'
  const TONE: Record<'in' | 'ok' | 'fail', string> = {
    in: `${BADGE}background:#1a73e8;color:#fff`,
    ok: `${BADGE}background:#188038;color:#fff`,
    fail: `${BADGE}background:#c5221f;color:#fff`,
  }

  const traceRequest = (entry: string, payload?: Record<string, unknown>) => {
    if (!TRACING) return
    console.groupCollapsed(`%c→ ${entry}%c`, TONE.in, 'color:inherit')
    if (payload) {
      for (const [key, value] of Object.entries(payload)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          console.log(`${key}: ${value.length}`)
          console.table(value as Record<string, unknown>[])
        } else if (Array.isArray(value) && value.length === 0) {
          console.log(`${key}: (none)`)
        } else {
          console.log(`${key}:`, value)
        }
      }
    }
    console.groupEnd()
  }

  const traceResult = (entry: string, result: unknown) => {
    if (!TRACING) return
    console.groupCollapsed(`%c← ${entry}%c`, TONE.ok, 'color:inherit')
    if (Array.isArray(result) && result.length > 0) console.table(result)
    else console.log(result)
    console.groupEnd()
  }

  const traceFailure = (entry: string, failure: unknown) => {
    if (!TRACING) return
    const code = (failure as { code?: string } | null)?.code ?? 'ERROR'
    console.groupCollapsed(`%c✕ ${entry} — ${code}%c`, TONE.fail, 'color:inherit')
    console.log(failure)
    console.groupEnd()
  }

  /** Latency + logging + failure injection — every endpoint enters here. */
  const call = async (
    kind: MockFailureKind | null,
    entry: string,
    payload?: Record<string, unknown>,
  ) => {
    logCall(entry)
    traceRequest(entry, payload)
    await new Promise((resolve) => setTimeout(resolve, api.latencyMs))
    if (kind && failNext.has(kind)) {
      const failure = new Error(`Injected ${kind} failure (story toggle)`)
      traceFailure(entry, failure)
      throw failure
    }
  }

  /** Run an endpoint body so its RESULT (or rejection) is traced too. */
  const traced = <T>(entry: string, body: () => T): T => {
    try {
      const result = body()
      traceResult(entry, result)
      return result
    } catch (failure) {
      traceFailure(entry, failure)
      throw failure
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
    get versionId() {
      return versionId
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    peekComments: () => db.map((row) => ({ ...row, replies: [...row.replies] })),

    saveEnvelope: async (envelope) => {
      // The injected 'save' failure and the latency apply to the envelope as a
      // whole — there is no half of it to fail on its own.
      await call('save', 'PUT /template (envelope)', {
        versionId: envelope.versionId,
        anchors: envelope.anchors.flatMap((anchor) =>
          anchor.nodes.map((node) => ({
            comment: anchor.id,
            uid: node.id,
            from: node.from,
            to: node.to,
            quote: anchor.quote,
          })),
        ),
        creates: envelope.creates.map((create) => ({
          tempId: create.tempId,
          text: create.text,
          quote: create.quote,
          segments: create.nodes.length,
        })),
        doc: envelope.doc,
      })

      // Optimistic concurrency FIRST: a stale token means someone else already
      // saved, so this whole request is built on a document that no longer
      // exists. Reject it and write nothing — the frontend refreshes and redoes
      // the work against the version it gets back.
      if (envelope.versionId !== versionId) {
        logCall('409 PUT /template (stale versionId)')
        traceFailure('PUT /template (envelope)', {
          code: VERSION_CONFLICT,
          sent: envelope.versionId,
          current: versionId,
        })
        throw codedError(
          VERSION_CONFLICT,
          'The document changed elsewhere — refresh to get the latest version.',
        )
      }

      // An anchor whose row was deleted through the immediate channel while
      // this envelope flew is a SKIPPABLE no-op, not an error: the deletion
      // already won, and there is nothing left to update. Rejecting would
      // hold the document save hostage to a race the editor cannot see.
      const liveAnchors = envelope.anchors.filter((anchor) => {
        const row = db.find((candidate) => candidate.id === anchor.id)
        return row != null && !row.isDeleted
      })

      // Everything is validated before anything is written. Anchors and creates
      // are held to the same two checks, so the loops take them together.
      const anchored: readonly { nodes: CommentNodeSegment[]; quote: string }[] = [
        ...liveAnchors,
        ...envelope.creates,
      ]
      for (const entry of anchored) validateNodes(entry.nodes)
      // Against the doc IN THIS REQUEST, not the stored one: both come from the
      // same frontend snapshot, so a mismatch is a bug on that side, not a
      // concurrent edit (that case is the versionId guard above).
      for (const entry of anchored) {
        if (quoteOf(envelope.doc, entry.nodes) !== entry.quote) {
          throw codedError(
            STALE_CONTENT,
            'The quoted text does not match the document in this request.',
          )
        }
      }

      // APPLY — plain synchronous mutations with no await between them, so no
      // caller can ever observe half a save.
      savedDoc = envelope.doc
      versionId += 1
      const moved = new Map(liveAnchors.map((anchor) => [anchor.id, anchor]))
      const created: { tempId: string; row: StoredComment }[] = envelope.creates.map((create) => ({
        tempId: create.tempId,
        row: {
          id: newId('c'),
          quote: create.quote,
          text: create.text,
          author: sessionUser,
          createdAt: new Date().toISOString(),
          status: 'OPEN',
          nodes: create.nodes.map((segment) => ({ ...segment })),
          replies: [],
        },
      }))
      db = [
        ...db.map((row) => {
          const anchor = moved.get(row.id)
          return anchor
            ? { ...row, nodes: anchor.nodes.map((s) => ({ ...s })), quote: anchor.quote }
            : row
        }),
        ...created.map((entry) => entry.row),
      ]
      notify() // once for the whole transaction, not once per row
      const result: SaveEnvelopeResult = {
        versionId,
        savedAt: new Date().toISOString(),
        created: created.map((entry) => ({ tempId: entry.tempId, row: serialize(entry.row) })),
      }
      traceResult('PUT /template (envelope)', {
        versionId: result.versionId,
        savedAt: result.savedAt,
        anchorsWritten: moved.size,
        created: result.created.map((entry) => ({ tempId: entry.tempId, id: entry.row.id })),
      })
      return result
    },

    listComments: async () => {
      await call(null, 'GET /comments')
      return traced('GET /comments', () =>
        db.map(serialize).map((row) => ({ ...row })),
      )
    },

    addComment: async (input) => {
      await call('add', 'POST /comments', {
        text: input.content,
        quote: input.quote,
        nodes: input.nodes.map((node) => ({ uid: node.id, from: node.from, to: node.to })),
      })
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


    reply: async (commentId, input) => {
      await call(null, `POST /comments/${commentId}/replies`, { text: input.text })
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
      await call(null, `PATCH /comments/${id}`, { text: input.text })
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
      await call(null, `PATCH /comments/${id}/status`, { status: input.status })
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
    },
  }

  return api
}

/** The demo app's backend: empty database, you are author AND doc owner. */
export function createFakeCommentsApi(): MockCommentsApi {
  return createMockCommentsApi({ sessionUser: MOCK_USER, latencyMs: 300 })
}
