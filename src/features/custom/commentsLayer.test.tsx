import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Two tests below switch to fake timers INLINE mid-test; a failure between
// the switch and its inline restore would leak fake timers into every test
// after it — this backstop keeps the suite hermetic.
afterEach(() => {
  vi.useRealTimers()
})
import type { JSONContent } from '@tiptap/core'
import { docWith, renderEditor } from '../../test/editorHarness'
import { ANCHOR_REPORT_DEBOUNCE_MS, CommentsFeature, getCommentsStorage } from './comments'
import type { CommentAnchorPayload } from './commentAnchor'
import { ANCHOR_RETRY_BACKOFF_MS } from './commentSync'
import { CommentsLayer, commentBalloonShouldShow } from './commentsLayer'
import {
  CommentsProvider,
  useComments,
  type CommentsContextValue,
  type DocumentComment,
} from './commentsProvider'

/* Same rig as BubbleToolbar.wiring.test: TipTap's BubbleMenu only appends its
   element on the first show(), which needs layout jsdom doesn't do — mock it
   to a passthrough so the wiring contract stays deterministic. */
const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: (props: Record<string, unknown>) => {
    captured.push(props)
    return (
      <div data-testid="balloon-mock" className={props.className as string}>
        {props.children as React.ReactNode}
      </div>
    )
  },
}))

const ANA = { id: 'u-ana', name: 'Ana Lima' }
const SAVED: DocumentComment = {
  id: 'c-1',
  quote: 'hello',
  text: 'tighten',
  author: ANA,
  createdAt: '2026-07-15T12:00:00Z',
  // 'OPEN' matters: only OPEN comments keep their mark through reconciliation.
  status: 'OPEN',
  canEdit: true,
  canReply: true,
  canDelete: true,
  canResolve: false,
  canArchive: false,
  replies: [],
}

function reviewEditor() {
  const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
  created.editor.setEditable(false)
  return created
}

const quietAdapter = () => ({
  list: vi.fn(async () => [SAVED]),
  add: vi.fn(async () => ({ id: 'c-new' })),
  reply: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  setStatus: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/* Fixtures with EXPLICIT uids, so `nodes[]` anchors are deterministic —
 * injectNodeIds keeps unique explicit ids verbatim on the way in. */
const paragraph = (uid: string, text: string): JSONContent => ({
  type: 'paragraph',
  attrs: { uid },
  content: [{ type: 'text', text }],
})
const docOf = (...blocks: JSONContent[]): { doc: JSONContent } => ({
  doc: { type: 'doc', content: blocks },
})

describe('commentBalloonShouldShow', () => {
  it('true only for a read-only TEXT selection with no draft in flight', () => {
    const created = reviewEditor()
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(commentBalloonShouldShow(created.editor)).toBe(true)

    // Collapsed caret → nothing to quote.
    created.editor.commands.setTextSelection(3)
    expect(commentBalloonShouldShow(created.editor)).toBe(false)

    // Draft already being composed → the composer owns the moment.
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    getCommentsStorage(created.editor)!.draft = { from: 1, to: 6, quote: 'hello' }
    expect(commentBalloonShouldShow(created.editor)).toBe(false)
    getCommentsStorage(created.editor)!.draft = null

    // Edit mode → COMPOSING does not exist there (highlights do).
    created.editor.setEditable(true)
    expect(commentBalloonShouldShow(created.editor)).toBe(false)
  })

  it('false on an empty document', () => {
    const created = renderEditor([CommentsFeature])
    created.editor.setEditable(false)
    expect(commentBalloonShouldShow(created.editor)).toBe(false)
  })
})

describe('<CommentsLayer />', () => {
  it('wires the balloon: 6px BELOW the selection, portaled to body, popup-marked', async () => {
    const created = reviewEditor()
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    const props = captured.at(-1)!
    expect(props.options).toEqual({ placement: 'bottom', offset: 6 })
    expect((props.appendTo as () => HTMLElement)()).toBe(document.body)
    expect(props.className).toBe('document-editor-popup comment-balloon')
    expect(props.pluginKey).toBe('commentsBalloon')
  })

  it('clicking "Add comment" captures the selection as the draft (range + quote)', async () => {
    const created = reviewEditor()
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))

    await waitFor(() =>
      expect(getCommentsStorage(created.editor)!.draft).toEqual({
        from: 1,
        to: 6,
        quote: 'hello',
      }),
    )
    // The captured range shows as the draft decoration — visible even after
    // focus moves into the composer field.
    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('hello')
  })

  it('renders nothing outside a CommentsProvider', () => {
    const created = reviewEditor()
    const before = captured.length
    const { container } = render(<CommentsLayer editor={created.editor} />)
    expect(container.innerHTML).toBe('')
    expect(captured.length).toBe(before)
  })
})

