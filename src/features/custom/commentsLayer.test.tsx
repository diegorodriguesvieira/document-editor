import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { docWith, editorFromDOM, renderEditor } from '../../test/editorHarness'
import { DocumentEditor, DocumentSaveProvider, type Editor } from '../../editor'
import { useDocumentSaveRegistry } from '../../editor/core/documentSave'
import { createMockCommentsApi, type SaveEnvelope } from '../../app/commentsMock'
import { CommentsFeature, getCommentAnchorState, getCommentsStorage } from './comments'
import { CommentsLayer, commentBalloonShouldShow } from './commentsLayer'
import {
  CommentsProvider,
  useComments,
  type CommentSavePayload,
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

/** Hands a headless editor to the save layer, the way `useDocumentEditor`
 *  does for React-mounted ones. */
function RegisterEditor({ editor }: { editor: Editor }) {
  const registry = useDocumentSaveRegistry()
  useEffect(() => registry?.registerEditor(editor), [registry, editor])
  return null
}

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
  it('lands every OPEN row in the kernel storage — resolved and deleted stay out, nodeless rides along', async () => {
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
        { ...SAVED, id: 'c-nodeless' }, // detached on the backend → orphan card
      ]),
    }

    render(
      <CommentsProvider adapter={adapter}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    const storage = getCommentsStorage(created.editor)!
    // A detached row STAYS in the population: membership is what keeps its
    // in-session tombstone (and with it, paste/undo resurrection) alive
    // across a records refresh. It seeds zero entries — nothing paints.
    await waitFor(() =>
      expect(storage.comments.map((record) => record.id)).toEqual(['c-anchor', 'c-nodeless']),
    )
    // The row's quote rides along — it seeds the reporter's baseline.
    expect(storage.comments[0].quote).toBe('hello')
    expect(getCommentAnchorState(created.editor, 'c-nodeless')).toBe('orphaned')
    // And the nudge ran the plugin's membership reconcile: highlight painted
    // for the anchored row only.
    expect(
      created.editor.view.dom.querySelector('[data-comment-id="c-anchor"]')?.textContent,
    ).toBe('hello')
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-nodeless"]')).toBeNull()
  })

  it('ENVELOPE pin: the drifted anchor rides ONE payload with the doc — pendingSave → saving → gone', async () => {
    // EDIT mode (editable default): the mode where the doc changes underneath.
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [{ ...SAVED, nodes: [{ id: 'p1', from: 0, to: 5 }] }]),
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
    // The plugin's envelope seams, routed through the provider by the bridge.
    expect(storage.collectDirtyAnchors).not.toBeNull()
    expect(storage.confirmAnchorsSaved).not.toBeNull()
    expect(storage.dirtyAnchorIds).not.toBeNull()
    await waitFor(() => expect(storage.onAnchorLedgerChanged).not.toBeNull())

    // Type before the commented word: the ledger dirties and NOTIFIES — the
    // badge state follows the edit with no timer in between.
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('XX', 1))
    })
    await waitFor(() => expect(context.current!.anchorSync!.states.get('c-1')).toBe('pendingSave'))

    // The save layer collects this slice inside the frame that snapshots the
    // document (the coherence law — pinned in documentSave.test.tsx and in the
    // end-to-end test above); here we pin what the slice CONTAINS.
    let payload: CommentSavePayload | null = null
    act(() => {
      payload = context.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.anchors).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 2, to: 7 }], quote: 'hello' },
    ])
    // Collected = in flight.
    await waitFor(() => expect(context.current!.anchorSync!.states.get('c-1')).toBe('saving'))

    // Confirmed: those payloads ARE the row now — no badge, nothing left for
    // the next envelope to carry.
    act(() => context.current!.anchorSync!.confirmSaved(payload!.token))
    await waitFor(() => expect(context.current!.anchorSync!.states.get('c-1')).toBeUndefined())
    act(() => {
      payload = context.current!.anchorSync!.collectSavePayload()
    })
    expect(payload!.anchors).toEqual([])
  })

  it('ENVELOPE end-to-end: the save layer carries doc + anchors, with no wiring in between', async () => {
    // The whole composition as a consumer writes it: a save provider on the
    // outside, comments inside it, the editor inside that. Nobody passes a
    // pump, a binder or an onChange — the editor registers itself and comments
    // contributes its slice.
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [{ ...SAVED, nodes: [{ id: 'p1', from: 0, to: 5 }] }]),
    }
    const save = vi.fn(async (_envelope: { doc: JSONContent } & Record<string, unknown>) => ({}))
    render(
      <DocumentSaveProvider save={save} debounceMs={20}>
        <CommentsProvider adapter={adapter}>
          <DocumentEditor
            features={[CommentsFeature]}
            content={docOf(paragraph('p1', 'hello world'))}
            renderBubble={(ctx) => <CommentsLayer editor={ctx.editor} />}
          />
        </CommentsProvider>
      </DocumentSaveProvider>,
    )
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const live = editorFromDOM()
    await waitFor(() =>
      expect(getCommentsStorage(live)!.comments.map((record) => record.id)).toEqual(['c-1']),
    )

    // Type BEFORE the commented word: the anchor drifts…
    act(() => {
      live.view.dispatch(live.state.tr.insertText('XX', 1))
    })

    // …and rides the very envelope carrying the document it drifted in.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const envelope = save.mock.calls[0][0]
    expect(envelope.doc).toEqual(live.getJSON())
    expect(envelope.anchors).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 2, to: 7 }], quote: 'hello' },
    ])
    expect(envelope.creates).toEqual([])

    // The confirmation landed: an edit that does NOT move the anchor costs no
    // anchor write at all — the baseline was advanced by the save above.
    act(() => {
      live.view.dispatch(live.state.tr.insertText('!', live.state.doc.content.size - 1))
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0].anchors).toEqual([])
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

  it('a DISCARDED envelope stays queued — the next collect carries the CURRENT derivation', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [{ ...SAVED, nodes: [{ id: 'p1', from: 0, to: 5 }] }]),
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

    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('XX', 1))
    })
    let first: CommentSavePayload | null = null
    act(() => {
      first = context.current!.anchorSync!.collectSavePayload()
    })
    expect(first!.anchors).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 2, to: 7 }], quote: 'hello' },
    ])

    // The envelope failed: NOTHING was persisted, so the anchor drops back to
    // pendingSave and keeps riding the next one.
    act(() => context.current!.anchorSync!.discardSave(first!.token))
    await waitFor(() => expect(context.current!.anchorSync!.states.get('c-1')).toBe('pendingSave'))

    // The doc moves on before the pump retries — the retry snapshots the
    // FRESH derivation (doc and anchors together), never replays the failure.
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('YY', 1))
    })
    let second: CommentSavePayload | null = null
    act(() => {
      second = context.current!.anchorSync!.collectSavePayload()
    })
    expect(second!.anchors).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 4, to: 9 }], quote: 'hello' },
    ])
  })

  it('unmounting the layer unregisters the bridge — no editor, no envelope', async () => {
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const adapter = quietAdapter()
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    const { rerender } = render(
      <CommentsProvider adapter={adapter}>
        <Probe />
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )
    await waitFor(() => expect(context.current).not.toBeNull())

    let payload: CommentSavePayload | null = null
    act(() => {
      payload = context.current!.anchorSync!.collectSavePayload()
    })
    expect(payload).not.toBeNull()

    // The layer goes: its cleanup hands the provider a null bridge, and an
    // envelope without a live editor is no envelope at all.
    rerender(
      <CommentsProvider adapter={adapter}>
        <Probe />
      </CommentsProvider>,
    )
    act(() => {
      payload = context.current!.anchorSync!.collectSavePayload()
    })
    expect(payload).toBeNull()
    // The plugin's own seams unregister with the editor, not with the layer.
    expect(getCommentsStorage(created.editor)!.onAnchorLedgerChanged).toBeNull()
  })
})

