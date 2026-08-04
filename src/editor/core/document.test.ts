import { describe, expect, it } from 'vitest'
import { createEmptyDocument, isBlankDocument, type DocumentJSON } from './document'
import { stripNodeIds } from './nodeIds'
import { TableFeature } from '../../features'
import { docWith, renderEditor } from '../../test/editorHarness'

const sample: DocumentJSON = docWith('hello world')

describe('DocumentJSON round-trip', () => {
  it('createEmptyDocument is an empty paragraph document', () => {
    expect(createEmptyDocument().doc.content?.[0]?.type).toBe('paragraph')
  })

  it('setJSON then getJSON preserves the document', () => {
    const { api } = renderEditor([])
    api.setJSON(sample)
    // getJSON carries the minted uids — preservation means CONTENT fidelity.
    expect(stripNodeIds(api.getJSON()).doc).toEqual(sample.doc)
  })

  it('exports HTML for read-only display', () => {
    const { api } = renderEditor([], { content: sample })
    expect(api.getHTML()).toContain('hello world')
  })
})

describe('isBlankDocument', () => {
  it('only the pristine one-empty-paragraph document is blank — structure counts as content', () => {
    const { editor, api } = renderEditor([TableFeature])
    expect(isBlankDocument(editor.state.doc)).toBe(true)

    // A fresh table is ALL empty cells (no text anywhere) — TipTap's
    // editor.isEmpty stays true for it, ours must not.
    api.exec('table.insert')
    expect(editor.getText().trim()).toBe('')
    expect(editor.isEmpty).toBe(true) // ← the trap this helper exists to avoid
    expect(isBlankDocument(editor.state.doc)).toBe(false)

    // Wiping back to the blank slate flips it back.
    api.setJSON(createEmptyDocument())
    expect(isBlankDocument(editor.state.doc)).toBe(true)

    // Text obviously counts too.
    api.setJSON(docWith('x'))
    expect(isBlankDocument(editor.state.doc)).toBe(false)
  })
})
