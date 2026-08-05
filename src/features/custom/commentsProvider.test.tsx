import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { CommentAnchorPayload } from './commentAnchor'
import {
  CommentsProvider,
  PARENT_DELETED,
  STALE_CONTENT,
  isParentDeletedError,
  isStaleContentError,
  useComments,
  type CommentsAdapter,
  type CommentStatus,
  type CommentUser,
  type DocumentComment,
} from './commentsProvider'

const ANA: CommentUser = { id: 'u-ana', name: 'Ana Lima' }

const saved = (id: string, text: string): DocumentComment => ({
  id,
  quote: 'hello',
  text,
  author: ANA,
  createdAt: '2026-07-15T12:00:00Z',
  status: 'OPEN',
  canEdit: true,
  canReply: true,
  canDelete: true,
  canResolve: false,
  canArchive: false,
  replies: [],
})

/** An in-memory adapter whose calls are all inspectable. */
function fakeAdapter(initial: DocumentComment[] = []) {
  let db = [...initial]
  return {
    list: vi.fn(async () => [...db]),
    add: vi.fn(async (input: { text: string; quote: string }) => {
      const created: DocumentComment = {
        ...input,
        id: `c-${db.length + 1}`,
        author: ANA,
        createdAt: 'now',
        status: 'OPEN',
        canEdit: true,
        canReply: true,
        canDelete: true,
        canResolve: false,
        canArchive: false,
        replies: [],
      }
      db = [...db, created]
      return created
    }),
    reply: vi.fn(async (commentId: string, input: { text: string }) => {
      db = db.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: [
                ...(comment.replies ?? []),
                {
                  ...input,
                  id: `r-${(comment.replies?.length ?? 0) + 1}`,
                  author: ANA,
                  createdAt: 'now',
                  canEdit: true,
                  canDelete: true,
                },
              ],
            }
          : comment,
      )
    }),
    update: vi.fn(async (id: string, input: { text: string }) => {
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
    }),
    setStatus: vi.fn(async (id: string, input: { status: CommentStatus }) => {
      db = db.map((comment) =>
        comment.id === id ? { ...comment, status: input.status } : comment,
      )
    }),
    remove: vi.fn(async (id: string) => {
      db = db
        .filter((comment) => comment.id !== id)
        .map((comment) => ({
          ...comment,
          replies: comment.replies?.filter((reply) => reply.id !== id),
        }))
    }),
  } satisfies CommentsAdapter
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function mount(
  adapter: CommentsAdapter,
  user: CommentUser | undefined = ANA,
  onFlushNeeded?: () => void,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CommentsProvider user={user} adapter={adapter} onFlushNeeded={onFlushNeeded}>
      {children}
    </CommentsProvider>
  )
  return renderHook(() => useComments(), { wrapper })
}

