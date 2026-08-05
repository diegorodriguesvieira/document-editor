import { describe, expect, it } from 'vitest'
import { isParentDeletedError, isStaleContentError } from '../features'
// The shared FE/BE offset-contract fixture — the mock's validator must agree
// with it verbatim, exactly like the real backend's validator must.
import { COMMENT_ANCHOR_GOLDEN_VECTORS } from '../features/custom/commentAnchor.golden'
import { createMockCommentsApi, MOCK_USER, type StoredComment } from './commentsMock'

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

  it('rejects a stale quote with STALE_CONTENT — on add AND on updateAnchor', async () => {
    const api = zeroLatency({ template: { doc: PLAIN_DOC } })

    await expect(
      api.addComment({
        content: 'stale create',
        nodes: [{ id: 'p-plain', from: 0, to: 5 }],
        quote: 'goodbye', // the saved doc says 'hello'
      }),
    ).rejects.toSatisfy(isStaleContentError)

    const created = await api.addComment({
      content: 'fresh',
      nodes: [{ id: 'p-plain', from: 0, to: 5 }],
      quote: 'hello',
    })
    await expect(
      api.updateAnchor(created.id, {
        nodes: [{ id: 'p-plain', from: 6, to: 11 }],
        quote: 'wrong', // that range says 'world'
      }),
    ).rejects.toSatisfy(isStaleContentError)

    // The matching quote goes through and the row carries the new anchor.
    const updated = await api.updateAnchor(created.id, {
      nodes: [{ id: 'p-plain', from: 6, to: 11 }],
      quote: 'world',
    })
    expect(updated.nodes).toEqual([{ id: 'p-plain', from: 6, to: 11 }])
    expect(updated.quote).toBe('world')
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
    const api = zeroLatency({ template: { doc: PLAIN_DOC }, seed: [seedRow()] })
    const payload = { nodes: [{ id: 'p-plain', from: 0, to: 5 }], quote: 'hello' }

    api.failNext.add('anchor')
    // Persistent while toggled: BOTH of the sync queue's in-flush attempts
    // must fail, or the demo could never show `saveFailed`.
    await expect(api.updateAnchor('c-seed', payload)).rejects.toThrow(/Injected anchor failure/)
    await expect(api.updateAnchor('c-seed', payload)).rejects.toThrow(/Injected anchor failure/)

    api.failNext.delete('anchor')
    await expect(api.updateAnchor('c-seed', payload)).resolves.toMatchObject({ id: 'c-seed' })
  })

  it('logs every call in order — the doc PUT is provably before the anchor PATCH', async () => {
    const api = zeroLatency({ seed: [seedRow()] })

    await api.saveTemplate({ doc: PLAIN_DOC })
    await api.updateAnchor('c-seed', { nodes: [{ id: 'p-plain', from: 0, to: 5 }], quote: 'hello' })

    expect(api.log).toEqual(['PUT /template', 'PATCH /comments/c-seed/anchor'])
  })
})