describe('<CommentsLayer /> list → highlight lifecycle', () => {
  it('a comment that turns RESOLVED or SOFT-DELETED remotely sheds its highlight on refresh', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'beta')),
    })
    let rows: DocumentComment[] = [
      { ...SAVED, id: 'c-1', nodes: [{ id: 'p1', from: 0, to: 5 }] },
      { ...SAVED, id: 'c-2', nodes: [{ id: 'p2', from: 0, to: 4 }] },
    ]
    const adapter = { ...quietAdapter(), list: vi.fn(async () => [...rows]) }
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={adapter}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    await waitFor(() =>
      expect(created.editor.view.dom.querySelectorAll('[data-comment-id]')).toHaveLength(2),
    )

    // Someone else resolved one and soft-deleted the other; this client only
    // sees the refreshed list — the bridge stops handing both to the plugin.
    rows = [
      { ...rows[0], status: 'RESOLVED' },
      { ...rows[1], isDeleted: true },
    ]
    await act(async () => {
      await context.current!.refresh()
    })
    await waitFor(() =>
      expect(created.editor.view.dom.querySelectorAll('[data-comment-id]')).toHaveLength(0),
    )
  })

  it('an optimistic full-row create paints its highlight BEFORE the refetch lands', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    created.editor.setEditable(false)
    const fullRow = (nodes: DocumentComment['nodes']): DocumentComment => ({
      ...SAVED,
      id: 'c-new',
      text: 'fresh',
      nodes,
    })
    const adapter = {
      ...quietAdapter(),
      list: vi
        .fn<() => Promise<DocumentComment[]>>()
        .mockResolvedValueOnce([])
        // The post-add refetch hangs — the optimistic row must carry the UI.
        .mockReturnValue(new Promise<DocumentComment[]>(() => {})),
      add: vi.fn(async (input: { nodes?: DocumentComment['nodes'] }) => fullRow(input.nodes)),
    }
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={adapter}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    await waitFor(() => expect(adapter.list).toHaveBeenCalled())

    // The composer flow: draft captured, payload recomputed at submit.
    act(() => context.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    act(() => {
      void context.current!.addComment('fresh', {
        nodes: [{ id: 'p1', from: 0, to: 5 }],
        quote: 'hello',
      })
    })

    await waitFor(() =>
      expect(
        created.editor.view.dom.querySelector('[data-comment-id="c-new"]')?.textContent,
      ).toBe('hello'),
    )
  })

  it('REMAPS the draft through doc changes — and cancels it when its text is deleted', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    await waitFor(() => expect(context.current).not.toBeNull())
    act(() => context.current!.setDraft({ from: 7, to: 12, quote: 'world' }))

    // Typing BEFORE the range shifts it — the pending anchor must follow.
    act(() => {
      created.editor.commands.insertContentAt(1, 'xx')
    })
    await waitFor(() =>
      expect(context.current!.draft).toEqual({ from: 9, to: 14, quote: 'world' }),
    )
    // The draft decoration follows too.
    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('world')

    // Deleting the drafted text cancels the draft — anchoring the wrong
    // characters would be worse than losing the capture.
    act(() => {
      created.editor.commands.deleteRange({ from: 9, to: 14 })
    })
    await waitFor(() => expect(context.current!.draft).toBeNull())
  })

})

describe('<CommentsLayer /> document-click → active comment', () => {
  it('registers the kernel callback; a highlight click round-trips into activeId', async () => {
    const created = reviewEditor()
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    const storage = getCommentsStorage(created.editor)!
    await waitFor(() => expect(storage.onCommentClick).not.toBeNull())

    act(() => storage.onCommentClick!('c-1'))

    // Provider activeId → layer sync → back into the kernel storage (and the
    // active decoration with it).
    await waitFor(() => expect(storage.activeId).toBe('c-1'))
  })
})