describe('CommentsProvider', () => {
  it('fetches the list on mount', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)

    await waitFor(() => expect(result.current!.loading).toBe(false))
    expect(adapter.list).toHaveBeenCalledTimes(1)
    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
  })

  it('addComment POSTs the trimmed text + the SUBMIT-TIME anchor payload, then reloads', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'capture-time quote' }))
    let ok = false
    await act(async () => {
      ok = await result.current!.addComment('  tighten this  ', {
        nodes: [{ id: 'p1', from: 0, to: 5 }],
        quote: 'submit-time quote',
      })
    })

    expect(ok).toBe(true)
    // The anchor payload wins over the draft's capture-time quote: the
    // backend validates the SUBMIT-time text against the saved doc.
    expect(adapter.add).toHaveBeenCalledWith({
      text: 'tighten this',
      quote: 'submit-time quote',
      nodes: [{ id: 'p1', from: 0, to: 5 }],
    })
    // Refetch-after-write: the comment in state is the SERVER's (id it minted),
    // not a local echo — and list() ran again after the mutation.
    expect(adapter.list).toHaveBeenCalledTimes(2)
    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
    expect(result.current!.draft).toBeNull()
  })

  it('addComment WITHOUT an anchor payload (no editor) posts the draft quote, no nodes', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('anchorless')).toBe(true)
    })

    expect(adapter.add).toHaveBeenCalledWith({ text: 'anchorless', quote: 'hello' })
    expect(result.current!.draft).toBeNull()
    expect(result.current!.error).toBeNull()
  })

  it('addComment without a draft (or with only whitespace) is a no-op', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    await act(async () => {
      expect(await result.current!.addComment('text without a draft')).toBe(false)
    })
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('   ')).toBe(false)
    })
    expect(adapter.add).not.toHaveBeenCalled()
  })

  it('a failed add keeps the draft (nothing typed is lost) and surfaces the error', async () => {
    const adapter = fakeAdapter()
    adapter.add.mockRejectedValueOnce(new Error('500 from the comments service'))
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('will fail')).toBe(false)
    })

    expect(result.current!.draft).toEqual({ from: 1, to: 6, quote: 'hello' })
    expect(result.current!.error).toBe('500 from the comments service')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('replyToComment trims, sends, refetches — the reply lands nested in its thread', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', '  agreed  ')).toBe(true)
    })

    expect(adapter.reply).toHaveBeenCalledWith('c-1', { text: 'agreed' })
    expect(adapter.list).toHaveBeenCalledTimes(2) // refetch-after-write
    expect(result.current!.comments[0].replies?.map((reply) => reply.text)).toEqual(['agreed'])
  })

  it('replyToComment with whitespace only is a no-op; a failed reply surfaces the error', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', '   ')).toBe(false)
    })
    expect(adapter.reply).not.toHaveBeenCalled()

    adapter.reply.mockRejectedValueOnce(new Error('replies service down'))
    await act(async () => {
      expect(await result.current!.replyToComment('c-1', 'will fail')).toBe(false)
    })
    expect(result.current!.error).toBe('replies service down')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('updateComment rewrites a COMMENT or a REPLY by id (globally-unique ids) and refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    await act(async () => {
      await result.current!.replyToComment('c-1', 'a reply')
    })

    await act(async () => {
      expect(await result.current!.updateComment('c-1', '  new text  ')).toBe(true)
    })
    expect(adapter.update).toHaveBeenCalledWith('c-1', { text: 'new text' })
    expect(result.current!.comments[0].text).toBe('new text')

    // A reply id passes through the same seam, verbatim.
    const replyId = result.current!.comments[0].replies![0].id
    await act(async () => {
      expect(await result.current!.updateComment(replyId, 'edited reply')).toBe(true)
    })
    expect(adapter.update).toHaveBeenCalledWith(replyId, { text: 'edited reply' })
    expect(result.current!.comments[0].replies![0].text).toBe('edited reply')
  })

  it('updateComment: whitespace no-op; failure sets the error and keeps the list', async () => {
    const adapter = fakeAdapter([saved('c-1', 'untouched')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.updateComment('c-1', '   ')).toBe(false)
    })
    expect(adapter.update).not.toHaveBeenCalled()

    adapter.update.mockRejectedValueOnce(new Error('PATCH exploded'))
    await act(async () => {
      expect(await result.current!.updateComment('c-1', 'will fail')).toBe(false)
    })
    expect(result.current!.error).toBe('PATCH exploded')
    expect(result.current!.comments[0].text).toBe('untouched')
  })

  it('setCommentStatus PATCHes the lifecycle, clears a matching active highlight, refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'open thread')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    act(() => result.current!.setActiveId('c-1'))

    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'RESOLVED')).toBe(true)
    })

    expect(adapter.setStatus).toHaveBeenCalledWith('c-1', { status: 'RESOLVED' })
    expect(adapter.list).toHaveBeenCalledTimes(2) // refetch-after-write
    expect(result.current!.comments[0].status).toBe('RESOLVED')
    // The resolved comment leaves the open tab (and its mark leaves the doc)
    // — a lingering active highlight would point at nothing.
    expect(result.current!.activeId).toBeNull()
  })

  it('a failed setStatus surfaces the error and keeps the status', async () => {
    const adapter = fakeAdapter([saved('c-1', 'open thread')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    adapter.setStatus.mockRejectedValueOnce(new Error('PATCH status down'))

    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'ARCHIVED')).toBe(false)
    })

    expect(result.current!.error).toBe('PATCH status down')
    expect(result.current!.comments[0].status).toBe('OPEN')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('removeComment deletes on the server, clears the active highlight and refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    act(() => result.current!.setActiveId('c-1'))
    await act(async () => {
      expect(await result.current!.removeComment('c-1')).toBe(true)
    })

    expect(adapter.remove).toHaveBeenCalledWith('c-1')
    expect(result.current!.comments).toEqual([])
    expect(result.current!.activeId).toBeNull()
  })

  it('a repeat mutation for the SAME id while one is in flight is ignored', async () => {
    const adapter = fakeAdapter([saved('c-1', 'locked')])
    let release!: () => void
    adapter.setStatus.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    let first!: Promise<boolean>
    act(() => {
      first = result.current!.setCommentStatus('c-1', 'RESOLVED')
    })
    await waitFor(() => expect(result.current!.busyIds.has('c-1')).toBe(true))

    // The impatient double-click: rejected without touching the adapter.
    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'RESOLVED')).toBe(false)
    })
    expect(adapter.setStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
      await first
    })
    expect(result.current!.busyIds.has('c-1')).toBe(false)
  })

  it('reconciles activeId on every list change: a REMOTE resolve/delete clears it', async () => {
    let db = [saved('c-1', 'about to be resolved remotely')]
    const adapter = fakeAdapter()
    adapter.list.mockImplementation(async () => [...db])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    act(() => result.current!.setActiveId('c-1'))
    expect(result.current!.activeId).toBe('c-1')

    // Someone ELSE resolved it; this client only sees the refreshed list.
    db = [{ ...saved('c-1', 'about to be resolved remotely'), status: 'RESOLVED' }]
    await act(async () => {
      await result.current!.refresh()
    })
    expect(result.current!.activeId).toBeNull()

    // Same for a row that turned into a soft-delete tombstone…
    db = [{ ...saved('c-1', 'gone'), isDeleted: true }]
    act(() => result.current!.setActiveId('c-1'))
    await act(async () => {
      await result.current!.refresh()
    })
    expect(result.current!.activeId).toBeNull()

    // …and one that left the list entirely.
    db = []
    act(() => result.current!.setActiveId('c-1'))
    await act(async () => {
      await result.current!.refresh()
    })
    expect(result.current!.activeId).toBeNull()
  })

  it('a failed list keeps the last good list (an offline blip must not blank the panel)', async () => {
    const adapter = fakeAdapter([saved('c-1', 'first one')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    adapter.list.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await result.current!.refresh()
    })

    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
    expect(result.current!.error).toBe('offline')
  })

  it('a slow OLD fetch cannot overwrite a newer one (race guard)', async () => {
    const adapter = fakeAdapter()
    const first = deferred<DocumentComment[]>()
    const second = deferred<DocumentComment[]>()
    adapter.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = mount(adapter)

    // Fire a second fetch while the mount fetch is still in flight…
    await act(async () => {
      const racing = result.current!.refresh()
      second.resolve([saved('c-new', 'fresh')])
      await racing
      // …then let the OLD one land late.
      first.resolve([saved('c-old', 'stale')])
      await first.promise
    })

    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-new'])
  })
})

