import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature, getCommentsStorage } from './comments'
import { applyCommentAnchor } from './commentAnchors'
import { CommentsPanel } from './commentsPanel'
import {
  CommentsProvider,
  useComments,
  type CommentDraft,
  type CommentsAdapter,
  type CommentStatus,
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
  quote: 'hello',
  text,
  author,
  createdAt: '2026-07-15T12:00:00Z',
  status: 'open',
  canEdit: true,
  canReply: true,
  canDelete: true,
  canResolve: false,
  canArchive: false,
  replies: [],
  ...over,
})

function fakeAdapter(initial: DocumentComment[] = []) {
  let db = [...initial]
  return {
    list: vi.fn(async () => db.map((comment) => ({ ...comment }))),
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

  it('composer: Comment sends the draft TEXT and anchors the backend id over the draft range', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    const adapter = fakeAdapter()
    renderPanel({ adapter, editor: created.editor, draft: DRAFT })

    const field = await screen.findByRole('textbox', { name: 'Comment text' })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull() // nothing typed yet

    await userEvent.type(field, 'needs a source')
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))

    // The anchor stays OUT of the payload — the doc will carry it as a mark.
    expect(adapter.add).toHaveBeenCalledWith({ text: 'needs a source', quote: 'hello' })
    // Refetch-after-write: the composer closes, then the SERVER's copy lands
    // as a card (composer first — the textarea's own content would satisfy a
    // bare text query mid-save).
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
    expect(await screen.findByText('needs a source')).toBeInTheDocument()
    // The draft range became the mark, under the id the BACKEND minted.
    const span = created.editor.view.dom.querySelector('span.comment[data-comment-id="c-1"]')
    expect(span?.textContent).toBe('hello')
  })

  it('keyboard contract: Shift+Enter breaks the line, Escape cancels without sending', async () => {
    const adapter = fakeAdapter()
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(adapter.add).not.toHaveBeenCalled() // Shift+Enter only broke the line
    expect(field).toHaveValue('line one\nline two')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
    expect(adapter.add).not.toHaveBeenCalled()
  })

  it('Enter (without shift) submits', async () => {
    const adapter = fakeAdapter()
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'straight to enter{Enter}')

    await waitFor(() =>
      expect(adapter.add).toHaveBeenCalledWith({ text: 'straight to enter', quote: 'hello' }),
    )
  })

  it('a mousedown anywhere outside the panel cancels the draft — nothing sent, selection collapsed', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    const adapter = fakeAdapter()
    renderPanel({ adapter, editor: created.editor, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })
    // Typed text does not arm a guard: clicking away discards it, exactly
    // like Escape already does.
    await userEvent.type(field, 'typed halfway')

    fireEvent.mouseDown(document.body)

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
    expect(adapter.add).not.toHaveBeenCalled()
    // The captured range collapses to the draft's end — a still-live
    // selection would summon the "Add comment" balloon right back.
    expect(created.editor.state.selection.empty).toBe(true)
    expect(created.editor.state.selection.from).toBe(6)
  })

  it('a mousedown INSIDE the panel (reading cards mid-draft) keeps the composer', async () => {
    renderPanel({ adapter: fakeAdapter([saved('c-1', BETO, 'from beto')]), draft: DRAFT })
    await screen.findByRole('textbox', { name: 'Comment text' })

    fireEvent.mouseDown(await screen.findByText('from beto'))

    expect(screen.getByRole('textbox', { name: 'Comment text' })).toBeInTheDocument()
  })

  it('dismissing the card menu (backdrop mousedown, Escape) does not throw the draft away', async () => {
    renderPanel({ adapter: fakeAdapter([saved('c-1', ANA, 'mine')]), draft: DRAFT })
    await screen.findByRole('textbox', { name: 'Comment text' })
    await userEvent.click(await screen.findByRole('button', { name: 'Comment actions' }))
    await screen.findByRole('menuitem', { name: 'Delete' })

    // A click-away while the MODAL menu is open lands on its backdrop — that
    // gesture belongs to the menu, not to the composer's outside-click rule.
    // (Placeholder query: the open modal aria-hides the panel, so role
    // queries can't see the field even though it is alive and well.)
    fireEvent.mouseDown(document.querySelector('.MuiBackdrop-root')!)
    expect(screen.getByPlaceholderText('Add a comment…')).toBeInTheDocument()

    // Escape closes surfaces innermost-first: the MENU goes, the draft stays.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Comment text' })).toBeInTheDocument()
  })

  it('actions come from the BACKEND flags — authorship is irrelevant', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', ANA, 'mine, all allowed'),
        saved('c-2', BETO, 'not mine, nothing', { canEdit: false, canDelete: false }),
        saved('c-3', BETO, 'not mine, delete only', { canEdit: false, canDelete: true }),
      ]),
    })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('mine, all allowed')
    const cardOf = (text: string) => within(panel).getByText(text).closest('li') as HTMLElement

    // All flags true → menu with Edit + Delete.
    await userEvent.click(
      within(cardOf('mine, all allowed')).getByRole('button', { name: 'Comment actions' }),
    )
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull())

    // No flags → no menu at all (no dead 3-dots).
    expect(
      within(cardOf('not mine, nothing')).queryByRole('button', { name: 'Comment actions' }),
    ).toBeNull()

    // SOMEONE ELSE's comment with canDelete → Delete-only menu: the backend
    // grants, the client never infers from author identity.
    await userEvent.click(
      within(cardOf('not mine, delete only')).getByRole('button', { name: 'Comment actions' }),
    )
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
  })

  it('without a user (anonymous review) flags still drive the menu — identity is the backend’s', async () => {
    // No `user` prop at all — the destructured default in renderPanel would
    // swallow an explicit undefined, so mount the provider directly.
    render(
      <CommentsProvider
        adapter={fakeAdapter([saved('c-1', ANA, 'from someone else', { canEdit: false, canDelete: true })])}
      >
        <CommentsPanel editor={null} />
      </CommentsProvider>,
    )
    await screen.findByText('from someone else')
    expect(screen.getByRole('button', { name: 'Comment actions' })).toBeInTheDocument()
  })

  it('Delete calls the adapter and the card leaves after the refetch', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'deletable')])
    renderPanel({ adapter })
    await screen.findByText('deletable')

    await userEvent.click(screen.getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))

    expect(adapter.remove).toHaveBeenCalledWith('c-1')
    await waitFor(() => expect(screen.queryByText('deletable')).toBeNull())
  })

  it('clicking a card jumps the document to the MARK (collapsed caret) and lights comment--active', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)
    applyCommentAnchor(created.editor, 'c-1', { from: 7, to: 12 })
    const comment = saved('c-1', BETO, 'look at this', { quote: 'world' })
    // jsdom ships no scrollIntoView — define it to pin the DOM-scroll path
    // (PM's own scrollIntoView is a no-op while focus sits in the panel).
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy

    renderPanel({ adapter: fakeAdapter([comment]), editor: created.editor })
    await userEvent.click(await screen.findByText('look at this'))

    // The caret landed at the mark's start — derived from the DOC, the panel
    // knows no positions of its own anymore.
    expect(created.editor.state.selection.from).toBe(7)
    expect(created.editor.state.selection.empty).toBe(true) // collapsed — no balloon
    // The HIGHLIGHT SPAN inside the document was scrolled into view — NOT
    // PM's scrollIntoView, which silently bails while the DOM focus sits in
    // the panel (the regression this pins: the click must scroll the doc).
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    const span = created.editor.view.dom.querySelector('[data-comment-id="c-1"]')
    expect(scrollSpy.mock.contexts).toContain(span)
    // The card itself lights up too (the active state is shared both ways).
    expect(screen.getByText('look at this').closest('li')).toHaveClass(
      'comments-panel__card--active',
    )
    // Mirror activeId into storage the way the layer would, then re-render.
    const storage = getCommentsStorage(created.editor)!
    storage.activeId = 'c-1'
    created.editor.view.dispatch(created.editor.state.tr.setMeta('addToHistory', false))
    expect(created.editor.view.dom.querySelector('span.comment--active')?.textContent).toBe('world')
  })

  it('a comment whose mark is GONE from the doc shows as orphaned: quote + hint, no jump, Delete kept', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    const adapter = fakeAdapter([saved('c-1', ANA, 'left orphaned')])

    renderPanel({ adapter, editor: created.editor })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('left orphaned')).closest('li') as HTMLElement
    expect(within(card).getByText('“hello”')).toBeInTheDocument()
    expect(within(card).getByText('Original text was removed')).toBeInTheDocument()
    // The body is inert (no jump ButtonBase) — what remains is Reply (the
    // thread outlives the anchored text) and the menu.
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
      // Corner first: keyboard order matches the visual top-right placement.
    ).toEqual(['Comment actions', 'Reply'])

    await userEvent.click(within(card).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))
    expect(adapter.remove).toHaveBeenCalledWith('c-1')
  })

  it('works in EDIT mode: anchored cards render live (not orphaned) and Delete still works', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    expect(created.editor.isEditable).toBe(true)
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    const adapter = fakeAdapter([saved('c-1', ANA, 'in edit mode')])

    renderPanel({ adapter, editor: created.editor })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('in edit mode')).closest('li') as HTMLElement
    // Anchored → a live card: jump body + Reply + menu, no orphan hint.
    expect(within(card).queryByText('Original text was removed')).toBeNull()
    expect(within(card).getAllByRole('button')).toHaveLength(3)

    await userEvent.click(within(card).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))
    expect(adapter.remove).toHaveBeenCalledWith('c-1')
    await waitFor(() => expect(screen.queryByText('in edit mode')).toBeNull())
  })

  it('a failed add keeps the composer (text intact) and shows the error', async () => {
    const adapter = fakeAdapter()
    adapter.add.mockRejectedValueOnce(new Error('comments service down'))
    renderPanel({ adapter, draft: DRAFT })
    const field = await screen.findByRole('textbox', { name: 'Comment text' })

    await userEvent.type(field, 'do not lose this{Enter}')

    // The failure shows twice on purpose: the alert banner AND the field's
    // helperText (error at the point of action).
    expect(await screen.findAllByText('comments service down')).not.toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('comments service down')
    expect(screen.getByRole('textbox', { name: 'Comment text' })).toHaveValue('do not lose this')
  })
})

