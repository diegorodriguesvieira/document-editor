import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
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

  it('shows an empty state when there are no comments', () => {
    const created = renderEditor([CommentsFeature])
    render(<CommentsPanel editor={created.editor} />)
    expect(screen.getByText(/Select text/)).toBeInTheDocument()
  })
})
