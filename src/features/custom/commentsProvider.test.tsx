import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { DocumentSaveProvider, type Editor } from '../../editor'
import { useDocumentSaveRegistry } from '../../editor/core/documentSave'
import { renderEditor } from '../../test/editorHarness'
import type { CommentAnchorPayload, CommentAnchorReport } from './commentAnchor'
import {
  CommentsProvider,
  type CommentAnchorBridge,
  type CommentAnchorSync,
  type CommentSaveCreate,
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

/** Hands a headless editor to the save layer, the way `useDocumentEditor`
 *  does for React-mounted ones — without it a cycle has no document to carry
 *  and never calls `save`. */
function RegisterEditor({ editor }: { editor: Editor }) {
  const registry = useDocumentSaveRegistry()
  useEffect(() => registry?.registerEditor(editor), [registry, editor])
  return null
}

/** The envelope as this suite's backend sees it. */
type Envelope = {
  doc: JSONContent
  anchors: CommentAnchorReport[]
  creates: CommentSaveCreate[]
}

/** A save layer whose cycles never complete — for tests that drive
 *  collect/confirm by hand and must not have a real cycle confirming
 *  underneath them. Never combine with a REVIEW-mode create: that one awaits
 *  the in-flight save, by design. */
const pendingSave = () => vi.fn((_envelope: Envelope) => new Promise<never>(() => {}))

/**
 * Mount the provider. Passing `save` puts a real {@link DocumentSaveProvider}
 * above it (plus a live editor for its cycles to carry) — that is what makes
 * edit-mode creates ride the envelope. Without it there is no envelope, and
 * creates POST immediately.
 */
function mount(
  adapter: CommentsAdapter,
  user: CommentUser | undefined = ANA,
  save?: (envelope: Envelope) => Promise<unknown>,
) {
  const editor = save ? renderEditor([]).editor : null
  // The save window is long on purpose: these tests drive the cycle
  // explicitly, so a debounced one must never fire underneath them.
  const wrapper = ({ children }: { children: ReactNode }) =>
    save && editor ? (
      <DocumentSaveProvider save={save} debounceMs={1000}>
        <RegisterEditor editor={editor} />
        <CommentsProvider user={user} adapter={adapter}>
          {children}
        </CommentsProvider>
      </DocumentSaveProvider>
    ) : (
      <CommentsProvider user={user} adapter={adapter}>
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

describe('CommentsProvider anchor sync (the save envelope)', () => {
  const HELLO_NODES = [{ id: 'p1', from: 0, to: 5 }]
  const REPORT: CommentAnchorReport = { id: 'c-9', nodes: HELLO_NODES, quote: 'hello' }

  function fakeBridge(overrides: Partial<CommentAnchorBridge> = {}): CommentAnchorBridge {
    return {
      collect: () => [],
      confirm: vi.fn(),
      dirtyIds: () => [],
      // Queued creates re-derive through this: the fake keeps the submit-time
      // payload alive (a create whose text vanished returns null instead).
      payloadFor: () => ({ nodes: HELLO_NODES, quote: 'hello' }),
      ...overrides,
    }
  }

  it('collectSavePayload is null without a bridge — and creates never park without a pump', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter) // no save layer → no envelope to ride
    await waitFor(() => expect(result.current!.loading).toBe(false))

    expect(result.current!.anchorSync!.collectSavePayload()).toBeNull()

    // queueCreates without a pump must not park the POST forever.
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('posted straight away')).toBe(true)
    })
    expect(adapter.add).toHaveBeenCalledTimes(1)
  })

  it('the collected slice carries the dirty anchors; badges go pendingSave → saving', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter, ANA, pendingSave())
    await waitFor(() => expect(result.current!.loading).toBe(false))

    const bridge = fakeBridge({ collect: () => [REPORT], dirtyIds: () => ['c-9'] })
    act(() => result.current!.registerAnchorBridge(bridge))
    act(() => result.current!.notifyAnchorLedgerChanged())
    expect(result.current!.anchorSync!.states.get('c-9')).toBe('pendingSave')

    let payload!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    // The document it belongs with is the save layer's half of the frame —
    // pinned in documentSave.test.tsx, deliberately not duplicated here.
    expect(payload).toMatchObject({ anchors: [REPORT], creates: [] })
    expect(result.current!.anchorSync!.states.get('c-9')).toBe('saving')
  })

  it('queued tempIds never leak into the anchors half — their truth rides creates', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter, ANA, pendingSave())
    await waitFor(() => expect(result.current!.loading).toBe(false))

    // The plugin tracks queued creates under their tempId, so the ledger can
    // offer one up as an anchor report (a drifted range, or a proven detach).
    // An anchor report is a ROW update and a tempId has no row — the collect
    // must strip them; the create's truth rides `creates`, via payloadFor.
    let leaked: CommentAnchorReport[] = []
    const bridge = fakeBridge({ collect: () => [REPORT, ...leaked] })
    act(() => result.current!.registerAnchorBridge(bridge))
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    act(() => {
      void result.current!.addComment('parked', { nodes: HELLO_NODES, quote: 'hello' })
    })

    let first!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      first = result.current!.anchorSync!.collectSavePayload()
    })
    const tempId = first!.creates[0]!.tempId
    leaked = [{ id: tempId, nodes: [], quote: '' }]

    let second!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      second = result.current!.anchorSync!.collectSavePayload()
    })
    expect(second!.anchors).toEqual([REPORT])
    expect(second!.creates).toHaveLength(1)
  })

  it('a queued create asks for a cycle, rides the envelope and settles on confirm', async () => {
    const adapter = fakeAdapter()
    // A backend that mints the rows the envelope asked for — the response
    // shape the save layer relays back to the contributors.
    const sent: Envelope[] = []
    const save = vi.fn(async (envelope: Envelope) => {
      sent.push(envelope)
      return {
        created: envelope.creates.map((create) => ({
          tempId: create.tempId,
          row: saved('c-created', create.text),
        })),
      }
    })
    const { result } = mount(adapter, ANA, save)
    await waitFor(() => expect(result.current!.loading).toBe(false))

    const bridge = fakeBridge({ collect: () => [REPORT] })
    act(() => result.current!.registerAnchorBridge(bridge))
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'draft-time quote' }))

    let queued!: Promise<boolean>
    // Sync act: leaving it flushes the effect that asks for the cycle (which
    // must run AFTER the create is live in the plugin).
    act(() => {
      queued = result.current!.addComment('queued in edit mode', {
        nodes: HELLO_NODES,
        quote: 'submit-time quote',
      })
    })
    await act(async () => {
      await queued
    })
    // Parked for the envelope — the adapter's POST is NOT used in edit mode —
    // and a cycle went out NOW: submitting a comment changes no text, so
    // waiting for the save window to arm would park it until the next edit.
    expect(adapter.add).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current!.draft).toBeNull() // optimistic clear

    // RE-DERIVED, never replayed: the plugin tracks the queued create under
    // its tempId, so the envelope carries the range as it stands NOW (the
    // bridge's payloadFor) instead of the submit-time freeze.
    expect(sent[0].creates).toEqual([
      {
        tempId: sent[0].creates[0].tempId,
        text: 'queued in edit mode',
        nodes: HELLO_NODES,
        quote: 'hello',
      },
    ])
    // Confirmed by the backend's response: the composer's promise settles and
    // the anchors collected in that same envelope become baselines.
    expect(await queued).toBe(true)
    expect(bridge.confirm).toHaveBeenCalledWith([REPORT])
    expect(adapter.add).not.toHaveBeenCalled()

    // Review mode: the POST goes out immediately again.
    act(() => result.current!.setQueueCreates(false))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      expect(await result.current!.addComment('review mode direct')).toBe(true)
    })
    expect(adapter.add).toHaveBeenCalledTimes(1)
  })

  it('discardSave keeps everything queued — the next collect resends the create', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter, ANA, pendingSave())
    await waitFor(() => expect(result.current!.loading).toBe(false))

    act(() => result.current!.registerAnchorBridge(fakeBridge({ dirtyIds: () => ['c-9'] })))
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    act(() => {
      void result.current!.addComment('parked', { nodes: HELLO_NODES, quote: 'hello' })
    })

    let first!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      first = result.current!.anchorSync!.collectSavePayload()
    })
    expect(first!.creates).toHaveLength(1)

    act(() => result.current!.anchorSync!.discardSave(first!.token))
    expect(result.current!.anchorSync!.states.get('c-9')).toBe('pendingSave')

    let second!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      second = result.current!.anchorSync!.collectSavePayload()
    })
    expect(second!.creates).toEqual(first!.creates) // same tempId, still queued
  })

  it('a stale token cannot confirm — only the LATEST collect counts', async () => {
    const adapter = fakeAdapter()
    const { result } = mount(adapter, ANA, pendingSave())
    await waitFor(() => expect(result.current!.loading).toBe(false))

    const bridge = fakeBridge({ collect: () => [REPORT] })
    act(() => result.current!.registerAnchorBridge(bridge))

    let first!: ReturnType<CommentAnchorSync['collectSavePayload']>
    let second!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      first = result.current!.anchorSync!.collectSavePayload()
      second = result.current!.anchorSync!.collectSavePayload() // supersedes
    })
    act(() => result.current!.anchorSync!.confirmSaved(first!.token))
    expect(bridge.confirm).not.toHaveBeenCalled()

    act(() => result.current!.anchorSync!.confirmSaved(second!.token))
    expect(bridge.confirm).toHaveBeenCalledWith([REPORT])
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