describe('<CommentsPanel /> replies', () => {
  it('renders the thread: seeded replies under the parent card, and NO reply-to-reply affordance', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'parent comment', {
          replies: [
            {
              id: 'r-1',
              text: 'reply from ana',
              author: ANA,
              createdAt: 'now',
              canEdit: true,
              canDelete: true,
            },
          ],
        }),
      ]),
    })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('parent comment')).closest('li') as HTMLElement
    const row = within(card).getByText('reply from ana').closest('li') as HTMLElement
    expect(within(row).getByText('Ana Lima')).toBeInTheDocument()
    // One level only: the ROW offers no Reply button (only the card does).
    expect(within(row).queryByRole('button', { name: 'Reply' })).toBeNull()
    // The title keeps counting THREADS, not messages.
    expect(within(panel).getByText('Comments (1)')).toBeInTheDocument()
  })

  it('the Reply button exists only when the backend granted canReply', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'can reply'),
        saved('c-2', BETO, 'cannot reply', { canReply: false }),
      ]),
    })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('can reply')
    const cardOf = (text: string) => within(panel).getByText(text).closest('li') as HTMLElement
    expect(within(cardOf('can reply')).getByRole('button', { name: 'Reply' })).toBeInTheDocument()
    expect(within(cardOf('cannot reply')).queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('reply flow: Reply → focused field → Enter sends → refetched row lands, composer closes', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'parent comment')])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('parent comment')

    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    const field = await screen.findByRole('textbox', { name: 'Reply text' })
    expect(field).toHaveFocus()
    await userEvent.type(field, 'agreed{Enter}')

    expect(adapter.reply).toHaveBeenCalledWith('c-1', { text: 'agreed' })
    // Refetch-after-write: the composer closes, the SERVER's reply lands.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Reply text' })).toBeNull())
    expect(await within(panel).findByText('agreed')).toBeInTheDocument()
  })

  it('an outside mousedown does NOT discard a reply in progress (unlike the draft composer)', async () => {
    renderPanel({ adapter: fakeAdapter([saved('c-1', BETO, 'parent')]) })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('parent')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    const field = await screen.findByRole('textbox', { name: 'Reply text' })
    await userEvent.type(field, 'half a reply')

    fireEvent.mouseDown(document.body)

    expect(screen.getByRole('textbox', { name: 'Reply text' })).toHaveValue('half a reply')
  })

  it('Escape closes surfaces innermost-first: the reply composer goes, the DRAFT survives', async () => {
    renderPanel({ adapter: fakeAdapter([saved('c-1', BETO, 'parent')]), draft: DRAFT })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await screen.findByRole('textbox', { name: 'Comment text' })
    await within(panel).findByText('parent')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    await screen.findByRole('textbox', { name: 'Reply text' })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Reply text' })).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Comment text' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull())
  })

  it('an ORPHANED comment still accepts replies — the thread outlives the anchored text', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    const adapter = fakeAdapter([saved('c-1', ANA, 'left orphaned')])
    renderPanel({ adapter, editor: created.editor })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('Original text was removed')

    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Reply text' }), 'still alive{Enter}')

    expect(adapter.reply).toHaveBeenCalledWith('c-1', { text: 'still alive' })
    expect(await within(panel).findByText('still alive')).toBeInTheDocument()
  })

  it('replying works with an EDITABLE editor — replies are not review-only', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    expect(created.editor.isEditable).toBe(true)
    applyCommentAnchor(created.editor, 'c-1', { from: 1, to: 6 })
    const adapter = fakeAdapter([saved('c-1', BETO, 'in edit mode')])
    renderPanel({ adapter, editor: created.editor })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('in edit mode')

    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Reply text' }), 'editing and replying{Enter}')

    expect(adapter.reply).toHaveBeenCalledWith('c-1', { text: 'editing and replying' })
    expect(await within(panel).findByText('editing and replying')).toBeInTheDocument()
  })

  it('reply rows carry their OWN flag-driven menu: Edit and Delete hit the reply id', async () => {
    const adapter = fakeAdapter([
      saved('c-1', BETO, 'parent', {
        replies: [
          { id: 'r-1', text: 'my reply', author: ANA, createdAt: 'now', canEdit: true, canDelete: true },
          { id: 'r-2', text: 'locked reply', author: BETO, createdAt: 'now', canEdit: false, canDelete: false },
        ],
      }),
    ])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('my reply')
    const rowOf = (text: string) => within(panel).getByText(text).closest('li') as HTMLElement

    // Flags all false → no menu on that row.
    expect(within(rowOf('locked reply')).queryByRole('button', { name: 'Reply actions' })).toBeNull()

    // Edit: prefilled field → Save → adapter.update with the REPLY id.
    await userEvent.click(within(rowOf('my reply')).getByRole('button', { name: 'Reply actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const field = await screen.findByRole('textbox', { name: 'Edit text' })
    expect(field).toHaveValue('my reply')
    await userEvent.clear(field)
    await userEvent.type(field, 'revised reply')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(adapter.update).toHaveBeenCalledWith('r-1', { text: 'revised reply' })
    expect(await within(panel).findByText('revised reply')).toBeInTheDocument()

    // Delete hits the reply id and the row leaves after the refetch.
    await userEvent.click(within(rowOf('revised reply')).getByRole('button', { name: 'Reply actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))
    expect(adapter.remove).toHaveBeenCalledWith('r-1')
    await waitFor(() => expect(within(panel).queryByText('revised reply')).toBeNull())
  })
})

/** Probe: buttons that drive provider state from OUTSIDE the panel, the way
 *  the balloon (draft) and the kernel's highlight click (activeId) do. */
function StateProbe({ draft }: { draft: CommentDraft }) {
  const context = useComments()
  return (
    <>
      <button onClick={() => context?.setDraft(draft)}>probe-capture</button>
      <button onClick={() => context?.setActiveId('c-1')}>probe-activate</button>
    </>
  )
}

describe('<CommentsPanel /> status tabs', () => {
  it('renders the three tabs — the first counts OPEN threads only and starts selected', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'open thread'),
        saved('c-2', BETO, 'resolved thread', { status: 'resolved' }),
        saved('c-3', BETO, 'archived thread', { status: 'archived' }),
      ]),
    })

    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const openTab = within(panel).getByRole('tab', { name: 'Comments (1)' })
    expect(openTab).toHaveAttribute('aria-selected', 'true')
    expect(within(panel).getByRole('tab', { name: 'Resolved' })).toBeInTheDocument()
    expect(within(panel).getByRole('tab', { name: 'Archived' })).toBeInTheDocument()
    // Only the OPEN thread shows on the default tab.
    expect(within(panel).getByText('open thread')).toBeInTheDocument()
    expect(within(panel).queryByText('resolved thread')).toBeNull()
    expect(within(panel).queryByText('archived thread')).toBeNull()
  })

  it('tabs filter by status; an empty tab shows its hint', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'open thread'),
        saved('c-2', BETO, 'resolved thread', { status: 'resolved' }),
      ]),
    })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('open thread')

    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    expect(within(panel).getByText('resolved thread')).toBeInTheDocument()
    expect(within(panel).queryByText('open thread')).toBeNull()

    await userEvent.click(within(panel).getByRole('tab', { name: 'Archived' }))
    expect(within(panel).getByText('No archived comments')).toBeInTheDocument()
  })

  it('the ✓ Resolve button exists only when the backend granted canResolve', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'resolvable', { canResolve: true }),
        saved('c-2', BETO, 'not resolvable'),
      ]),
    })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('resolvable')
    const cardOf = (text: string) => within(panel).getByText(text).closest('li') as HTMLElement

    expect(within(cardOf('resolvable')).getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
    expect(within(cardOf('not resolvable')).queryByRole('button', { name: 'Resolve' })).toBeNull()
  })

  it('resolve flow: ✓ → setStatus → the card leaves the open tab and lands FROZEN in Resolved', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'resolvable', { canResolve: true })])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('resolvable')

    await userEvent.click(within(panel).getByRole('button', { name: 'Resolve' }))

    expect(adapter.setStatus).toHaveBeenCalledWith('c-1', { status: 'resolved' })
    // Refetch-after-write: the open tab empties (bare label + hint)…
    await waitFor(() => expect(within(panel).queryByText('resolvable')).toBeNull())
    expect(within(panel).getByRole('tab', { name: 'Comments' })).toBeInTheDocument()
    expect(within(panel).getByText('No open comments')).toBeInTheDocument()

    // …and the thread lives on the Resolved tab: frozen body with the quote.
    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    const card = within(panel).getByText('resolvable').closest('li') as HTMLElement
    expect(within(card).getByText('“hello”')).toBeInTheDocument()
    expect(card.querySelector('.comments-panel__card-body')?.tagName).toBe('DIV') // no jump
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('archive flow: 3-dots → Archive → the card lands in Archived', async () => {
    const adapter = fakeAdapter([
      saved('c-1', BETO, 'archivable', { canEdit: false, canDelete: false, canArchive: true }),
    ])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('archivable')

    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    expect(adapter.setStatus).toHaveBeenCalledWith('c-1', { status: 'archived' })
    await waitFor(() => expect(within(panel).queryByText('archivable')).toBeNull())
    await userEvent.click(within(panel).getByRole('tab', { name: 'Archived' }))
    expect(within(panel).getByText('archivable')).toBeInTheDocument()
  })

  it('frozen threads are read-only + Delete: no reply/edit/resolve, plain reply rows', async () => {
    const adapter = fakeAdapter([
      saved('c-1', BETO, 'frozen', {
        status: 'resolved',
        canResolve: true, // must NOT surface a Resolve button while frozen
        canEdit: true, // must NOT surface Edit either
        canDelete: true,
        replies: [
          { id: 'r-1', text: 'frozen reply', author: ANA, createdAt: 'now', canEdit: true, canDelete: true },
        ],
      }),
    ])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    const card = (await within(panel).findByText('frozen')).closest('li') as HTMLElement

    expect(within(card).getByText('frozen reply')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Reply' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Reply actions' })).toBeNull()

    // The menu carries ONLY Delete — and it still works.
    await userEvent.click(within(card).getByRole('button', { name: 'Comment actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))
    expect(adapter.remove).toHaveBeenCalledWith('c-1')
    // Screen-level: deleting the LAST comment unmounts the whole panel, and
    // a within() query would still see the detached node's children.
    await waitFor(() => expect(screen.queryByText('frozen')).toBeNull())
  })

  it('capturing a draft flips back to the Comments tab, composer visible', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'open thread')])
    render(
      <CommentsProvider user={ANA} adapter={adapter}>
        <StateProbe draft={DRAFT} />
        <CommentsPanel editor={null} />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('open thread')
    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    expect(within(panel).queryByText('open thread')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'probe-capture' }))

    expect(within(panel).getByRole('tab', { name: 'Comments (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(panel).getByRole('textbox', { name: 'Comment text' })).toBeInTheDocument()
  })

  it('an activated highlight (activeId) flips back to the Comments tab', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'open thread')])
    render(
      <CommentsProvider user={ANA} adapter={adapter}>
        <StateProbe draft={DRAFT} />
        <CommentsPanel editor={null} />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('open thread')
    await userEvent.click(within(panel).getByRole('tab', { name: 'Archived' }))

    await userEvent.click(screen.getByRole('button', { name: 'probe-activate' }))

    expect(within(panel).getByRole('tab', { name: 'Comments (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(panel).getByText('open thread')).toBeInTheDocument()
  })

  it('the whole corner (Resolve + 3-dots) hides while editing', async () => {
    renderPanel({
      adapter: fakeAdapter([saved('c-1', ANA, 'mid-edit', { canResolve: true })]),
    })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('mid-edit')).closest('li') as HTMLElement
    expect(within(card).getByRole('button', { name: 'Resolve' })).toBeInTheDocument()

    await userEvent.click(within(card).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    await screen.findByRole('textbox', { name: 'Edit text' })
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Comment actions' })).toBeNull()
  })
})