describe('CommentsProvider anchor pipeline', () => {
  const HELLO_NODES = [{ id: 'p1', from: 0, to: 5 }]

  it('without adapter.updateAnchor there is no anchorSync — and creates never queue', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    expect(result.current!.anchorSync).toBeNull()

    // queueCreates without a queue must not park the POST forever.
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('posted straight away')).toBe(true)
    })
    expect(adapter.add).toHaveBeenCalledTimes(1)
  })

  it('report → enqueue → pendingSave → saving → synced through flushAnchors', async () => {
    const gate = deferred<unknown>()
    const adapter = { ...fakeAdapter(), updateAnchor: vi.fn(() => gate.promise) }
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() =>
      result.current!.anchorSync!.enqueue({ id: 'c-9', nodes: HELLO_NODES, quote: 'hello' }),
    )
    expect(result.current!.anchorSync!.states.get('c-9')).toBe('pendingSave')
    // Nothing travels on enqueue — only the flush writes.
    expect(adapter.updateAnchor).not.toHaveBeenCalled()

    let flushed!: Promise<void>
    act(() => {
      flushed = result.current!.anchorSync!.flushAnchors()
    })
    await waitFor(() => expect(result.current!.anchorSync!.states.get('c-9')).toBe('saving'))
    expect(adapter.updateAnchor).toHaveBeenCalledWith('c-9', {
      nodes: HELLO_NODES,
      quote: 'hello',
    })

    await act(async () => {
      gate.resolve({})
      await flushed
    })
    expect(result.current!.anchorSync!.states.get('c-9')).toBe('synced')
  })

  it('failure → saveFailed; retryAnchor re-enqueues the FRESH payload from the registered source', async () => {
    const adapter = {
      ...fakeAdapter(),
      updateAnchor: vi
        .fn<(id: string, payload: CommentAnchorPayload) => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('anchor endpoint down'))
        .mockRejectedValueOnce(new Error('anchor endpoint down'))
        .mockResolvedValue({}),
    }
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    const stale: CommentAnchorPayload = { nodes: [{ id: 'p1', from: 0, to: 5 }], quote: 'old' }
    const fresh: CommentAnchorPayload = { nodes: [{ id: 'p1', from: 2, to: 7 }], quote: 'new' }
    act(() => result.current!.anchorSync!.enqueue({ id: 'c-1', ...stale }))
    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    // Both in-flush attempts failed (auto-retry once) → saveFailed.
    expect(adapter.updateAnchor).toHaveBeenCalledTimes(2)
    expect(result.current!.anchorSync!.states.get('c-1')).toBe('saveFailed')

    // The bridge registers the live derivation; the retry must send THAT —
    // the recomputed nodes — never the payload that failed.
    act(() => result.current!.registerAnchorPayloadSource(() => fresh))
    act(() => result.current!.anchorSync!.retryAnchor('c-1'))
    expect(result.current!.anchorSync!.states.get('c-1')).toBe('pendingSave')

    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    expect(adapter.updateAnchor).toHaveBeenLastCalledWith('c-1', fresh)
    expect(result.current!.anchorSync!.states.get('c-1')).toBe('synced')
  })

  it('retryAnchor is a no-op while the source has nothing live to write', async () => {
    const adapter = { ...fakeAdapter(), updateAnchor: vi.fn(async () => ({})) }
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.registerAnchorPayloadSource(() => null))
    act(() => result.current!.anchorSync!.retryAnchor('c-orphan'))

    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    expect(adapter.updateAnchor).not.toHaveBeenCalled()
  })

  it('EDIT mode queues the create: POST only on flush, BEFORE anchor updates; review posts now', async () => {
    const order: string[] = []
    const adapter = {
      ...fakeAdapter(),
      updateAnchor: vi.fn(async () => {
        order.push('updateAnchor')
      }),
    }
    adapter.add.mockImplementation(async (input: { text: string; quote: string }) => {
      order.push('add')
      return { ...saved('c-created', input.text), quote: input.quote }
    })
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'draft-time quote' }))
    // An anchor update already sits in the queue — the flush must still run
    // the create FIRST (a comment must exist before any anchor patch).
    act(() =>
      result.current!.anchorSync!.enqueue({ id: 'c-old', nodes: HELLO_NODES, quote: 'hello' }),
    )
    let queued!: Promise<boolean>
    act(() => {
      queued = result.current!.addComment('queued in edit mode', {
        nodes: HELLO_NODES,
        quote: 'submit-time quote',
      })
    })
    expect(adapter.add).not.toHaveBeenCalled()

    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    // The anchor payload's quote (recomputed at submit) travels — not the
    // draft's capture-time one.
    expect(adapter.add).toHaveBeenCalledWith({
      text: 'queued in edit mode',
      quote: 'submit-time quote',
      nodes: HELLO_NODES,
    })
    expect(order).toEqual(['add', 'updateAnchor'])
    expect(await queued).toBe(true)

    // Review mode: the POST goes out immediately again.
    act(() => result.current!.setQueueCreates(false))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('review mode direct')).toBe(true)
    })
    expect(adapter.add).toHaveBeenCalledTimes(2)
  })

  it('STALE_CONTENT on create surfaces createError, keeps the draft, never auto-retries', async () => {
    const adapter = fakeAdapter()
    adapter.add.mockRejectedValueOnce(
      Object.assign(new Error('quote does not match the saved document'), {
        code: STALE_CONTENT,
      }),
    )
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('went stale')).toBe(false)
    })

    expect(result.current!.createError).toBe('stale')
    expect(adapter.add).toHaveBeenCalledTimes(1) // no auto-retry, ever
    expect(result.current!.draft).not.toBeNull() // nothing typed is lost

    act(() => result.current!.clearCreateError())
    expect(result.current!.createError).toBeNull()
  })

  it('isStaleContentError recognizes code, message and string shapes — and nothing else', () => {
    expect(isStaleContentError(Object.assign(new Error('nope'), { code: STALE_CONTENT }))).toBe(true)
    expect(isStaleContentError(new Error('409 STALE_CONTENT'))).toBe(true)
    expect(isStaleContentError('STALE_CONTENT')).toBe(true)
    expect(isStaleContentError({ code: STALE_CONTENT })).toBe(true)
    expect(isStaleContentError(new Error('500 something else'))).toBe(false)
    expect(isStaleContentError(null)).toBe(false)
    expect(isStaleContentError(undefined)).toBe(false)
  })

  it('isParentDeletedError recognizes the same shapes for PARENT_DELETED', () => {
    expect(isParentDeletedError(Object.assign(new Error('gone'), { code: PARENT_DELETED }))).toBe(true)
    expect(isParentDeletedError(new Error('410 PARENT_DELETED'))).toBe(true)
    expect(isParentDeletedError('PARENT_DELETED')).toBe(true)
    expect(isParentDeletedError({ code: PARENT_DELETED })).toBe(true)
    expect(isParentDeletedError(new Error('500 something else'))).toBe(false)
    expect(isParentDeletedError(null)).toBe(false)
  })

  it('PARENT_DELETED on reply marks the parent id; the next successful reply clears it', async () => {
    const adapter = fakeAdapter([saved('c-1', 'parent')])
    adapter.reply.mockRejectedValueOnce(
      Object.assign(new Error('This comment was deleted.'), { code: PARENT_DELETED }),
    )
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', 'racing the delete')).toBe(false)
    })
    // The composer reads this to swap its error line for the deleted notice;
    // the raw message still rides the banner. Nothing is retried.
    expect(result.current!.parentDeletedId).toBe('c-1')
    expect(result.current!.error).toBe('This comment was deleted.')
    expect(adapter.reply).toHaveBeenCalledTimes(1)

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', 'second try')).toBe(true)
    })
    expect(result.current!.parentDeletedId).toBeNull()
  })

  it('a generic reply failure never marks parentDeletedId', async () => {
    const adapter = fakeAdapter([saved('c-1', 'parent')])
    adapter.reply.mockRejectedValueOnce(new Error('replies service down'))
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', 'will fail')).toBe(false)
    })
    expect(result.current!.parentDeletedId).toBeNull()
  })

  it('an add that resolves the FULL row shows the card before the next list() lands', async () => {
    const adapter = fakeAdapter()
    const pendingList = deferred<DocumentComment[]>()
    adapter.list.mockResolvedValueOnce([]).mockReturnValueOnce(pendingList.promise)
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    let added!: Promise<boolean>
    act(() => {
      added = result.current!.addComment('optimistic')
    })

    // The refetch is still hanging — the optimistic row is already visible.
    await waitFor(() =>
      expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1']),
    )
    expect(result.current!.comments[0].text).toBe('optimistic')
    expect(adapter.list).toHaveBeenCalledTimes(2)

    // The server's list replaces it wholesale.
    await act(async () => {
      pendingList.resolve([saved('c-1', 'server copy')])
      await added
    })
    expect(result.current!.comments[0].text).toBe('server copy')
  })
})

