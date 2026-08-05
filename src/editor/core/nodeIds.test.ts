import { describe, expect, it } from 'vitest'
import { Extension, Node } from '@tiptap/core'
import type { DocumentJSON } from './document'
import { defineFeature } from './defineFeature'
import { NODE_ID_ATTRIBUTE, injectNodeIds, stripNodeIds } from './nodeIds'
import { TableFeature } from '../../features'
import { collectNodeIds, docWith, jsonFindNode, renderEditor } from '../../test/editorHarness'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Table nesting + an inline business-id node + a marked text leaf — the
 *  shapes that break naive JSON walkers. */
const rawNestedDoc = (): DocumentJSON => ({
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro', marks: [{ type: 'bold' }] }] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 2 },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }],
              },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'variable', attrs: { id: 'country', label: 'Country' } }] },
    ],
  },
})

describe('injectNodeIds', () => {
  it('mints a uuid for every content node — none for the doc root or text leaves', () => {
    const injected = injectNodeIds(rawNestedDoc())
    const ids = collectNodeIds(injected.doc)
    // paragraph, table, tableRow, tableCell, inner paragraph, paragraph, variable
    expect(ids).toHaveLength(7)
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
    expect(injected.doc.attrs).toBeUndefined()
    expect(injected.doc.content?.[0]?.content?.[0]?.attrs).toBeUndefined()
  })

  it('preserves existing ids — including non-uuid legacy strings — and foreign attrs/marks', () => {
    const raw = rawNestedDoc()
    raw.doc.content![0]!.attrs = { [NODE_ID_ATTRIBUTE]: 'legacy-1' }
    const injected = injectNodeIds(raw)
    expect(injected.doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe('legacy-1')
    // The variable's BUSINESS id lives in `attrs.id` and must never be touched.
    const variable = injected.doc.content?.[2]?.content?.[0]
    expect(variable?.attrs).toMatchObject({ id: 'country', label: 'Country' })
    expect(variable?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
    expect(injected.doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
  })

  it('re-mints duplicates, keeping the first occurrence in document order', () => {
    const raw: DocumentJSON = {
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'dup' } },
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'dup' } },
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'dup' } },
        ],
      },
    }
    const ids = collectNodeIds(injectNodeIds(raw).doc)
    expect(ids[0]).toBe('dup')
    expect(ids[1]).not.toBe('dup')
    expect(ids[2]).not.toBe('dup')
    expect(new Set(ids).size).toBe(3)
  })

  it('parent wins a parent/child duplicate — pre-order is document order', () => {
    const raw: DocumentJSON = {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            attrs: { [NODE_ID_ATTRIBUTE]: 'x' },
            content: [{ type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'x' } }],
          },
        ],
      },
    }
    const [parent, child] = collectNodeIds(injectNodeIds(raw).doc)
    expect(parent).toBe('x')
    expect(child).not.toBe('x')
    expect(child).toMatch(UUID_V4)
  })

  it('treats null, empty and non-string ids as missing', () => {
    const raw: DocumentJSON = {
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: null } },
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: '' } },
          { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 42 } },
        ],
      },
    }
    for (const id of collectNodeIds(injectNodeIds(raw).doc)) expect(id).toMatch(UUID_V4)
  })

  it('is idempotent — a satisfied document comes back deep-equal', () => {
    const once = injectNodeIds(rawNestedDoc())
    expect(injectNodeIds(once)).toEqual(once)
  })

  it('never mutates its input', () => {
    const raw = rawNestedDoc()
    const rawSnapshot = structuredClone(raw)
    const injected = injectNodeIds(raw)
    expect(raw).toEqual(rawSnapshot)

    const injectedSnapshot = structuredClone(injected)
    stripNodeIds(injected)
    expect(injected).toEqual(injectedSnapshot)
  })
})

