import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature, getCommentsStorage } from './comments'
import { CommentsLayer, commentBalloonShouldShow } from './commentsLayer'
import { CommentsProvider, type DocumentComment } from './commentsProvider'

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
  from: 1,
  to: 6,
  quote: 'hello',
  text: 'tighten',
  author: ANA,
  createdAt: '2026-07-15T12:00:00Z',
}

function reviewEditor() {
  const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
  created.editor.setEditable(false)
  return created
}

const quietAdapter = () => ({
  list: vi.fn(async () => [SAVED]),
  add: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
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

    // Edit mode → commenting does not exist there.
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

  it('syncs the provider comments into the kernel storage (decorations light up)', async () => {
    const created = reviewEditor()
    render(
      <CommentsProvider adapter={quietAdapter()}>
        <CommentsLayer editor={created.editor} />
      </CommentsProvider>,
    )

    await waitFor(() =>
      expect(getCommentsStorage(created.editor)!.comments.map((comment) => comment.id)).toEqual([
        'c-1',
      ]),
    )
    expect(
      created.editor.view.dom.querySelector('span.comment[data-comment-id="c-1"]'),
    ).not.toBeNull()
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
