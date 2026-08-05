import { describe, expect, it, vi } from 'vitest'
import type { CommentAnchorPayload } from './commentAnchor'
import { createCommentSyncQueue, type CommentSyncState } from './commentSync'

const payload = (tag: string): CommentAnchorPayload => ({
  nodes: [{ id: `node-${tag}`, from: 0, to: 5 }],
  quote: `quote ${tag}`,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** An updateAnchor whose every call is recorded and settled BY THE TEST —
 *  what "sequential" and "coalesce" claims are proven against. */
function controlledDeps() {
  const calls: Array<{
    id: string
    payload: CommentAnchorPayload
    settle: ReturnType<typeof deferred<unknown>>
  }> = []
  let inFlight = 0
  let maxInFlight = 0
  const updateAnchor = vi.fn((id: string, body: CommentAnchorPayload) => {
    const settle = deferred<unknown>()
    calls.push({ id, payload: body, settle })
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    return settle.promise.finally(() => {
      inFlight -= 1
    })
  })
  return { calls, updateAnchor, maxInFlight: () => maxInFlight }
}

describe('createCommentSyncQueue', () => {
  it('flushes SEQUENTIALLY in enqueue order — the next write waits for the previous', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-1', ...payload('one') })
    queue.enqueue({ id: 'c-2', ...payload('two') })
    expect(queue.pendingIds()).toEqual(['c-1', 'c-2'])

    const flushed = queue.flush()
    await vi.waitFor(() => expect(deps.calls).toHaveLength(1))
    // One at a time: c-2 must not fire while c-1 is in flight.
    expect(deps.calls.map((call) => call.id)).toEqual(['c-1'])
    deps.calls[0].settle.resolve({})
    await vi.waitFor(() => expect(deps.calls).toHaveLength(2))
    expect(deps.calls.map((call) => call.id)).toEqual(['c-1', 'c-2'])
    deps.calls[1].settle.resolve({})

    await flushed
    expect(deps.maxInFlight()).toBe(1)
    expect(queue.pendingIds()).toEqual([])
    expect(queue.states().get('c-1')).toBe('synced')
    expect(queue.states().get('c-2')).toBe('synced')
  })

  it('enqueue is latest-wins per comment: one write, the newest payload, original position', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-1', ...payload('stale') })
    queue.enqueue({ id: 'c-2', ...payload('two') })
    queue.enqueue({ id: 'c-1', ...payload('newest') })
    // Re-enqueueing did not move c-1 behind c-2.
    expect(queue.pendingIds()).toEqual(['c-1', 'c-2'])

    const flushed = queue.flush()
    await vi.waitFor(() => expect(deps.calls).toHaveLength(1))
    deps.calls[0].settle.resolve({})
    await vi.waitFor(() => expect(deps.calls).toHaveLength(2))
    deps.calls[1].settle.resolve({})
    await flushed

    expect(deps.updateAnchor).toHaveBeenCalledTimes(2)
    expect(deps.calls[0]).toMatchObject({ id: 'c-1', payload: payload('newest') })
  })

  it('a failure retries ONCE in-flush, then saveFailed (error recorded) and the flush continues', async () => {
    const failure = new Error('anchor endpoint down')
    const updateAnchor = vi
      .fn<(id: string, body: CommentAnchorPayload) => Promise<unknown>>()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({})
    const queue = createCommentSyncQueue({ updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-bad', ...payload('bad') })
    queue.enqueue({ id: 'c-good', ...payload('good') })

    await queue.flush()
    // Two attempts for the failure (the single automatic retry), one for the
    // comment behind it — which was still written despite the failure ahead.
    expect(updateAnchor.mock.calls.map(([id]) => id)).toEqual(['c-bad', 'c-bad', 'c-good'])
    expect(queue.states().get('c-bad')).toBe('saveFailed')
    expect(queue.states().get('c-good')).toBe('synced')

    // NO blind loop: a saveFailed comment is dequeued — the next flush does
    // not touch it again.
    await queue.flush()
    expect(updateAnchor).toHaveBeenCalledTimes(3)
    expect(queue.states().get('c-bad')).toBe('saveFailed')
  })

  it('the automatic retry can heal: fail once, succeed on the second attempt → synced', async () => {
    const updateAnchor = vi
      .fn<(id: string, body: CommentAnchorPayload) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({})
    const queue = createCommentSyncQueue({ updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-1', ...payload('one') })
    await queue.flush()
    expect(queue.states().get('c-1')).toBe('synced')
  })

  it('manual retry re-enqueues the CALLER-supplied fresh payload — never the failed one', async () => {
    const updateAnchor = vi
      .fn<(id: string, body: CommentAnchorPayload) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({})
    const queue = createCommentSyncQueue({ updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-1', ...payload('failed') })
    await queue.flush()
    expect(queue.states().get('c-1')).toBe('saveFailed')

    queue.retry('c-1', payload('recomputed'))
    expect(queue.states().get('c-1')).toBe('pendingSave')

    await queue.flush()
    expect(updateAnchor).toHaveBeenLastCalledWith('c-1', payload('recomputed'))
    expect(queue.states().get('c-1')).toBe('synced')
  })

  it('flush during a flush chains-and-coalesces — one follow-up pass, no concurrent writes', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })
    const transitions: Array<CommentSyncState | undefined> = []
    queue.subscribe(() => transitions.push(queue.states().get('c-1')))

    queue.enqueue({ id: 'c-1', ...payload('one') })
    const first = queue.flush()
    await vi.waitFor(() => expect(deps.calls).toHaveLength(1))

    // Mid-flight: a newer payload for the SAME comment plus two more flush
    // calls. Both calls share the ONE follow-up pass.
    queue.enqueue({ id: 'c-1', ...payload('newer') })
    const second = queue.flush()
    const third = queue.flush()
    expect(third).toBe(second)
    // Still only the original write in flight — the newer payload must not
    // race it.
    expect(deps.calls).toHaveLength(1)

    deps.calls[0].settle.resolve({})
    await first

    // The follow-up pass sends the newer payload, sequentially after.
    await vi.waitFor(() => expect(deps.calls).toHaveLength(2))
    expect(deps.calls[1]).toMatchObject({ id: 'c-1', payload: payload('newer') })
    deps.calls[1].settle.resolve({})
    await second
    expect(deps.maxInFlight()).toBe(1)
    // The full life of c-1, in order: queued, written (already outdated → back
    // in line, never 'synced' on a stale write), written again, synced.
    expect(transitions).toEqual(['pendingSave', 'saving', 'pendingSave', 'saving', 'synced'])
  })

  it('reports enqueued MID-flush wait for the next flush (the pass snapshots its line)', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })

    queue.enqueue({ id: 'c-1', ...payload('one') })
    const flushed = queue.flush()
    await vi.waitFor(() => expect(deps.calls).toHaveLength(1))
    // A DIFFERENT comment arrives mid-pass: its doc state has no confirmed
    // save yet — it must not ride this pass.
    queue.enqueue({ id: 'c-late', ...payload('late') })
    deps.calls[0].settle.resolve({})

    await flushed
    expect(deps.updateAnchor).toHaveBeenCalledTimes(1)
    expect(queue.states().get('c-late')).toBe('pendingSave')
    expect(queue.pendingIds()).toEqual(['c-late'])
  })

  it('subscribe hears every transition; unsubscribe silences it', async () => {
    const updateAnchor = vi.fn(async () => ({}))
    const queue = createCommentSyncQueue({ updateAnchor, retryBackoffMs: 0 })
    const seen: Array<CommentSyncState | undefined> = []
    const unsubscribe = queue.subscribe(() => seen.push(queue.states().get('c-1')))

    queue.enqueue({ id: 'c-1', ...payload('one') })
    await queue.flush()
    expect(seen).toEqual(['pendingSave', 'saving', 'synced'])

    unsubscribe()
    queue.enqueue({ id: 'c-1', ...payload('two') })
    expect(seen).toHaveLength(3)
  })
})