/* The one test where BOTH halves are real: plugin-derived payloads meet the
 * mock backend's validator (the same quote norm the real backend implements),
 * instead of hand-built fakes agreeing with each other by construction. */
describe('<CommentsLayer /> — a REAL envelope round-trip', () => {
  it('a plugin-derived anchor and a queued create pass the validator; confirm cleans the ledger', async () => {
    const api = createMockCommentsApi({
      sessionUser: ANA,
      latencyMs: 0,
      template: docOf(paragraph('p1', 'hello world')),
      seed: [
        {
          id: 'c-1',
          quote: 'hello',
          text: 'seeded',
          author: ANA,
          createdAt: '2026-07-15T12:00:00Z',
          status: 'OPEN',
          nodes: [{ id: 'p1', from: 0, to: 5 }],
          replies: [],
        },
      ],
    })
    const created = renderEditor([CommentsFeature], {
      content: docOf(paragraph('p1', 'hello world')),
    })
    const context = { current: null as CommentsContextValue | null }
    function Probe() {
      context.current = useComments()
      return null
    }
    // THE REAL BACKEND, reached the way a consumer reaches it: the SDK builds
    // the envelope and this is the only wiring in between.
    const sent: Array<Omit<SaveEnvelope, 'versionId'>> = []
    const save = async (envelope: Omit<SaveEnvelope, 'versionId'>) => {
      sent.push(envelope)
      return api.saveEnvelope({ versionId: api.versionId, ...envelope })
    }
    // A realistic window: the edit below must NOT get an envelope of its own —
    // the cycle the comment asks for is what sends, carrying both halves.
    render(
      <DocumentSaveProvider save={save} debounceMs={1000}>
        <RegisterEditor editor={created.editor} />
        <CommentsProvider user={ANA} adapter={api.adapter}>
          <Probe />
          <CommentsLayer editor={created.editor} />
        </CommentsProvider>
      </DocumentSaveProvider>,
    )
    await waitFor(() => expect(context.current!.loading).toBe(false))
    await waitFor(() =>
      expect(created.editor.view.dom.querySelectorAll('[data-comment-id]').length).toBe(1),
    )

    // Edit mode: an edit moves the seeded anchor, and a comment is submitted
    // on 'world' — both must ride ONE envelope.
    act(() => context.current!.setQueueCreates(true))
    act(() => {
      created.editor.view.dispatch(created.editor.state.tr.insertText('say ', 1))
    })
    act(() => context.current!.setDraft({ from: 10, to: 15, quote: 'world' }))
    let submitted!: Promise<boolean>
    act(() => {
      submitted = context.current!.addComment('about world', {
        nodes: [{ id: 'p1', from: 10, to: 15 }],
        quote: 'world',
      })
    })

    // Submitting a comment changes no text, so the cycle it asks for is what
    // sends — no organic edit required. ONE envelope carries both halves…
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].anchors).toEqual([
      { id: 'c-1', nodes: [{ id: 'p1', from: 4, to: 9 }], quote: 'hello' },
    ])
    expect(sent[0].creates).toHaveLength(1)
    // …and the quotes were validated against the doc in that very request — a
    // mismatch here would mean the two halves disagree.
    await act(async () => {
      expect(await submitted).toBe(true)
    })
    expect(api.peekComments().find((row) => row.id === 'c-1')!.nodes).toEqual([
      { id: 'p1', from: 4, to: 9 },
    ])
    expect(api.peekComments()).toHaveLength(2)
    // Confirmed → the ledger is clean and the next envelope carries nothing.
    let leftover: CommentSavePayload | null = null
    act(() => {
      leftover = context.current!.anchorSync!.collectSavePayload()
    })
    expect(leftover!.anchors).toEqual([])
    expect(leftover!.creates).toEqual([])
  })
})
