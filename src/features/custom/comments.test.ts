import { describe, expect, it } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature } from './comments'
import { getCommentThreads } from './commentsPanel'

describe('comments feature', () => {
  it('anchors a comment mark to the selected text and stores the thread by id', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello world') })

    created.editor.commands.setTextSelection({ from: 1, to: 6 }) // "hello"
    expect(created.api.exec('comment.add', { text: 'fix this' })).toBe(true)

    // The anchor lives in the doc (rides with the text, serializes with it)…
    expect(created.api.getHTML()).toContain('data-comment-id')
    // …and the thread (the "what") lands in the mark storage for the panel.
    const threads = getCommentThreads(created.editor)
    expect(threads?.size).toBe(1)
    expect([...threads!.values()][0]).toMatchObject({ text: 'fix this', quote: 'hello' })
  })

  it('does nothing without a selection', () => {
    const created = renderEditor([CommentsFeature], { content: docWith('hello') })
    created.editor.commands.setTextSelection(1) // collapsed caret
    expect(created.api.exec('comment.add', { text: 'x' })).toBe(false)
  })
})
