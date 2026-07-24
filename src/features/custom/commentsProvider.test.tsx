import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  CommentsProvider,
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
  status: 'open',
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
        status: 'open',
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

function mount(adapter: CommentsAdapter, user: CommentUser | undefined = ANA) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CommentsProvider user={user} adapter={adapter}>
      {children}
    </CommentsProvider>
  )
  return renderHook(() => useComments(), { wrapper })
}

describe('CommentsProvider', () => {
  it('fetches the list on mount', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
    const { result } = mount(adapter)

    await waitFor(() => expect(result.current!.loading).toBe(false))
    expect(adapter.list).toHaveBeenCalledTimes(1)
    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
  })

  it('addComment sends the draft TEXT, anchors the returned id, reloads (no optimistic insert)', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    const anchored: string[] = []
    let ok = false
    await act(async () => {
      // applyAnchor must run AFTER the save (it needs the backend id) and
      // BEFORE the refetch (the mark exists before the comment lands in
      // state — no orphan flash, no strip race).
      ok = await result.current!.addComment('  tighten this  ', (id) => {
        anchored.push(id)
        expect(adapter.add).toHaveBeenCalledTimes(1)
        expect(adapter.list).toHaveBeenCalledTimes(1) // mount fetch only, so far
      })
    })

    expect(ok).toBe(true)
    // The anchor no longer travels to the backend — the doc carries it.
    expect(adapter.add).toHaveBeenCalledWith({ text: 'tighten this', quote: 'hello' })
    expect(anchored).toEqual(['c-1'])
    // Refetch-after-write: the comment in state is the SERVER's (id it minted),
    // not a local echo — and list() ran again after the mutation.
    expect(adapter.list).toHaveBeenCalledTimes(2)
    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
    expect(result.current!.draft).toBeNull()
  })

  it('a throwing applyAnchor does not fail the save — the comment just orphans', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(
        await result.current!.addComment('anchorless', () => {
          throw new Error('editor gone')
        }),
      ).toBe(true)
    })

    expect(adapter.list).toHaveBeenCalledTimes(2) // still refetched
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

  it('a failed add keeps the draft (nothing typed is lost), never anchors, surfaces the error', async () => {
    const adapter = fakeAdapter()
    adapter.add.mockRejectedValueOnce(new Error('500 from the comments service'))
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    const applyAnchor = vi.fn()
    await act(async () => {
      expect(await result.current!.addComment('will fail', applyAnchor)).toBe(false)
    })

    expect(applyAnchor).not.toHaveBeenCalled()
    expect(result.current!.draft).toEqual({ from: 1, to: 6, quote: 'hello' })
    expect(result.current!.error).toBe('500 from the comments service')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('replyToComment trims, sends, refetches — the reply lands nested in its thread', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', '  de acordo  ')).toBe(true)
    })

    expect(adapter.reply).toHaveBeenCalledWith('c-1', { text: 'de acordo' })
    expect(adapter.list).toHaveBeenCalledTimes(2) // refetch-after-write
    expect(result.current!.comments[0].replies?.map((reply) => reply.text)).toEqual(['de acordo'])
  })

  it('replyToComment with whitespace only is a no-op; a failed reply surfaces the error', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.replyToComment('c-1', '   ')).toBe(false)
    })
    expect(adapter.reply).not.toHaveBeenCalled()

    adapter.reply.mockRejectedValueOnce(new Error('replies service down'))
    await act(async () => {
      expect(await result.current!.replyToComment('c-1', 'vai falhar')).toBe(false)
    })
    expect(result.current!.error).toBe('replies service down')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('updateComment rewrites a COMMENT or a REPLY by id (globally-unique ids) and refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    await act(async () => {
      await result.current!.replyToComment('c-1', 'resposta')
    })

    await act(async () => {
      expect(await result.current!.updateComment('c-1', '  texto novo  ')).toBe(true)
    })
    expect(adapter.update).toHaveBeenCalledWith('c-1', { text: 'texto novo' })
    expect(result.current!.comments[0].text).toBe('texto novo')

    // A reply id passes through the same seam, verbatim.
    const replyId = result.current!.comments[0].replies![0].id
    await act(async () => {
      expect(await result.current!.updateComment(replyId, 'resposta editada')).toBe(true)
    })
    expect(adapter.update).toHaveBeenCalledWith(replyId, { text: 'resposta editada' })
    expect(result.current!.comments[0].replies![0].text).toBe('resposta editada')
  })

  it('updateComment: whitespace no-op; failure sets the error and keeps the list', async () => {
    const adapter = fakeAdapter([saved('c-1', 'intacto')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))

    await act(async () => {
      expect(await result.current!.updateComment('c-1', '   ')).toBe(false)
    })
    expect(adapter.update).not.toHaveBeenCalled()

    adapter.update.mockRejectedValueOnce(new Error('PATCH exploded'))
    await act(async () => {
      expect(await result.current!.updateComment('c-1', 'vai falhar')).toBe(false)
    })
    expect(result.current!.error).toBe('PATCH exploded')
    expect(result.current!.comments[0].text).toBe('intacto')
  })

  it('setCommentStatus PATCHes the lifecycle, clears a matching active highlight, refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'aberto')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    act(() => result.current!.setActiveId('c-1'))

    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'resolved')).toBe(true)
    })

    expect(adapter.setStatus).toHaveBeenCalledWith('c-1', { status: 'resolved' })
    expect(adapter.list).toHaveBeenCalledTimes(2) // refetch-after-write
    expect(result.current!.comments[0].status).toBe('resolved')
    // The resolved comment leaves the open tab (and its mark leaves the doc)
    // — a lingering active highlight would point at nothing.
    expect(result.current!.activeId).toBeNull()
  })

  it('a failed setStatus surfaces the error and keeps the status', async () => {
    const adapter = fakeAdapter([saved('c-1', 'aberto')])
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.comments.length).toBe(1))
    adapter.setStatus.mockRejectedValueOnce(new Error('PATCH status down'))

    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'archived')).toBe(false)
    })

    expect(result.current!.error).toBe('PATCH status down')
    expect(result.current!.comments[0].status).toBe('open')
    expect(adapter.list).toHaveBeenCalledTimes(1) // no refetch on failure
  })

  it('removeComment deletes on the server, clears the active highlight and refetches', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
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
    const adapter = fakeAdapter([saved('c-1', 'travado')])
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
      first = result.current!.setCommentStatus('c-1', 'resolved')
    })
    await waitFor(() => expect(result.current!.busyIds.has('c-1')).toBe(true))

    // The impatient double-click: rejected without touching the adapter.
    await act(async () => {
      expect(await result.current!.setCommentStatus('c-1', 'resolved')).toBe(false)
    })
    expect(adapter.setStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
      await first
    })
    expect(result.current!.busyIds.has('c-1')).toBe(false)
  })

  it('a freshly anchored id stays in pendingAnchorIds while the backend list lags', async () => {
    const adapter = fakeAdapter()
    adapter.list.mockResolvedValue([]) // the read path never catches up
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      await result.current!.addComment('fresh')
    })

    // Reconciliation (in the bridge) unions this set into its keep-list.
    expect(result.current!.pendingAnchorIds.has('c-1')).toBe(true)
  })

  it('a failed list keeps the last good list (an offline blip must not blank the panel)', async () => {
    const adapter = fakeAdapter([saved('c-1', 'primeiro')])
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