describe('stripNodeIds', () => {
  it('removes every uid, dropping attrs objects it leaves empty and keeping the rest', () => {
    const stripped = stripNodeIds(injectNodeIds(rawNestedDoc()))
    expect(collectNodeIds(stripped.doc).every((id) => id === undefined)).toBe(true)
    // uid was the paragraph's only attr → the whole attrs key goes away…
    expect(stripped.doc.content?.[0]?.attrs).toBeUndefined()
    // …but a cell keeps its own attrs untouched.
    const cell = stripped.doc.content?.[1]?.content?.[0]?.content?.[0]
    expect(cell?.attrs).toEqual({ colspan: 2 })
  })

  it('inverts injectNodeIds back to the raw document', () => {
    const raw = rawNestedDoc()
    expect(stripNodeIds(injectNodeIds(raw))).toEqual(raw)
  })

  it('is the identity on an id-free document', () => {
    const raw = rawNestedDoc()
    expect(stripNodeIds(raw)).toEqual(raw)
  })
})

/** Raw table document — `tableRow` only enters the schema through TableKit's
 *  `addExtensions()`, which is exactly what the id-scope enumeration must
 *  flatten. */
const rawTableDoc = (): DocumentJSON => ({
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] },
        ],
      },
    ],
  },
})

describe('node ids in the editor', () => {
  it('stamps every node on a raw load through the content option — kit-hidden tableRow included', () => {
    const { api } = renderEditor([TableFeature], { content: rawTableDoc() })
    const doc = api.getJSON().doc
    const ids = collectNodeIds(doc)
    expect(ids.length).toBeGreaterThanOrEqual(5)
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
    expect(jsonFindNode(doc, 'tableRow')?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
  })

  it('stamps every node on a raw api.setJSON load', () => {
    const { api } = renderEditor([TableFeature])
    api.setJSON(rawTableDoc())
    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids.length).toBeGreaterThanOrEqual(5)
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /** Two paragraphs sharing one uid — the duplicate-policy probe. */
  const duplicatedDoc = (): DocumentJSON => ({
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'dup' }, content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph', attrs: { [NODE_ID_ATTRIBUTE]: 'dup' }, content: [{ type: 'text', text: 'second' }] },
      ],
    },
  })

  it('re-mints a duplicated id on setJSON — the first occurrence keeps it', () => {
    // Entry injection owns this policy: the duplicate is resolved before the
    // setContent transaction, so a load never leans on the runtime collision
    // rule — and never records a remap meta for what is just a dirty document.
    const { api } = renderEditor([])
    api.setJSON(duplicatedDoc())
    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids[0]).toBe('dup')
    expect(ids[1]).not.toBe('dup')
    expect(ids[1]).toMatch(UUID_V4)
  })

  it('re-mints a duplicated id on a content-option load — the duplicate never enters the doc', () => {
    // The extension only watches transactions and a content-option mount
    // dispatches none: without entry injection this duplicate would survive
    // into the document (and the backend).
    const { api } = renderEditor([], { content: duplicatedDoc() })
    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids[0]).toBe('dup')
    expect(ids[1]).not.toBe('dup')
    expect(ids[1]).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stamps the paragraph BodyTrailingNode appends — plugin cooperation, not entry injection', () => {
    // rawTableDoc ends in a table, so the load transaction makes
    // BodyTrailingNode append the trailing paragraph — a node that never
    // existed in the injected entry content. Its id can only come from the
    // NodeIds appendTransaction rounds running to fixpoint after it.
    const { api } = renderEditor([TableFeature])
    api.setJSON(rawTableDoc())
    const doc = api.getJSON().doc
    const trailing = doc.content?.at(-1)
    expect(trailing?.type).toBe('paragraph')
    expect(trailing?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
    const ids = collectNodeIds(doc)
    expect(ids).toHaveLength(6) // intro p, table, row, cell, cell p, trailing p
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('loads a pre-injected document verbatim — entry injection is the only writer', () => {
    const content = injectNodeIds(docWith('stable'))
    const viaOption = renderEditor([], { content })
    expect(viaOption.api.getJSON()).toEqual(content)

    const viaSetJSON = renderEditor([])
    viaSetJSON.api.setJSON(content)
    expect(viaSetJSON.api.getJSON()).toEqual(content)
  })

  it('splitBlock keeps the original id on one half and mints a fresh one for the other', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('ab')) })
    const [original] = collectNodeIds(api.getJSON().doc)
    editor.commands.setTextSelection(2)
    editor.commands.splitBlock()
    const ids = collectNodeIds(api.getJSON().doc)
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain(original)
  })

  it('pasted copies of a live uid are re-minted — the original keeps it', () => {
    const { editor, api } = renderEditor([], { content: injectNodeIds(docWith('target')) })
    const [stolen] = collectNodeIds(api.getJSON().doc)
    // No event-flag priming: the extension has no DOM handlers — pasteHTML
    // still exercises the real pipeline (parse keeps data-uid, then the
    // appendTransaction collision rule re-mints whatever collides).
    editor.commands.setTextSelection(7)
    // jsdom has no ClipboardEvent constructor — hand pasteHTML a plain Event
    // so it doesn't try to build one itself.
    const pasteEvent = new Event('paste') as ClipboardEvent
    editor.view.pasteHTML(
      `<p data-uid="${String(stolen)}">one</p><p data-uid="${String(stolen)}">two</p>`,
      pasteEvent,
    )
    const text = editor.getText()
    expect(text).toContain('one') // the paste actually landed…
    expect(text).toContain('two')
    const doc = api.getJSON().doc
    const ids = collectNodeIds(doc)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    // …and the SOURCE node still owns the uid; the colliding copies do not.
    expect(doc.content?.[0]?.attrs?.[NODE_ID_ATTRIBUTE]).toBe(stolen)
    expect(ids.filter((id) => id === stolen)).toHaveLength(1)
    for (const id of ids) expect(id).toMatch(UUID_V4) // re-minted, never nulled
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('serializes data-uid in getHTML — the backend contract marker', () => {
    const { api } = renderEditor([], { content: injectNodeIds(docWith('hello')) })
    const [uid] = collectNodeIds(api.getJSON().doc)
    expect(api.getHTML()).toContain(`data-uid="${String(uid)}"`)
  })

  it('covers a consumer feature with zero configuration — plain and kit-nested nodes alike', () => {
    // What a consumer team would ship: one plain Node plus one hidden inside a
    // kit (the TableKit shape) — neither knows node ids exist.
    const ToyStamp = Node.create({
      name: 'toyStamp',
      group: 'block',
      atom: true,
      renderHTML: () => ['div', { 'data-toy-stamp': '' }],
    })
    const ToyBadge = Node.create({
      name: 'toyBadge',
      group: 'block',
      atom: true,
      renderHTML: () => ['div', { 'data-toy-badge': '' }],
    })
    const ToyKit = Extension.create({ name: 'toyKit', addExtensions: () => [ToyBadge] })
    const ToyFeature = defineFeature({ id: 'toy', extensions: () => [ToyStamp, ToyKit] })

    const { editor, api } = renderEditor([ToyFeature])
    api.setJSON({
      doc: {
        type: 'doc',
        content: [{ type: 'toyStamp' }, { type: 'toyBadge' }, { type: 'paragraph' }],
      },
    })
    const doc = api.getJSON().doc
    expect(jsonFindNode(doc, 'toyStamp')?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
    expect(jsonFindNode(doc, 'toyBadge')?.attrs?.[NODE_ID_ATTRIBUTE]).toMatch(UUID_V4)
    const ids = collectNodeIds(doc)
    expect(new Set(ids).size).toBe(ids.length)

    // Runtime insertion goes through the extension, not the entry points.
    editor.commands.insertContent({ type: 'toyStamp' })
    const stamps = api.findNodes('toyStamp').map((node) => node.attrs[NODE_ID_ATTRIBUTE])
    expect(stamps).toHaveLength(2)
    for (const id of stamps) expect(id).toMatch(UUID_V4)
    expect(new Set(stamps).size).toBe(2)
  })
})
