import { describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature, getCommentsStorage } from './comments'
import type { DocumentComment } from './commentsProvider'

const AUTHOR = { id: 'u-ana', name: 'Ana Lima' }

const seeded = (over: Partial<DocumentComment> = {}): DocumentComment => ({
  id: 'c-1',
  from: 1,
  to: 6,
  quote: 'hello',
  text: 'tighten this',
  author: AUTHOR,
  createdAt: '2026-07-15T12:00:00Z',
  ...over,
})

/** What CommentsLayer does after mutating the storage: a no-op dispatch. */
function nudge(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
}

/** A read-only editor with `comments` already in the kernel storage. */
function reviewEditor(comments: DocumentComment[]) {
  const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
  created.editor.setEditable(false)
  const storage = getCommentsStorage(created.editor)!
  storage.comments = comments
  nudge(created.editor)
  return created
}

describe('comments decorations (the review-mode overlay)', () => {
  it('renders each fetched comment as a highlight — the document itself stays clean', () => {
    const created = reviewEditor([seeded()])

    const span = created.editor.view.dom.querySelector('span.comment[data-comment-id="c-1"]')
    expect(span?.textContent).toBe('hello')
    // Decorations never serialize: no anchor in the HTML/JSON contract.
    expect(created.api.getHTML()).not.toContain('data-comment-id')
    expect(created.api.getHTML()).not.toContain('comment')
  })

  it('lights the ACTIVE comment (clicked in the panel) with comment--active', () => {
    const created = reviewEditor([seeded()])

    getCommentsStorage(created.editor)!.activeId = 'c-1'
    nudge(created.editor)

    expect(created.editor.view.dom.querySelector('span.comment--active')?.textContent).toBe('hello')
  })

  it('shows the range being composed (the captured draft) as comment--draft', () => {
    const created = reviewEditor([])

    getCommentsStorage(created.editor)!.draft = { from: 7, to: 12, quote: 'world' }
    nudge(created.editor)

    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('world')
  })

  it('renders NOTHING in edit mode — comments are a review-only surface', () => {
    const created = reviewEditor([seeded()])

    created.editor.setEditable(true)
    nudge(created.editor)

    expect(created.editor.view.dom.querySelector('.comment')).toBeNull()
  })

  it('clamps out-of-range anchors instead of crashing (stale backend positions)', () => {
    const created = reviewEditor([
      seeded({ id: 'c-beyond', from: 500, to: 900 }), // collapses to nothing
      seeded({ id: 'c-neg', from: -5, to: 3 }), // clamps to the doc start
    ])

    const dom = created.editor.view.dom
    expect(dom.querySelector('[data-comment-id="c-beyond"]')).toBeNull()
    expect(dom.querySelector('[data-comment-id="c-neg"]')).not.toBeNull()
  })
})

describe('comments document-click reporting', () => {
  it('reports the INNERMOST hit to onCommentClick — and null when clicking off-highlight', () => {
    const created = reviewEditor([
      seeded({ id: 'c-outer', from: 1, to: 11 }),
      seeded({ id: 'c-inner', from: 3, to: 6 }),
    ])
    const clicks: Array<string | null> = []
    getCommentsStorage(created.editor)!.onCommentClick = (id) => clicks.push(id)
    const click = (pos: number) =>
      created.editor.view.someProp('handleClick', (fn) =>
        fn(created.editor.view, pos, new MouseEvent('click')),
      )

    click(4) // inside both → the smaller range wins
    click(10) // only the outer one covers it
    click(12) // past both → deactivates

    expect(clicks).toEqual(['c-inner', 'c-outer', null])
  })

  it('never reports in edit mode', () => {
    const created = reviewEditor([seeded()])
    created.editor.setEditable(true)
    const clicks: Array<string | null> = []
    getCommentsStorage(created.editor)!.onCommentClick = (id) => clicks.push(id)

    created.editor.view.someProp('handleClick', (fn) =>
      fn(created.editor.view, 3, new MouseEvent('click')),
    )

    expect(clicks).toEqual([])
  })
})