describe('flush snapshots payloads — doc-first for mid-pass enqueues', () => {
  it('a payload enqueued mid-pass for an id already in the line waits for the NEXT flush', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })
    queue.enqueue({ id: 'c-1', ...payload('v1') })
    const pass = queue.flush()
    // v2 lands while v1 is in flight — its doc state has no confirmed save
    // yet, so it must NOT travel in this pass.
    queue.enqueue({ id: 'c-1', ...payload('v2') })
    deps.calls[0]!.settle.resolve(null)
    await pass
    expect(deps.calls.map((call) => call.payload.quote)).toEqual(['quote v1'])
    expect(queue.states().get('c-1')).toBe('pendingSave') // v2 still queued

    const second = queue.flush()
    deps.calls[1]!.settle.resolve(null)
    await second
    expect(deps.calls.map((call) => call.payload.quote)).toEqual(['quote v1', 'quote v2'])
    expect(queue.states().get('c-1')).toBe('synced')
  })

  it('clear() drops queued payloads and states wholesale — the documentReplaced hook', async () => {
    const deps = controlledDeps()
    const queue = createCommentSyncQueue({ updateAnchor: deps.updateAnchor, retryBackoffMs: 0 })
    queue.enqueue({ id: 'c-1', ...payload('v1') })
    queue.enqueue({ id: 'c-2', ...payload('v2') })
    queue.clear()
    expect(queue.states().size).toBe(0)
    await queue.flush()
    expect(deps.updateAnchor).not.toHaveBeenCalled()
  })
})