describe('<CommentsPanel /> review-round hardening', () => {
  it('a failed INITIAL fetch is not a silent nothing — the panel shows the error', async () => {
    const adapter = fakeAdapter()
    adapter.list.mockRejectedValueOnce(new Error('comments backend offline'))
    renderPanel({ adapter })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('comments backend offline')
  })

  it('a pending mutation disables the corner and never double-hits the API', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'pending', { canResolve: true })])
    adapter.setStatus.mockImplementation(() => new Promise(() => {})) // never lands
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const resolveButton = within(panel).getByRole('button', { name: 'Resolve' })

    await userEvent.click(resolveButton)
    await waitFor(() => expect(resolveButton).toBeDisabled())
    // A spinner replaces the check while the request is in flight.
    expect(within(panel).getByRole('progressbar')).toBeInTheDocument()
    // The double-click a real user WILL do:
    fireEvent.click(resolveButton)
    expect(adapter.setStatus).toHaveBeenCalledTimes(1)
  })

  it('after Resolve the focus lands on the panel, never on <body>', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'resolvable', { canResolve: true })])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })

    await userEvent.click(within(panel).getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(within(panel).queryByText('resolvable')).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
    expect(panel.contains(document.activeElement)).toBe(true)
  })

  it('mutation outcomes are ANNOUNCED to assistive tech', async () => {
    const adapter = fakeAdapter([saved('c-1', BETO, 'resolvable', { canResolve: true })])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })

    await userEvent.click(within(panel).getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(within(panel).getByRole('status')).toHaveTextContent('Comment resolved'),
    )
  })

  it('Delete confirms in place — closing the menu resets the armed state', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'kept')])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('kept')

    // First click only ARMS the confirmation — nothing deleted.
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(adapter.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Confirm delete?' })).toBeInTheDocument()

    // Closing the menu disarms it: the next open shows plain Delete again.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Confirm delete?' })).toBeNull())
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()

    // Armed + confirmed → deleted.
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Confirm delete?' }))
    expect(adapter.remove).toHaveBeenCalledWith('c-1')
  })

  it('cards and replies render a relative <time> from createdAt', async () => {
    renderPanel({
      adapter: fakeAdapter([
        saved('c-1', BETO, 'with time', {
          replies: [
            {
              id: 'r-1',
              text: 'reply with time',
              author: ANA,
              createdAt: '2026-07-20T12:00:00Z',
              canEdit: false,
              canDelete: false,
            },
          ],
        }),
      ]),
    })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('with time')).closest('li') as HTMLElement

    const times = card.querySelectorAll('time')
    expect(times).toHaveLength(2) // card + reply
    expect(times[0].getAttribute('datetime')).toBe('2026-07-15T12:00:00Z')
    expect(times[0].textContent).not.toBe('')
  })

  it('the labels prop relabels the UI — the i18n seam', async () => {
    render(
      <CommentsProvider
        user={ANA}
        adapter={fakeAdapter([saved('c-1', BETO, 'relabeled')])}
        labels={{ reply: 'Write back', tabOpen: 'Notes', emptyOpen: 'No notes' }}
      >
        <CommentsPanel editor={null} />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByRole('tab', { name: 'Notes (1)' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Write back' })).toBeInTheDocument()
  })

  it('Escape closes the FOCUSED composer, not the most recent one', async () => {
    const adapter = fakeAdapter([
      saved('c-a', BETO, 'card A'),
      saved('c-b', ANA, 'card B'),
    ])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const cardOf = (text: string) => within(panel).getByText(text).closest('li') as HTMLElement
    await within(panel).findByText('card A')

    // Open A's reply composer FIRST, then B's edit — B tops the stack.
    await userEvent.click(within(cardOf('card A')).getByRole('button', { name: 'Reply' }))
    const replyField = await screen.findByRole('textbox', { name: 'Reply text' })
    await userEvent.type(replyField, 'do not drop me')
    await userEvent.click(within(cardOf('card B')).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editField = await screen.findByRole('textbox', { name: 'Edit text' })
    await userEvent.type(editField, ' with a pending edit')

    // Focus back in A's reply field; Escape must close A — B's typed edit
    // survives (the stack alone would kill B, the newest surface).
    await userEvent.click(replyField)
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Reply text' })).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Edit text' })).toHaveValue(
      'card B with a pending edit',
    )
  })

  it('reconciliation runs with the PANEL alone — no CommentsLayer required', async () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    applyCommentAnchor(created.editor, 'c-ghost', { from: 1, to: 6 })
    const adapter = fakeAdapter([saved('c-1', BETO, 'known')])

    // ONLY the panel mounted — the bridge inside it must still strip.
    renderPanel({ adapter, editor: created.editor })

    await waitFor(() =>
      expect(created.editor.view.dom.querySelector('[data-comment-id="c-ghost"]')).toBeNull(),
    )
  })
})

