import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { HistoryFeature } from '../history'
import { CommentsFeature, getCommentsStorage } from './comments'
import { applyCommentAnchor } from './commentAnchors'
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
  // 'open' matters: only OPEN comments keep their mark through reconciliation.
  status: 'open',
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

describe('<CommentsLayer /> doc↔backend reconciliation', () => {
  it('strips marks the backend does not know once the list lands — known ones stay', async () => {
    // EDITABLE on purpose: reconciliation is not a review-mode-only job.
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    applyCommentAnchor(created.editor, 'c-ghost', { from: 7, to: 12 })

    render(
      <CommentsProvider adapter={quietAdapter()}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-ghost"]')).toBeNull(),
    )
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).not.toBeNull()
  })

  it('sheds the mark of a comment that turned RESOLVED — only open comments keep anchors', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    applyCommentAnchor(created.editor, 'c-2', { from: 7, to: 12 })
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [
        { ...SAVED, id: 'c-1', status: 'resolved' as const },
        { ...SAVED, id: 'c-2' },
      ]),
    }

    render(
      <CommentsProvider adapter={adapter}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).toBeNull(),
    )
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-2"]')).not.toBeNull()
  })

  it('a FRESH anchor survives a lagging backend list (grace), then expires', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    // Read-replica lag: the list NEVER includes the just-created comment.
    const adapter = { ...quietAdapter(), list: vi.fn(async () => [] as DocumentComment[]) }
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

    // The real add flow: draft → add returns the id → anchor applied.
    act(() => context.current!.setDraft({ from: 1, to: 6, quote: 'hello' }))
    await act(async () => {
      await context.current!.addComment('fresh', (id) =>
        applyCommentAnchor(created.editor, id, { from: 1, to: 6 }),
      )
    })

    // The post-add refetch came back WITHOUT c-new — the grace set must keep
    // the fresh mark from being stripped as unknown.
    await sleep(20)
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-new"]')).not.toBeNull()

    // …but an id the backend never acknowledges expires after a few fetches.
    await act(async () => {
      await context.current!.refresh()
    })
    await act(async () => {
      await context.current!.refresh()
    })
    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-new"]')).toBeNull(),
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

  it('a failed MUTATION does not freeze reconciliation — only a failed fetch does', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    const adapter = {
      ...quietAdapter(),
      update: vi.fn(async () => {
        throw new Error('PATCH exploded')
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
    await waitFor(() => expect(adapter.list).toHaveBeenCalled())

    // A mutation fails → the panel banner has an error…
    await act(async () => {
      expect(await context.current!.updateComment('c-1', 'boom')).toBe(false)
    })
    expect(context.current!.error).toBe('PATCH exploded')
    expect(context.current!.listError).toBeNull()

    // …but the doc-side reconciliation must still run: a ghost mark appearing
    // now (undo resurrection, hand-crafted content) is stripped regardless.
    act(() => {
      applyCommentAnchor(created.editor, 'c-ghost', { from: 7, to: 12 })
    })
    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-ghost"]')).toBeNull(),
    )
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).not.toBeNull()
  })

  it('never strips while the fetch is still pending', async () => {
    const created = reviewEditor()
    applyCommentAnchor(created.editor, 'c-ghost', { from: 1, to: 6 })
    const adapter = { ...quietAdapter(), list: vi.fn(() => new Promise<DocumentComment[]>(() => {})) }

    render(
      <CommentsProvider adapter={adapter}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await waitFor(() => expect(adapter.list).toHaveBeenCalled())
    await sleep(20)
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-ghost"]')).not.toBeNull()
  })

  it('re-strips a mark RESURRECTED by undo after its comment died on the backend', async () => {
    // EDIT mode with history: the mark's own transactions are off-history,
    // but deleting the commented TEXT is a normal, undoable edit — undo
    // brings the text back WITH the mark. This is the scenario the layer's
    // doc-derived anchoredKey dep exists for: the backend list did not
    // change, only the DOC did, and reconciliation must still re-run.
    const created = renderEditor([HistoryFeature, CommentsFeature], {
      content: docWith('hello world'),
    })
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    // In-memory backend that actually FORGETS on remove (quietAdapter is static).
    let db = [SAVED]
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => [...db]),
      remove: vi.fn(async (id: string) => {
        db = db.filter((comment) => comment.id !== id)
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
    // Baseline: the backend knows c-1, so the landed list keeps its mark.
    await waitFor(() => expect(adapter.list).toHaveBeenCalled())
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).not.toBeNull()

    // The commented text is deleted (undoable edit — the mark goes with it),
    // THEN the comment is deleted backend-side (delete + refetch).
    act(() => {
      created.editor.commands.deleteRange({ from: 1, to: 6 })
    })
    await act(async () => {
      await context.current!.removeComment('c-1')
    })
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).toBeNull()

    // Undo resurrects the text WITH its mark…
    let resurrected = false
    act(() => {
      created.editor.commands.undo()
      resurrected = JSON.stringify(created.editor.getJSON()).includes('c-1')
    })
    expect(resurrected).toBe(true)

    // …and reconciliation re-strips it: the backend no longer knows c-1.
    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-1"]')).toBeNull(),
    )
    // Only the dangling ANCHOR was shed — the undone text itself stays.
    expect(created.editor.state.doc.textContent).toContain('hello')
  })

  it('never strips on a FAILED fetch — an offline blip must not shed anchors', async () => {
    const created = reviewEditor()
    applyCommentAnchor(created.editor, 'c-ghost', { from: 1, to: 6 })
    const adapter = {
      ...quietAdapter(),
      list: vi.fn(async () => {
        throw new Error('offline')
      }),
    }

    render(
      <CommentsProvider adapter={adapter}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await waitFor(() => expect(adapter.list).toHaveBeenCalled())
    await sleep(20)
    expect(created.editor.view.dom.querySelector('[data-comment-id="c-ghost"]')).not.toBeNull()
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
