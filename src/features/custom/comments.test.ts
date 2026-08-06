import { describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { docWith, parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { CommentsFeature, getCommentsStorage } from './comments'

/** What CommentsLayer does after mutating the storage: a no-op dispatch. */
function nudge(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
}

describe('comments are 100% anchor-based — the mark is GONE', () => {
  it('the schema ships no comment mark, and a comment never touches the JSON', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    expect(created.editor.schema.marks.comment).toBeUndefined()

    // A live highlight is a decoration: paint it, then round-trip the JSON.
    getCommentsStorage(created.editor)!.comments = [
      { id: 'c-1', nodes: [{ id: created.editor.state.doc.child(0).attrs.uid as string, from: 0, to: 5 }] },
    ]
    nudge(created.editor)
    expect(created.editor.view.dom.querySelector('span.comment')?.textContent).toBe('hello')
    expect(JSON.stringify(created.editor.getJSON())).not.toContain('comment')
    expect(created.api.getHTML()).not.toContain('data-comment-id')
  })

  it('pasted HTML carrying data-comment-id spans resurrects nothing — no parse rule left', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    const slice = parseSliceFromHTML(
      created.editor,
      '<p><span class="comment" data-comment-id="c-alien">hi</span></p>',
    )

    // The text parses; the span's comment identity has nowhere to land.
    expect(JSON.stringify(slice.toJSON())).toContain('hi')
    expect(JSON.stringify(slice.toJSON())).not.toContain('c-alien')
  })
})

describe('comments kernel (draft emphasis)', () => {
  it('shows the range being composed (the captured draft) as comment--draft', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })
    created.editor.setEditable(false)

    getCommentsStorage(created.editor)!.draft = { from: 7, to: 12, quote: 'world' }
    nudge(created.editor)

    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('world')
  })

  it('clamps a stale draft range into the doc and drops a collapsed one', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello') })
    const storage = getCommentsStorage(created.editor)!

    // Overshooting range: clamped to the doc, still visible.
    storage.draft = { from: 1, to: 500, quote: 'hello' }
    nudge(created.editor)
    expect(created.editor.view.dom.querySelector('span.comment--draft')?.textContent).toBe('hello')

    // Fully past the doc: clamps to nothing — no decoration, no crash.
    storage.draft = { from: 500, to: 900, quote: 'gone' }
    nudge(created.editor)
    expect(created.editor.view.dom.querySelector('span.comment--draft')).toBeNull()
  })
})
