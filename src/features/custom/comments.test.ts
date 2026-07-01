import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor, type CreatedEditor } from '../../editor'
import { CommentsFeature } from './comments'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
  vi.restoreAllMocks()
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

const docWith = (text: string) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

describe('comments feature', () => {
  it('anchors a comment mark to the selected text and logs the thread', () => {
    created = createEditor({
      features: [CommentsFeature],
      element: mountTarget(),
      content: docWith('hello world'),
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    created.editor.commands.setTextSelection({ from: 1, to: 6 }) // "hello"
    expect(created.api.exec('comment.add', { text: 'fix this' })).toBe(true)

    // The anchor lives in the doc (rides with the text, serializes with it).
    expect(created.api.getHTML()).toContain('data-comment-id')
    // The thread (the "what") is logged, keyed to the same selection.
    expect(log).toHaveBeenCalledWith(
      '[comment]',
      expect.objectContaining({ text: 'fix this', quote: 'hello' }),
    )
  })

  it('stores the thread in the mark storage, keyed by id (so the panel can show it)', () => {
    created = createEditor({
      features: [CommentsFeature],
      element: mountTarget(),
      content: docWith('hello world'),
    })
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    created.api.exec('comment.add', { text: 'fix this' })

    const store = created.editor.storage as unknown as Record<
      string,
      { threads: Map<string, { text: string; quote: string }> }
    >
    const threads = store.comment.threads
    expect(threads.size).toBe(1)
    expect([...threads.values()][0]).toMatchObject({ text: 'fix this', quote: 'hello' })
  })

  it('does nothing without a selection', () => {
    created = createEditor({
      features: [CommentsFeature],
      element: mountTarget(),
      content: docWith('hello'),
    })
    created.editor.commands.setTextSelection(1) // collapsed caret
    expect(created.api.exec('comment.add', { text: 'x' })).toBe(false)
  })
})
