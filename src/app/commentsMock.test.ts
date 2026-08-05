import { describe, expect, it } from 'vitest'
import { isParentDeletedError, isStaleContentError } from '../features'
// The shared FE/BE offset-contract fixture — the mock's validator must agree
// with it verbatim, exactly like the real backend's validator must.
import { COMMENT_ANCHOR_GOLDEN_VECTORS } from '../features/custom/commentAnchor.golden'
import {
  createMockCommentsApi,
  MOCK_USER,
  VERSION_CONFLICT,
  type SaveEnvelope,
  type StoredComment,
} from './commentsMock'

const zeroLatency = (over: Partial<Parameters<typeof createMockCommentsApi>[0]> = {}) =>
  createMockCommentsApi({ sessionUser: MOCK_USER, latencyMs: 0, ...over })

const PLAIN_DOC = COMMENT_ANCHOR_GOLDEN_VECTORS[0].doc

const seedRow = (over: Partial<StoredComment> = {}): StoredComment => ({
  id: 'c-seed',
  quote: 'hello',
  text: 'seeded',
  author: MOCK_USER,
  createdAt: '2026-07-15T12:00:00Z',
  status: 'OPEN',
  nodes: [{ id: 'p-plain', from: 0, to: 5 }],
  replies: [],
  ...over,
})

const hasCode = (code: string) => (failure: unknown) =>
  typeof failure === 'object' && failure !== null && (failure as { code?: unknown }).code === code

describe('mock quote validator (mirrors the backend, per the golden vectors)', () => {
  it('accepts every golden vector: the resolved text IS the quote', async () => {
    for (const vector of COMMENT_ANCHOR_GOLDEN_VECTORS) {
      const api = zeroLatency({ template: { doc: vector.doc } })
      // Unresolvable segments (`text: null`) contribute '' — a quote of ''
      // is exactly what the FE derives for them, so it validates.
      const created = await api.addComment({
        content: `golden: ${vector.name}`,
        nodes: [vector.segment],
        quote: vector.text ?? '',
      })
      expect(created.id, vector.name).toBeTruthy()
      expect(created.nodes, vector.name).toEqual([vector.segment])
    }
  })

  it('rejects a stale quote with STALE_CONTENT on a review-mode add', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC } })

    await expect(
      api.addComment({
        content: 'stale create',
        nodes: [{ id: 'p-plain', from: 0, to: 5 }],
        quote: 'goodbye', // the saved doc says 'hello'
      }),
    ).rejects.toSatisfy(isStaleContentError)

    // The matching quote goes through. (Anchor rewrites have no endpoint of
    // their own anymore — they ride the save envelope, validated there.)
    await expect(
      api.addComment({
        content: 'fresh',
        nodes: [{ id: 'p-plain', from: 0, to: 5 }],
        quote: 'hello',
      }),
    ).resolves.toMatchObject({ quote: 'hello' })
  })

  it('nothing saved yet → validation is skipped (demo convenience, documented)', async () => {
    const api = zeroLatency()
    await expect(
      api.addComment({ content: 'x', nodes: [{ id: 'p-plain', from: 0, to: 5 }], quote: 'anything' }),
    ).resolves.toMatchObject({ text: 'x' })
  })
})

describe('mock lifecycle endpoints', () => {
  it('remove is a SOFT delete: the tombstone stays in list(), flagged and inert', async () => {
    const api = zeroLatency({ seed: [seedRow()] })

    await api.remove('c-seed')

    const rows = await api.listComments()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'c-seed', isDeleted: true })
    // Tombstones grant nothing — the serializer computes flags per request.
    expect(rows[0].canReply).toBe(false)
    expect(rows[0].canDelete).toBe(false)
  })

  it('replying to a soft-deleted parent is rejected with PARENT_DELETED', async () => {
    const api = zeroLatency({ seed: [seedRow()] })
    await api.remove('c-seed')

    await expect(api.reply('c-seed', { text: 'too late' })).rejects.toSatisfy(
      isParentDeletedError,
    )
  })

  it('failNext toggles keep an endpoint kind failing until untoggled — then it recovers', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC } })
    const input = {
      content: 'note',
      nodes: [{ id: 'p-plain', from: 0, to: 5 }],
      quote: 'hello',
    }

    api.failNext.add('add')
    // Persistent while toggled — a single-shot failure would vanish before
    // the story could demonstrate anything.
    await expect(api.addComment(input)).rejects.toThrow(/Injected add failure/)
    await expect(api.addComment(input)).rejects.toThrow(/Injected add failure/)

    api.failNext.delete('add')
    await expect(api.addComment(input)).resolves.toMatchObject({ text: 'note' })
  })
})

