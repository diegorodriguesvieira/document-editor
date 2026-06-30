import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createEditor } from './createEditor'
import { SCHEMA_VERSION, createEmptyDocument, type DocumentJSON } from './document'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const sample: DocumentJSON = {
  schemaVersion: SCHEMA_VERSION,
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
  },
}

describe('DocumentJSON round-trip', () => {
  it('createEmptyDocument carries the current schema version', () => {
    expect(createEmptyDocument().schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('setJSON then getJSON preserves the document', () => {
    const created = createEditor({ features: [] })
    editor = created.editor

    created.api.setJSON(sample)
    const out = created.api.getJSON()

    expect(out.schemaVersion).toBe(SCHEMA_VERSION)
    expect(out.doc).toEqual(sample.doc)
  })

  it('exports HTML for read-only display', () => {
    const created = createEditor({ features: [], content: sample })
    editor = created.editor
    expect(created.api.getHTML()).toContain('hello world')
  })
})
