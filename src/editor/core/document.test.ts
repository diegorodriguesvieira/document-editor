import { describe, expect, it } from 'vitest'
import { createEmptyDocument, type DocumentJSON } from './document'
import { docWith, renderEditor } from '../../test/editorHarness'

const sample: DocumentJSON = docWith('hello world')

describe('DocumentJSON round-trip', () => {
  it('createEmptyDocument is an empty paragraph document', () => {
    expect(createEmptyDocument().doc.content?.[0]?.type).toBe('paragraph')
  })

  it('setJSON then getJSON preserves the document', () => {
    const { api } = renderEditor([])
    api.setJSON(sample)
    expect(api.getJSON().doc).toEqual(sample.doc)
  })

  it('exports HTML for read-only display', () => {
    const { api } = renderEditor([], { content: sample })
    expect(api.getHTML()).toContain('hello world')
  })
})
