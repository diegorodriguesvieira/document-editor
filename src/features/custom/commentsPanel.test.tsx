import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createEditor, type CreatedEditor } from '../../editor'
import { CommentsFeature } from './comments'
import { CommentsPanel } from './commentsPanel'

let created: CreatedEditor | undefined

beforeAll(() => {
  // jsdom has no layout; ProseMirror's scrollIntoView() → coordsAtPos() calls
  // these, so stub them (in a real browser they exist).
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList) as Range['getClientRects']
  Range.prototype.getBoundingClientRect = (() => rect) as Range['getBoundingClientRect']
})

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

const docWith = (text: string) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

describe('<CommentsPanel />', () => {
  it('lists comments anchored in the doc and scrolls to one on click', async () => {
    const user = userEvent.setup()
    created = createEditor({
      features: [CommentsFeature],
      element: mountTarget(),
      content: docWith('hello world'),
    })
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
    created = createEditor({ features: [CommentsFeature], element: mountTarget() })
    render(<CommentsPanel editor={created.editor} />)
    expect(screen.getByText(/Select text/)).toBeInTheDocument()
  })
})
