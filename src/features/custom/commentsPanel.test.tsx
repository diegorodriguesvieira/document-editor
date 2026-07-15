import { useEffect } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature, getCommentsStorage } from './comments'
import { CommentsPanel } from './commentsPanel'
import {
  CommentsProvider,
  useComments,
  type CommentDraft,
  type CommentsAdapter,
  type CommentUser,
  type DocumentComment,
} from './commentsProvider'

const ANA: CommentUser = { id: 'u-ana', name: 'Ana Lima' }
const BETO: CommentUser = { id: 'u-beto', name: 'Beto Souza' }

const saved = (
  id: string,
  author: CommentUser,
  text: string,
  over: Partial<DocumentComment> = {},
): DocumentComment => ({
  id,
  from: 1,
  to: 6,
  quote: 'hello',
  text,
  author,
  createdAt: '2026-07-15T12:00:00Z',
  ...over,
})

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

/** Stands in for the balloon: captures `draft` once, on mount. */
function CaptureDraft({ draft }: { draft: CommentDraft }) {
  const context = useComments()
  useEffect(() => {
    context?.setDraft(draft)
    // deliberate once-only capture — exactly what the balloon click does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function renderPanel({
  adapter = fakeAdapter(),
  user = ANA as CommentUser | undefined,
  editor = null as Editor | null,
  draft = null as CommentDraft | null,
} = {}) {
  render(
    <CommentsProvider user={user} adapter={adapter}>
      {draft ? <CaptureDraft draft={draft} /> : null}
      <CommentsPanel editor={editor} />
    </CommentsProvider>,
  )
  return adapter
}

const DRAFT: CommentDraft = { from: 1, to: 6, quote: 'hello' }

describe('<CommentsPanel />', () => {
  it('renders nothing outside a CommentsProvider', () => {
    const { container } = render(<CommentsPanel editor={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing while there is neither a draft nor any comment', async () => {
    const adapter = renderPanel()
    await waitFor(() => expect(adapter.list).toHaveBeenCalled())
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
  })

  it('lists fetched comments as avatar + author + text — and NO quote', async () => {
    renderPanel({ adapter: fakeAdapter([saved('c-1', BETO, 'tighten the wording')]) })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByText('Beto Souza')).toBeInTheDocument()
    expect(within(panel).getByText('tighten the wording')).toBeInTheDocument()
    expect(within(panel).getByText('BS')).toBeInTheDocument() // initials avatar
    expect(within(panel).queryByText(/hello/)).toBeNull() // the quote stays out
  })

  it('composer: actions appear once there is text; Comment sends the draft and the refetched card lands', async () => {
    const adapter = fakeAdapter()
    renderPanel({ adapter, draft: DRAFT })

    const field = await screen.findByRole('textbox', { name: 'Comment text' })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull() // nothing typed yet

    await userEvent.type(field, 'needs a source')
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(adapter.add).toHaveBeenCalledWith({ text: 'needs a source', ...DRAFT })
    // Refetch-after-write: the composer closes, then the SERVER's copy lands
    // as a card (composer first — the textarea's own content would satisfy a
    // bare text query mid-save).
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
    expect(await screen.findByText('needs a source')).toBeInTheDocument()
  })

  it('keyboard contract: Shift+Enter breaks the line, Escape cancels without sending', async () => {
    const adapter = fakeAdapter()
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'linha um{Shift>}{Enter}{/Shift}linha dois')
    expect(adapter.add).not.toHaveBeenCalled() // Shift+Enter only broke the line
    expect(field).toHaveValue('linha um\nlinha dois')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
    expect(adapter.add).not.toHaveBeenCalled()
  })

  it('Enter (without shift) submits', async () => {
    const adapter = fakeAdapter()
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'direto no enter{Enter}')

    await waitFor(() =>
      expect(adapter.add).toHaveBeenCalledWith({ text: 'direto no enter', ...DRAFT }),
    )
  })

  it('the 3-dots menu exists ONLY on the current user’s own comments', async () => {
    renderPanel({
      adapter: fakeAdapter([saved('c-1', ANA, 'meu'), saved('c-2', BETO, 'do beto')]),
    })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('meu')
    const menus = within(panel).getAllByRole('button', { name: 'Comment actions' })
    expect(menus).toHaveLength(1)
    const mine = within(panel).getByText('meu').closest('li') as HTMLElement
    expect(within(mine).getByRole('button', { name: 'Comment actions' })).toBeInTheDocument()
  })

  it('without a user (anonymous review) no comment offers Delete', async () => {
    // No `user` prop at all — the destructured default in renderPanel would
    // swallow an explicit undefined, so mount the provider directly.
    render(
      <CommentsProvider adapter={fakeAdapter([saved('c-1', ANA, 'de alguém')])}>
        <CommentsPanel editor={null} />
      </CommentsProvider>,
    )
    await screen.findByText('de alguém')
    expect(screen.queryByRole('button', { name: 'Comment actions' })).toBeNull()
  })

  it('Delete calls the adapter and the card leaves after the refetch', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'apagável')])
    renderPanel({ adapter })
    await screen.findByText('apagável')

    await userEvent.click(screen.getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(adapter.remove).toHaveBeenCalledWith('c-1')
    await waitFor(() => expect(screen.queryByText('apagável')).toBeNull())
  })

  it('clicking a card jumps the document to the range (collapsed caret) and lights comment--active', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    const comment = saved('c-1', BETO, 'olha isso', { from: 7, to: 12, quote: 'world' })
    // The layer normally syncs provider → storage; this test wires the storage
    // directly and exercises only the panel's side of the contract.
    const storage = getCommentsStorage(created.editor)!
    storage.comments = [comment]
    // jsdom ships no scrollIntoView — define it to pin the DOM-scroll path
    // (PM's own scrollIntoView is a no-op while focus sits in the panel).
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy

    renderPanel({ adapter: fakeAdapter([comment]), editor: created.editor })
    await userEvent.click(await screen.findByText('olha isso'))

    expect(created.editor.state.selection.from).toBe(7)
    expect(created.editor.state.selection.empty).toBe(true) // collapsed — no balloon
    // The HIGHLIGHT SPAN inside the document was scrolled into view — NOT
    // PM's scrollIntoView, which silently bails while the DOM focus sits in
    // the panel (the regression this pins: the click must scroll the doc).
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    const span = created.editor.view.dom.querySelector('[data-comment-id="c-1"]')
    expect(scrollSpy.mock.contexts).toContain(span)
    // The card itself lights up too (the active state is shared both ways).
    expect(screen.getByText('olha isso').closest('li')).toHaveClass(
      'comments-panel__card--active',
    )
    // Mirror activeId into storage the way the layer would, then re-render.
    storage.activeId = 'c-1'
    created.editor.view.dispatch(created.editor.state.tr.setMeta('addToHistory', false))
    expect(created.editor.view.dom.querySelector('span.comment--active')?.textContent).toBe('world')
  })

  it('a failed add keeps the composer (text intact) and shows the error', async () => {
    const adapter = fakeAdapter()
    adapter.add.mockRejectedValueOnce(new Error('comments service down'))
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'não perde isso{Enter}')

    expect(await screen.findByText('comments service down')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Comment text' })).toHaveValue('não perde isso')
  })
})
