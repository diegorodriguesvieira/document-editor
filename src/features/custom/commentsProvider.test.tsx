import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  CommentsProvider,
  useComments,
  type CommentsAdapter,
  type CommentUser,
  type DocumentComment,
} from './commentsProvider'

const ANA: CommentUser = { id: 'u-ana', name: 'Ana Lima' }

const saved = (id: string, text: string): DocumentComment => ({
  id,
  from: 1,
  to: 6,
  quote: 'hello',
  text,
  author: ANA,
  createdAt: '2026-07-15T12:00:00Z',
})

/** An in-memory adapter whose calls are all inspectable. */
function fakeAdapter(initial: DocumentComment[] = []) {
  let db = [...initial]
  return {
    list: vi.fn(async () => [...db]),
    add: vi.fn(async (input: { text: string; quote: string; from: number; to: number }) => {
      db = [...db, { ...input, id: `c-${db.length + 1}`, author: ANA, createdAt: 'now' }]
    }),
    remove: vi.fn(async (id: string) => {
      db = db.filter((comment) => comment.id !== id)
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

  it('addComment sends the DRAFT payload and reloads from the server (no optimistic insert)', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    let ok = false
    await act(async () => {
      ok = await result.current!.addComment('  tighten this  ')
    })

    expect(ok).toBe(true)
    expect(adapter.add).toHaveBeenCalledWith({ text: 'tighten this', quote: 'hello', from: 1, to: 6 })
    // Refetch-after-write: the comment in state is the SERVER's (id it minted),
    // not a local echo — and list() ran again after the mutation.
    expect(adapter.list).toHaveBeenCalledTimes(2)
    expect(result.current!.comments.map((comment) => comment.id)).toEqual(['c-1'])
    expect(result.current!.draft).toBeNull()
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