describe('queued creates are live, not frozen', () => {
  const HELLO_NODES = [{ id: 'p1', from: 0, to: 5 }]

  function bridgeWith(payloadFor: (id: string) => CommentAnchorPayload | null): CommentAnchorBridge {
    return {
      collect: () => [],
      confirm: vi.fn(),
      dirtyIds: () => [],
      payloadFor,
    }
  }

  async function queueOne(bridge?: CommentAnchorBridge) {
    const adapter = fakeAdapter()
    const { result } = mount(adapter, ANA, pendingSave())
    await waitFor(() => expect(result.current!.loading).toBe(false))
    if (bridge) act(() => result.current!.registerAnchorBridge(bridge))
    act(() => result.current!.setQueueCreates(true))
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    let settled!: Promise<boolean>
    act(() => {
      settled = result.current!.addComment('note', { nodes: HELLO_NODES, quote: 'hello' })
    })
    return { result, settled, adapter }
  }

  it('the envelope carries the CURRENT geometry — an edit after submit travels, the freeze does not', async () => {
    const moved = { nodes: [{ id: 'p1', from: 3, to: 8 }], quote: 'moved' }
    const { result } = await queueOne(bridgeWith(() => moved))

    let payload!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.creates[0]).toMatchObject(moved)
  })

  it('a create whose commented text was deleted is EVICTED — it can never validate', async () => {
    // Without eviction one dead create would reject every future envelope
    // (the backend validates its quote against the doc), wedging the autosave
    // for the rest of the session.
    const { result, settled } = await queueOne(bridgeWith(() => null))

    let payload!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.creates).toEqual([])
    expect(await settled).toBe(false)
    expect(result.current!.error).toMatch(/removed/i)

    // And it never comes back.
    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.creates).toEqual([])
  })

  it('a TERMINAL discard settles every queued create — no composer promise hangs', async () => {
    const { result, settled } = await queueOne(bridgeWith(() => ({ nodes: HELLO_NODES, quote: 'hello' })))

    let payload!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.creates).toHaveLength(1)

    // The pump gave up (version conflict): retrying would be rejected
    // identically, so the queue must not wait forever.
    act(() => result.current!.anchorSync!.discardSave(payload!.token, { stopped: true }))
    expect(await settled).toBe(false)

    act(() => {
      payload = result.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.creates).toEqual([])
  })

  it('a create queued AFTER the collect survives that envelope confirm and rides the next one', async () => {
    const { result } = await queueOne(bridgeWith(() => ({ nodes: HELLO_NODES, quote: 'hello' })))

    let first!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      first = result.current!.anchorSync!.collectSavePayload()
    })
    // A second comment is submitted while the envelope is in flight.
    act(() => result.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    act(() => {
      void result.current!.addComment('second', { nodes: HELLO_NODES, quote: 'hello' })
    })

    act(() =>
      result.current!.anchorSync!.confirmSaved(first!.token, {
        created: [{ tempId: first!.creates[0].tempId, row: saved('c-1', 'note') }],
      }),
    )

    let second!: ReturnType<CommentAnchorSync['collectSavePayload']>
    act(() => {
      second = result.current!.anchorSync!.collectSavePayload()
    })
    expect(second!.creates).toHaveLength(1)
    expect(second!.creates[0].text).toBe('second')
  })
})
