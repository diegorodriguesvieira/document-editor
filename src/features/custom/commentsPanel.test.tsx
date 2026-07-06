import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BoldFeature } from '../../features'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature } from './comments'
import { CommentsPanel } from './commentsPanel'

describe('<CommentsPanel />', () => {
  it('lists comments anchored in the doc and scrolls to one on click', async () => {
    const user = userEvent.setup()
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.commands.setTextSelection({ from: 1, to: 6 }) // "hello"
    created.api.exec('comment.add', { text: 'fix this' })

    render(<CommentsPanel editor={created.editor} />)
    // Scope to the panel — the editor's own "hello world" text is also in the DOM.
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByText('fix this')).toBeInTheDocument()
    expect(within(panel).getByText(/hello/)).toBeInTheDocument()

    // Move the caret away, then clicking the item re-selects the comment range.
    created.editor.commands.setTextSelection(11)
    await user.click(within(panel).getByRole('button', { name: /fix this/ }))
    expect(created.editor.state.selection.from).toBe(1)
    expect(created.editor.state.selection.to).toBe(6)
  })

  it('renders NOTHING while there are no comments — and appears with the first one', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    const { container } = render(<CommentsPanel editor={created.editor} />)
    expect(container).toBeEmptyDOMElement()

    // The first anchored comment brings the panel in, reactively.
    act(() => {
      created.editor.commands.setTextSelection({ from: 1, to: 6 })
      created.api.exec('comment.add', { text: 'primeira' })
    })
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeInTheDocument()

    // Deleting the anchored text removes the last comment → panel leaves.
    act(() => {
      created.editor.commands.setTextSelection({ from: 1, to: 6 })
      created.editor.commands.deleteSelection()
    })
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
  })

  it('a comment split across marks (bold inside it) is ONE panel entry spanning the whole range', async () => {
    const user = userEvent.setup()
    const created = renderEditor([CommentsFeature, BoldFeature], { content: docWith('hello world') })
    created.editor.commands.setTextSelection({ from: 1, to: 12 }) // all of it
    created.api.exec('comment.add', { text: 'tudo' })
    // Bolding a middle slice splits the text into THREE nodes sharing the id.
    created.editor.commands.setTextSelection({ from: 7, to: 10 })
    created.api.exec('bold.toggle')

    render(<CommentsPanel editor={created.editor} />)
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    const entries = within(panel).getAllByRole('button')
    expect(entries).toHaveLength(1)
    expect(within(panel).getByText('“hello world”')).toBeInTheDocument()

    // Clicking selects the FULL merged range, not one fragment.
    await user.click(entries[0])
    expect(created.editor.state.selection.from).toBe(1)
    expect(created.editor.state.selection.to).toBe(12)
  })

  it('OVERLAPPING comments each get their own entry (a text node carries several marks)', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.commands.setTextSelection({ from: 1, to: 12 })
    created.api.exec('comment.add', { text: 'sobre tudo' })
    // excludes: '' allows overlap — the second comment shares text nodes with
    // the first; reading only the FIRST mark per node used to drop it.
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    created.api.exec('comment.add', { text: 'sobre hello' })

    render(<CommentsPanel editor={created.editor} />)
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByText('sobre tudo')).toBeInTheDocument()
    expect(within(panel).getByText('sobre hello')).toBeInTheDocument()
  })

  it('a DISCONTIGUOUS reuse of one id (copy/paste) stays two entries — no swallowed text between them', async () => {
    const user = userEvent.setup()
    const created = renderEditor([CommentsFeature])
    created.editor.commands.insertContent(
      '<p><span data-comment-id="c1">alvo</span> texto livre no meio <span data-comment-id="c1">alvo de novo</span></p>',
    )

    render(<CommentsPanel editor={created.editor} />)
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    const entries = within(panel).getAllByRole('button')
    expect(entries).toHaveLength(2)
    // Neither quote swallows the uncommented middle…
    expect(within(panel).getByText('“alvo”')).toBeInTheDocument()
    expect(within(panel).getByText('“alvo de novo”')).toBeInTheDocument()
    expect(within(panel).queryByText(/texto livre/)).toBeNull()
    // …and clicking the first selects ONLY its own run.
    await user.click(entries[0])
    expect(created.editor.state.doc.textBetween(
      created.editor.state.selection.from,
      created.editor.state.selection.to,
    )).toBe('alvo')
  })

  it('an anchor without a stored thread (pasted from elsewhere) lists with its quote only', () => {
    const created = renderEditor([CommentsFeature])
    created.editor.commands.insertContent('<p><span data-comment-id="x1">alvo</span></p>')

    render(<CommentsPanel editor={created.editor} />)
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByText('“alvo”')).toBeInTheDocument()
    expect(panel.querySelector('.comments-panel__text')).toBeNull() // no body → no text span
  })

  it('renders nothing with no editor at all', () => {
    const { container } = render(<CommentsPanel editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