describe('<CommentsPanel /> consumer menu items', () => {
  it('custom items land BETWEEN the built-ins and Delete, and fire with the comment', async () => {
    const onCopy = vi.fn()
    render(
      <CommentsProvider user={ANA} adapter={fakeAdapter([saved('c-1', ANA, 'extensible')])}>
        <CommentsPanel
          editor={null}
          commentMenuItems={(comment) => [
            { label: 'Copy link', onClick: () => onCopy(comment.id) },
          ]}
        />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('extensible')

    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    const menuItems = await screen.findAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['Edit', 'Copy link', 'Delete'])

    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    expect(onCopy).toHaveBeenCalledWith('c-1')
  })

  it('a custom item can opt into the 2-step confirm', async () => {
    const onReport = vi.fn()
    render(
      <CommentsProvider user={ANA} adapter={fakeAdapter([saved('c-1', ANA, 'reportable')])}>
        <CommentsPanel
          editor={null}
          commentMenuItems={() => [
            { label: 'Report', confirmLabel: 'Confirm report?', onClick: onReport },
          ]}
        />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('reportable')
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))

    await userEvent.click(await screen.findByRole('menuitem', { name: 'Report' }))
    expect(onReport).not.toHaveBeenCalled() // armed only
    await userEvent.click(screen.getByRole('menuitem', { name: 'Confirm report?' }))
    expect(onReport).toHaveBeenCalledTimes(1)
  })

  it('flags all false + custom items → the menu still renders, custom-only', async () => {
    render(
      <CommentsProvider
        user={ANA}
        adapter={fakeAdapter([
          saved('c-1', BETO, 'no flags', { canEdit: false, canDelete: false }),
        ])}
      >
        <CommentsPanel editor={null} commentMenuItems={() => [{ label: 'Pin', onClick: vi.fn() }]} />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('no flags')

    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    const menuItems = await screen.findAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['Pin'])
  })

  it('reply items receive the reply AND its parent; frozen rows only carry consumer items', async () => {
    const seen: Array<[string, string]> = []
    render(
      <CommentsProvider
        user={ANA}
        adapter={fakeAdapter([
          saved('c-1', BETO, 'frozen thread', {
            status: 'resolved',
            replies: [
              {
                id: 'r-1',
                text: 'frozen reply',
                author: ANA,
                createdAt: 'now',
                canEdit: true, // frozen: built-ins stay out regardless
                canDelete: true,
              },
            ],
          }),
        ])}
      >
        <CommentsPanel
          editor={null}
          replyMenuItems={(reply, comment) => {
            seen.push([reply.id, comment.id])
            return [{ label: 'Quote reply', onClick: vi.fn() }]
          }}
        />
      </CommentsProvider>,
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    const row = (await within(panel).findByText('frozen reply')).closest('li') as HTMLElement

    expect(seen).toContainEqual(['r-1', 'c-1'])
    // Frozen row: no built-in Edit/Delete — the consumer's item alone.
    await userEvent.click(within(row).getByRole('button', { name: 'Reply actions' }))
    const menuItems = await screen.findAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['Quote reply'])
  })
})

