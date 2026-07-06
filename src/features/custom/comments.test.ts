import { afterEach, describe, expect, it, vi } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { CommentsFeature } from './comments'
import { getCommentThreads } from './commentsPanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('a cancelled prompt aborts without marking anything', () => {
    const prompt = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', prompt)
    const created = renderEditor([CommentsFeature], { content: docWith('hello') })
    created.editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(created.api.exec('comment.add')).toBe(false) // no payload → prompt → cancelled

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(created.api.getHTML()).not.toContain('data-comment-id')
  })

  it('the anchor round-trips through pasted HTML (paste keeps the comment id)', () => {
    const created = renderEditor([CommentsFeature])
    created.editor.commands.insertContent('<p>antes <span data-comment-id="c-legado">alvo</span></p>')

    const paragraph = created.api.getJSON().doc.content?.[0]
    const marked = paragraph?.content?.find((node) =>
      node.marks?.some((mark) => mark.type === 'comment'),
    )
    expect(marked?.text).toBe('alvo')
    expect(marked?.marks?.[0]).toMatchObject({ type: 'comment', attrs: { commentId: 'c-legado' } })
  })

  it('falls back to a time-based id when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    const created = renderEditor([CommentsFeature], { content: docWith('hello') })
    created.editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(created.api.exec('comment.add', { text: 'nota' })).toBe(true)

    const threads = getCommentThreads(created.editor)
    expect([...threads!.keys()][0]).toMatch(/^c-/)
  })
})
