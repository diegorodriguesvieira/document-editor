import { describe, expect, it } from 'vitest'
import type { CreatedEditor } from '../../editor'
import { ImageFeature } from '../../features'
import { renderEditor } from '../../test/editorHarness'
import { closeRegion, HeaderFooterFeature } from './headerFooter'

const newEditor = () => renderEditor([HeaderFooterFeature])
const content = (created: CreatedEditor) => created.api.getJSON().doc.content ?? []

describe('header/footer feature', () => {
  it('adds a header as the first node', () => {
    const created = newEditor()
    expect(created.api.hasNode('documentHeader')).toBe(false)
    expect(created.api.exec('header.add')).toBe(true)
    expect(created.api.hasNode('documentHeader')).toBe(true)
    expect(content(created)[0]?.type).toBe('documentHeader')
  })

  it('adding a region opens it for editing with the caret inside — type right away', () => {
    const created = newEditor()
    expect(created.api.exec('header.add')).toBe(true)

    // Caret inside the new header (the gate is open for it).
    const headerSize = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBeLessThan(headerSize)

    // Typing lands in the header.
    created.editor.commands.insertContent('Confidential')
    expect(created.api.getJSON().doc.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe(
      'Confidential',
    )
  })

  it('never adds a second header', () => {
    const created = newEditor()
    expect(created.api.exec('header.add')).toBe(true)
    expect(created.api.exec('header.add')).toBe(false)
  })

  it('adds a footer as the last node (no trailing paragraph after it)', () => {
    const created = newEditor()
    expect(created.api.exec('footer.add')).toBe(true)
    const c = content(created)
    expect(c[c.length - 1]?.type).toBe('documentFooter')
  })

  it('serializes regions to data-* for the backend', () => {
    const created = newEditor()
    created.api.exec('header.add')
    created.api.exec('footer.add')
    const html = created.api.getHTML()
    expect(html).toContain('data-document-header')
    expect(html).toContain('data-document-footer')
  })

  it('normalizes a malformed load to one header (first) and one footer (last)', () => {
    const created = newEditor()
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const region = (type: string, text: string) => ({ type, content: [para(text)] })
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          region('documentHeader', 'H1'),
          para('body'),
          region('documentHeader', 'H2'), // duplicate header
          region('documentFooter', 'F'),
          para('after footer'), // content after the footer
        ],
      },
    })
    const c = content(created)
    expect(c.filter((n) => n.type === 'documentHeader')).toHaveLength(1)
    expect(c.filter((n) => n.type === 'documentFooter')).toHaveLength(1)
    expect(c[0]?.type).toBe('documentHeader')
    expect(c[c.length - 1]?.type).toBe('documentFooter')
  })

  it('Cmd+A from the body selects the body only — header/footer stay out', () => {
    const created = newEditor()
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body one' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body two' }] },
          { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foot' }] }] },
        ],
      },
    })
    const doc = created.editor.state.doc
    const headerSize = doc.firstChild!.nodeSize
    const footerSize = doc.lastChild!.nodeSize

    created.editor.commands.focus()
    created.editor.commands.setTextSelection(headerSize + 3) // caret in the body
    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    const { from, to } = created.editor.state.selection
    expect(from).toBeGreaterThanOrEqual(headerSize) // starts after the header
    expect(to).toBeLessThanOrEqual(doc.content.size - footerSize) // ends before the footer
    const selected = doc.textBetween(from, to, ' ')
    expect(selected).toContain('body one')
    expect(selected).toContain('body two')
    expect(selected).not.toContain('head')
    expect(selected).not.toContain('foot')
  })

  it('Cmd+A inside the header selects only the header content', () => {
    const created = newEditor()
    // The realistic path into a region: add it (gate opens, caret inside)…
    created.api.exec('header.add')
    created.editor.commands.insertContent('head')
    created.editor.commands.focus()

    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    const { from, to } = created.editor.state.selection
    const selected = created.editor.state.doc.textBetween(from, to, ' ')
    expect(selected).toBe('head')
  })

  it('keyboard/selection cannot enter a CLOSED region — the caret is clamped back to the body', async () => {
    const { TextSelection } = await import('@tiptap/pm/state')
    const created = newEditor()
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
          { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foot' }] }] },
        ],
      },
    })
    const view = created.editor.view
    const headerSize = view.state.doc.firstChild!.nodeSize

    // What arrows/shift-selection do under the hood: a selection into the region.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    // …gets clamped back to the body start.
    expect(created.editor.state.selection.from).toBe(headerSize + 1)
  })

  it('Cmd+A in the body includes a leading IMAGE — Delete removes it and restores an empty body', () => {
    const created = renderEditor([HeaderFooterFeature, ImageFeature])
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
          { type: 'image', attrs: { src: 'data:,logo' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'texto do corpo' }] },
          { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foot' }] }] },
        ],
      },
    })
    const doc = created.editor.state.doc
    const headerSize = doc.firstChild!.nodeSize
    const imageSize = doc.child(1).nodeSize

    created.editor.commands.focus()
    created.editor.commands.setTextSelection(headerSize + imageSize + 2) // caret no corpo
    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    // A seleção começa ANTES da imagem (TextSelection a pularia).
    expect(created.editor.state.selection.from).toBe(headerSize)
    expect(created.editor.state.selection.from).toBeLessThanOrEqual(headerSize + imageSize - 1)

    created.editor.commands.deleteSelection()
    const content = created.api.getJSON().doc.content ?? []
    expect(content.some((n) => n.type === 'image')).toBe(false)
    // Regiões intactas + corpo restaurado com um parágrafo vazio editável.
    expect(content.map((n) => n.type)).toEqual(['documentHeader', 'paragraph', 'documentFooter'])
    const bounds = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBe(bounds + 1) // caret no corpo
  })

  it('deleting ALL of an open region keeps the caret inside it (typing refills the region)', () => {
    const created = newEditor()
    created.api.exec('header.add')
    created.editor.commands.insertContent('titulo aqui')

    // Cmd+A inside the region, then delete everything.
    created.editor.commands.focus()
    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    created.editor.commands.deleteSelection()

    // The header is empty but the caret must still be INSIDE it…
    const headerSize = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBeLessThan(headerSize)

    // …so typing refills the header, not the body.
    created.editor.commands.insertContent('NOVO')
    const content = created.api.getJSON().doc.content ?? []
    expect(content[0]?.content?.[0]?.content?.[0]?.text).toBe('NOVO')
  })

  it('an OPEN region admits the caret; closeRegion expels it and seals the region', async () => {
    const { TextSelection } = await import('@tiptap/pm/state')
    const created = newEditor()
    created.api.exec('header.add') // opens the gate, caret inside
    const view = created.editor.view

    // While open, a selection inside the region sticks.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(created.editor.state.selection.from).toBe(2)

    // Exit path (Escape / click elsewhere in the document → closeRegion):
    // the gate shuts and the caret is expelled to the body start.
    closeRegion(created.editor, 'documentHeader')
    const headerSize = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBe(headerSize + 1)

    // And the region is sealed again.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(created.editor.state.selection.from).toBe(headerSize + 1)
  })

  it('rejects the useless gap cursor above the header / below the footer', async () => {
    const { GapCursor } = await import('@tiptap/pm/gapcursor')
    const created = newEditor()
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
          { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foot' }] }] },
        ],
      },
    })
    const view = created.editor.view
    const before = created.editor.state.selection.toJSON()

    // Above the header (pos 0) → filtered out, selection unchanged.
    view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(0))))
    expect(created.editor.state.selection.toJSON()).toEqual(before)

    // Below the footer (doc end) → filtered out too.
    view.dispatch(
      view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(view.state.doc.content.size))),
    )
    expect(created.editor.state.selection.toJSON()).toEqual(before)
  })

  it('exposes top/bottom page regions for the hover affordance', () => {
    expect(HeaderFooterFeature.pageRegions?.map((region) => [region.position, region.nodeName])).toEqual([
      ['top', 'documentHeader'],
      ['bottom', 'documentFooter'],
    ])
  })
})