describe('<CommentsPanel /> edit-in-place', () => {
  it('edit flow: menu → Edit → prefilled field, inert body, no 3-dots → Save persists', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'original text')])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('original text')).closest('li') as HTMLElement

    await userEvent.click(within(card).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const field = await screen.findByRole('textbox', { name: 'Edit text' })
    expect(field).toHaveValue('original text')
    expect(field).toHaveFocus() // disableRestoreFocus: the menu must not steal it back
    // While editing: the body is inert (no jump ButtonBase) and the 3-dots hides.
    expect(card.querySelector('.comments-panel__card-body')?.tagName).toBe('DIV')
    expect(within(card).queryByRole('button', { name: 'Comment actions' })).toBeNull()

    await userEvent.clear(field)
    await userEvent.type(field, 'improved text')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(adapter.update).toHaveBeenCalledWith('c-1', { text: 'improved text' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit text' })).toBeNull())
    expect(await within(panel).findByText('improved text')).toBeInTheDocument()
  })

  it('Escape cancels the edit without saving', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'unchanged')])
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('unchanged')
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const field = await screen.findByRole('textbox', { name: 'Edit text' })
    await userEvent.clear(field)
    await userEvent.type(field, 'abandoned change')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit text' })).toBeNull())
    expect(adapter.update).not.toHaveBeenCalled()
    expect(within(panel).getByText('unchanged')).toBeInTheDocument()
  })

  it('a failed save keeps the edit field (text intact) and shows the error', async () => {
    const adapter = fakeAdapter([saved('c-1', ANA, 'original')])
    adapter.update.mockRejectedValueOnce(new Error('PATCH exploded'))
    renderPanel({ adapter })
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('original')
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const field = await screen.findByRole('textbox', { name: 'Edit text' })
    await userEvent.clear(field)
    await userEvent.type(field, 'attempt{Enter}')

    expect(await screen.findAllByText('PATCH exploded')).not.toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Edit text' })).toHaveValue('attempt')
  })
})