describe('the atomic save envelope', () => {
  /** PLAIN_DOC's shape with different text — the "next" snapshot an envelope
   *  carries. The uid is the same one, so the seeded anchor still resolves. */
  const editedDoc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { uid: 'p-plain' }, content: [{ type: 'text', text }] }],
  })

  /** 'sunny weather': 0..5 quotes 'sunny', 6..13 quotes 'weather'. */
  const NEXT_DOC = editedDoc('sunny weather')

  const movedAnchor = { id: 'c-seed', nodes: [{ id: 'p-plain', from: 0, to: 5 }], quote: 'sunny' }
  const newComment = {
    tempId: 'temp-1',
    text: 'about the weather',
    nodes: [{ id: 'p-plain', from: 6, to: 13 }],
    quote: 'weather',
  }
  const fullEnvelope = (over: Partial<SaveEnvelope> = {}): SaveEnvelope => ({
    versionId: 1,
    doc: NEXT_DOC,
    anchors: [movedAnchor],
    creates: [newComment],
    ...over,
  })

  /** The saved doc is not exposed, so we probe it the way the frontend would:
   *  a quote only validates against the document the server actually holds. */
  const savedDocQuotes = async (
    api: ReturnType<typeof zeroLatency>,
    range: { from: number; to: number },
    quote: string,
  ) => {
    try {
      await api.addComment({ content: 'probe', nodes: [{ id: 'p-plain', ...range }], quote })
      return true
    } catch {
      return false
    }
  }

  it('writes the doc, the moved anchors and the new comments in one shot', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    expect(api.versionId).toBe(1)
    // Count only what the APPLY emits: subscribe AFTER the request was
    // logged, so the assertion pins the invariant (one notify for the whole
    // transaction) instead of an incidental total that includes the log ping.
    let notifications = 0
    const pending = api.saveEnvelope(fullEnvelope())
    api.subscribe(() => {
      notifications += 1
    })

    const result = await pending

    expect(result.versionId).toBe(2)
    expect(api.versionId).toBe(2)
    expect(result.savedAt).toBeTruthy()

    const rows = api.peekComments()
    expect(rows).toHaveLength(2)
    // The seeded row's anchor was overwritten with the one from the envelope.
    expect(rows[0]).toMatchObject({
      id: 'c-seed',
      quote: 'sunny',
      nodes: [{ id: 'p-plain', from: 0, to: 5 }],
    })
    // The create was MINTED server-side: real id, stamped author, OPEN.
    expect(result.created).toHaveLength(1)
    expect(result.created[0].tempId).toBe('temp-1')
    const minted = result.created[0].row
    expect(minted.id).not.toBe('temp-1')
    expect(minted).toMatchObject({
      text: 'about the weather',
      quote: 'weather',
      status: 'OPEN',
      author: MOCK_USER,
      replies: [],
    })
    expect(rows[1].id).toBe(minted.id)

    // Two pings: the log entry from the call, then ONE for the whole apply —
    // not one per anchor and per create.
    expect(notifications).toBe(1)

    // The stored doc IS the envelope's doc now.
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'sunny')).toBe(true)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(false)
  })

  it('an empty envelope is a plain doc save — the version still bumps', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC } })

    const result = await api.saveEnvelope({
      versionId: 1,
      doc: NEXT_DOC,
      anchors: [],
      creates: [],
    })

    expect(result).toMatchObject({ versionId: 2, created: [] })
    expect(api.versionId).toBe(2)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'sunny')).toBe(true)
  })

  it('a stale versionId is rejected with VERSION_CONFLICT — and writes NOTHING', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    // Someone else saved first: the version moved to 2 and the doc changed.
    await api.saveEnvelope({ versionId: 1, doc: NEXT_DOC, anchors: [], creates: [] })
    const before = api.peekComments()

    await expect(
      api.saveEnvelope({
        versionId: 1, // the token this client has been holding all along
        doc: editedDoc('stale edit'),
        anchors: [{ id: 'c-seed', nodes: [{ id: 'p-plain', from: 0, to: 5 }], quote: 'stale' }],
        creates: [
          { tempId: 'temp-1', text: 'lost', nodes: [{ id: 'p-plain', from: 6, to: 10 }], quote: 'edit' },
        ],
      }),
    ).rejects.toSatisfy(hasCode(VERSION_CONFLICT))

    expect(api.versionId).toBe(2)
    expect(api.peekComments()).toEqual(before)
    // The rejection is in the call log, next to the request that caused it.
    expect(api.log).toEqual([
      'PUT /template (envelope)',
      'PUT /template (envelope)',
      '409 PUT /template (stale versionId)',
    ])
    // The doc is still the one the WINNER saved, not the loser's.
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'sunny')).toBe(true)
  })

  it('a mismatched anchor quote rejects the WHOLE envelope — the valid create dies with it', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const before = api.peekComments()

    await expect(
      api.saveEnvelope(
        // 0..5 of the envelope's OWN doc says 'sunny'; the frontend sent the
        // quote it had before the edit — its two halves disagree.
        fullEnvelope({ anchors: [{ ...movedAnchor, quote: 'hello' }] }),
      ),
    ).rejects.toSatisfy(isStaleContentError)

    expect(api.versionId).toBe(1)
    expect(api.peekComments()).toEqual(before)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(true)
  })

  it('a structurally invalid create rejects the envelope — nothing written', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const before = api.peekComments()

    await expect(
      api.saveEnvelope(
        fullEnvelope({
          creates: [{ ...newComment, nodes: [{ id: 'p-plain', from: 6, to: 6 }], quote: '' }],
        }),
      ),
    ).rejects.toSatisfy(hasCode('INVALID_NODES'))

    expect(api.versionId).toBe(1)
    expect(api.peekComments()).toEqual(before)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(true)
  })

  it('a stale CREATE quote rejects the envelope — the valid anchor dies with it', async () => {
    // The symmetric case of the anchor check: creates and anchors go through
    // the SAME validation, and either one poisons the whole transaction.
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const before = api.peekComments()

    await expect(
      api.saveEnvelope(fullEnvelope({ creates: [{ ...newComment, quote: 'wrong' }] })),
    ).rejects.toSatisfy(isStaleContentError)

    expect(api.versionId).toBe(1)
    expect(api.peekComments()).toEqual(before)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(true)
  })

  it('malformed ANCHOR nodes reject the envelope — nothing written', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const before = api.peekComments()

    await expect(
      api.saveEnvelope(
        fullEnvelope({ anchors: [{ ...movedAnchor, nodes: [{ id: 'p-plain', from: 5, to: 5 }] }] }),
      ),
    ).rejects.toSatisfy(hasCode('INVALID_NODES'))

    expect(api.versionId).toBe(1)
    expect(api.peekComments()).toEqual(before)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(true)
  })

  it('an anchor whose row vanished is a SKIPPABLE no-op — the document still saves', async () => {
    // Deletion rides the immediate channel, so a row can disappear while an
    // envelope is in flight. That race must not hold the document save
    // hostage: the deletion already won, the anchor has nothing to update.
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })

    await expect(
      api.saveEnvelope(fullEnvelope({ anchors: [{ ...movedAnchor, id: 'c-ghost' }] })),
    ).resolves.toMatchObject({ versionId: 2 })

    // A tombstone is skipped the same way — and stays a tombstone.
    await api.remove('c-seed')
    await expect(api.saveEnvelope({ ...fullEnvelope(), versionId: 2 })).resolves.toMatchObject({
      versionId: 3,
    })
    expect(api.peekComments()[0]).toMatchObject({ id: 'c-seed', isDeleted: true })
    // The skipped anchor never landed on the tombstone.
    expect(api.peekComments()[0].nodes).toEqual(seedRow().nodes)
  })

  it('the injected save failure rejects the whole envelope', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const before = api.peekComments()
    api.failNext.add('save')

    await expect(api.saveEnvelope(fullEnvelope())).rejects.toThrow(/Injected save failure/)

    expect(api.versionId).toBe(1)
    expect(api.peekComments()).toEqual(before)
    expect(await savedDocQuotes(api, { from: 0, to: 5 }, 'hello')).toBe(true)
  })
})
