import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createEditor } from './createEditor'
import { SCHEMA_VERSION, createEmptyDocument, migrateDocument, type DocumentJSON } from './document'

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

const at = (version: number): DocumentJSON => ({
  schemaVersion: version,
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
})

describe('migrateDocument', () => {
  it('passes a current-version document through, re-stamped', () => {
    expect(migrateDocument(at(SCHEMA_VERSION)).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('refuses a document from a newer schema version (would drop data on save)', () => {
    expect(() => migrateDocument(at(SCHEMA_VERSION + 1))).toThrow(/newer than/)
  })

  it('throws if a required upgrade migration is missing', () => {
    expect(() => migrateDocument(at(0))).toThrow(/No migration registered/)
  })

  it('runs registered migrations in order up to the current version', () => {
    const out = migrateDocument(at(0), { 0: [(doc) => ({ ...doc, migrated: true })] })
    expect(out.schemaVersion).toBe(SCHEMA_VERSION)
    expect((out.doc as { migrated?: boolean }).migrated).toBe(true)
  })
})
