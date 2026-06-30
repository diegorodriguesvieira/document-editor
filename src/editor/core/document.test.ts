import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createEditor } from './createEditor'
import { createEmptyDocument, type DocumentJSON } from './document'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const sample: DocumentJSON = {
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
  },
}

describe('DocumentJSON round-trip', () => {
  it('createEmptyDocument is an empty paragraph document', () => {
    expect(createEmptyDocument().doc.content?.[0]?.type).toBe('paragraph')
  })

  it('setJSON then getJSON preserves the document', () => {
    const created = createEditor({ features: [] })
    editor = created.editor

    created.api.setJSON(sample)
    expect(created.api.getJSON().doc).toEqual(sample.doc)
  })

  it('exports HTML for read-only display', () => {
    const created = createEditor({ features: [], content: sample })
    editor = created.editor
    expect(created.api.getHTML()).toContain('hello world')
  })
})