describe('<CommentsLayer /> anchor-model wiring', () => {
  it('lands OPEN nodes-carrying rows in the kernel storage — resolved, deleted and nodeless rows stay out', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world'), paragraph('p2', 'beta')),
    })
    created.editor.setEditable(false)
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [
        { ...SAVED, id: 'c-anchor', nodes: [{ id: 'p1', from: 0, to: 5 }] },
        { ...SAVED, id: 'c-resolved', status: 'RESOLVED' as const, nodes: [{ id: 'p2', from: 0, to: 4 }] },
        { ...SAVED, id: 'c-deleted', isDeleted: true, nodes: [{ id: 'p2', from: 0, to: 4 }] },
        { ...SAVED, id: 'c-nodeless' }, // nothing to resolve → orphan card only
      ]),
    }

    render(
      <CommentsProvider adapter={adapter}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    const storage = getCommentsStorage(created.editor)!
    await waitFor(() =>
      expect(storage.comments.map((record) => record.id)).toEqual(['c-anchor']),
    )
    // The row's quote rides along — it seeds the reporter's baseline.
    expect(storage.comments[0].quote).toBe('hello')
    // And the nudge ran the plugin's membership reconcile: highlight painted.
    expect(
      created.editor.view.dom.querySelector('[data-comment-id="c-anchor"]')?.textContent,
    ).toBe('hello')
  })

  it('DOC-FIRST pin: reports only queue; every updateAnchor lands after the doc save resolved', async () => {
    // EDIT mode (editable default): the mode where the doc changes underneath.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const log: string[] = []
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [{ ...SAVED, nodes: [{ id: 'p1', from: 0, to: 5 }] }]),
      updateAnchor: vi.fn(async (id: string) => {
        log.push(`updateAnchor:${id}`)
      }),
    }
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={adapter}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    const storage = getCommentsStorage(created.editor)!
    await waitFor(() => expect(storage.comments.map((record) => record.id)).toEqual(['c-1']))
    await waitFor(() => expect(storage.onAnchorReport).not.toBeNull())

    // Type before the commented word — the reporter derives + debounces…
    vi.useFakeTimers()
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('XX', 1))
    })
    act(() => {
      vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    })
    vi.useRealTimers()

    // …and the report went into the QUEUE. Zero network so far.
    expect(adapter.updateAnchor).not.toHaveBeenCalled()
    expect(context.current!.anchorSync!.states.get('c-1')).toBe('pendingSave')

    // The consumer's save pump: the doc save FIRST, the flush only after it
    // RESOLVED — this call order is the whole doc-first contract.
    const saveDoc = async () => {
      log.push('saveDoc:start')
      await sleep(5)
      log.push('saveDoc:resolved')
    }
    await act(async () => {
      await saveDoc()
      await context.current!.anchorSync!.flushAnchors()
    })

    expect(adapter.updateAnchor).toHaveBeenCalledTimes(1)
    expect(adapter.updateAnchor).toHaveBeenCalledWith('c-1', {
      nodes: [{ id: 'p1', from: 2, to: 7 }],
      quote: 'hello',
    })
    expect(log.indexOf('updateAnchor:c-1')).toBeGreaterThan(log.indexOf('saveDoc:resolved'))
    expect(context.current!.anchorSync!.states.get('c-1')).toBe('synced')
  })

  it('mirrors editor.isEditable into queueCreates — live across setEditable', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    // Editable on mount → edit mode queues creates.
    await waitFor(() => expect(context.current!.queueCreates).toBe(true))
    act(() => {
      created.editor.setEditable(false)
    })
    await waitFor(() => expect(context.current!.queueCreates).toBe(false))
    act(() => {
      created.editor.setEditable(true)
    })
    await waitFor(() => expect(context.current!.queueCreates).toBe(true))
  })

  it('retryAnchor resends the CURRENT plugin derivation — not the payload that failed', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [{ ...SAVED, nodes: [{ id: 'p1', from: 0, to: 5 }] }]),
      updateAnchor: vi
        .fn<(id: string, payload: CommentAnchorPayload) => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('anchor endpoint down'))
        .mockRejectedValueOnce(new Error('anchor endpoint down'))
        .mockResolvedValue({}),
    }
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    render(
      <CommentsProvider adapter={adapter}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    const storage = getCommentsStorage(created.editor)!
    await waitFor(() => expect(storage.comments.map((record) => record.id)).toEqual(['c-1']))
    await waitFor(() => expect(storage.onAnchorReport).not.toBeNull())

    vi.useFakeTimers()
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('XX', 1))
    })
    act(() => {
      vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    })
    // Both in-flush attempts fail (the backoff between them is a timer).
    await act(async () => {
      const flushed = context.current!.anchorSync!.flushAnchors()
      await vi.advanceTimersByTimeAsync(ANCHOR_RETRY_BACKOFF_MS)
      await flushed
    })
    expect(context.current!.anchorSync!.states.get('c-1')).toBe('saveFailed')
    expect(adapter.updateAnchor).toHaveBeenCalledTimes(2)
    expect(adapter.updateAnchor).toHaveBeenLastCalledWith('c-1', {
      nodes: [{ id: 'p1', from: 2, to: 7 }],
      quote: 'hello',
    })

    // The doc moves on BEFORE the user clicks Retry — the retry must carry
    // the freshly recomputed offsets, never replay the failed ones.
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('YY', 1))
    })
    act(() => {
      context.current!.anchorSync!.retryAnchor('c-1')
    })
    await act(async () => {
      await context.current!.anchorSync!.flushAnchors()
    })
    expect(adapter.updateAnchor).toHaveBeenLastCalledWith('c-1', {
      nodes: [{ id: 'p1', from: 4, to: 9 }],
      quote: 'hello',
    })
    expect(context.current!.anchorSync!.states.get('c-1')).toBe('synced')

    // Drain the reporter's own pending window before real timers return.
    act(() => {
      vi.advanceTimersByTime(ANCHOR_REPORT_DEBOUNCE_MS)
    })
    vi.useRealTimers()
  })
})