describe('onFlushNeeded — queued writes ask the consumer pump for a cycle', () => {
  const NODES = [{ id: 'p1', from: 0, to: 5 }]

  it('a QUEUED create requests a pump cycle immediately — the promise settles on that flush', async () => {
    // Creates only queue when the anchor queue exists (adapter with
    // updateAnchor) — without one they POST immediately by design.
    const adapter = { ...fakeAdapter(), updateAnchor: vi.fn(async () => ({})) }
    const onFlushNeeded = vi.fn()
    const { result } = mount(adapter, ANA, onFlushNeeded)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    let queued!: Promise<boolean>
    act(() => {
      queued = result.current!.addComment('parked note', { nodes: NODES, quote: 'hello' })
    })
    // Parked — and the pump was asked to run NOW. Without this call the
    // promise would wait for the next ORGANIC edit (in review mode: forever).
    expect(adapter.add).not.toHaveBeenCalled()
    expect(onFlushNeeded).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    expect(await queued).toBe(true)
    expect(adapter.add).toHaveBeenCalledTimes(1)
  })

  it('retryAnchor requests a pump cycle — Retry can complete in review mode', async () => {
    const adapter = {
      ...fakeAdapter(),
      updateAnchor: vi
        .fn<(id: string, payload: CommentAnchorPayload) => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue({}),
    }
    const onFlushNeeded = vi.fn()
    const { result } = mount(adapter, ANA, onFlushNeeded)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.anchorSync!.enqueue({ id: 'c-1', nodes: NODES, quote: 'x' }))
    await act(async () => {
      await result.current!.anchorSync!.flushAnchors()
    })
    expect(result.current!.anchorSync!.states.get('c-1')).toBe('saveFailed')
    expect(onFlushNeeded).not.toHaveBeenCalled()

    act(() => result.current!.registerAnchorPayloadSource(() => ({ nodes: NODES, quote: 'x' })))
    act(() => result.current!.anchorSync!.retryAnchor('c-1'))
    expect(result.current!.anchorSync!.states.get('c-1')).toBe('pendingSave')
    expect(onFlushNeeded).toHaveBeenCalledTimes(1)
  })
})
