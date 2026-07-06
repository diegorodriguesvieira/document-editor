import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { DocumentEditor, type CreatedEditor, type EditorApi } from '../../editor'
import { ImageFeature } from '../../features'
import { docWith, renderEditor } from '../../test/editorHarness'
import { closeRegion, HeaderFooterFeature } from './headerFooter'

const newEditor = () => renderEditor([HeaderFooterFeature])
const content = (created: CreatedEditor) => created.api.getJSON().doc.content ?? []
const gate = (editor: Editor) =>
  (editor.storage as unknown as { headerFooterGuard: { editing: string | null } }).headerFooterGuard

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

describe('header/footer guard — edge paths', () => {
  it('Mod+A with no regions in the doc falls through to the native select-all', () => {
    const created = renderEditor([HeaderFooterFeature], { content: docWith('corpo inteiro') })
    created.editor.commands.focus()
    created.editor.commands.setTextSelection(3)

    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    // The whole document, node boundaries included (PM's AllSelection).
    expect(created.editor.state.selection.from).toBe(0)
    expect(created.editor.state.selection.to).toBe(created.editor.state.doc.content.size)
  })

  it('the body select-all survives a JSON round-trip (RangeSelection is serializable)', async () => {
    const { Selection } = await import('@tiptap/pm/state')
    const created = newEditor()
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'corpo' }] },
          { type: 'documentFooter', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foot' }] }] },
        ],
      },
    })
    created.editor.commands.focus()
    created.editor.commands.setTextSelection(created.editor.state.doc.firstChild!.nodeSize + 2)
    created.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    const selection = created.editor.state.selection
    const json = selection.toJSON() as { type: string }
    // Collab/persistence serialize selections by type id — it must round-trip.
    expect(json.type).toBe('regionRangeSelectAll')
    const restored = Selection.fromJSON(created.editor.state.doc, json)
    expect(restored.eq(selection)).toBe(true)
  })

  it('closeRegion is a no-op unless THAT region is the one editing', () => {
    const created = newEditor()
    created.api.exec('header.add')
    expect(gate(created.editor).editing).toBe('documentHeader')

    const dispatch = vi.spyOn(created.editor.view, 'dispatch')
    closeRegion(created.editor, 'documentFooter') // not the open one
    expect(dispatch).not.toHaveBeenCalled()
    expect(gate(created.editor).editing).toBe('documentHeader')
  })

  it('deleting the OPEN region clears the gate — no ghost gate for a future region', () => {
    const created = newEditor()
    created.api.exec('header.add')
    expect(gate(created.editor).editing).toBe('documentHeader')

    const headerSize = created.editor.state.doc.firstChild!.nodeSize
    created.editor.commands.deleteRange({ from: 0, to: headerSize })

    expect(content(created).some((node) => node.type === 'documentHeader')).toBe(false)
    expect(gate(created.editor).editing).toBeNull()
  })

  it('an edit that strands the caret outside the OPEN header pulls it back in', async () => {
    const { TextSelection } = await import('@tiptap/pm/state')
    const created = newEditor()
    created.api.exec('header.add') // gate open, caret inside the header
    const view = created.editor.view
    const bodyPos = view.state.doc.firstChild!.nodeSize + 1

    // One transaction that BOTH changes the doc and parks the caret in the
    // body — the shape PM produces when a delete refills the schema hole.
    let tr = view.state.tr.insertText('corpo', bodyPos)
    tr = tr.setSelection(TextSelection.create(tr.doc, bodyPos + 2))
    view.dispatch(tr)

    // The guard noticed the escape and pulled the caret back to the region's
    // first text position — typing keeps refilling the OPEN region.
    expect(created.editor.state.selection.from).toBe(2)
    expect(gate(created.editor).editing).toBe('documentHeader')
  })

  it('an edit that strands the caret outside the OPEN footer pulls it back in (bottom variant)', async () => {
    const { TextSelection } = await import('@tiptap/pm/state')
    const created = newEditor()
    created.api.exec('footer.add') // gate open, caret inside the footer
    const view = created.editor.view

    let tr = view.state.tr.insertText('corpo', 1) // the body paragraph comes first
    tr = tr.setSelection(TextSelection.create(tr.doc, 2))
    view.dispatch(tr)

    const state = created.editor.state
    const footerStart = state.doc.content.size - state.doc.lastChild!.nodeSize
    expect(state.selection.from).toBe(footerStart + 2) // first text position inside the footer
  })
})

describe('header/footer node view (the React chrome)', () => {
  const REGION_DOC = {
    doc: {
      type: 'doc',
      content: [
        { type: 'documentHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'head' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'corpo' }] },
      ],
    },
  }

  /** DocumentEditor host (node views need the React mount), plus a toolbar
   *  stub so the exit rule has an editor CONTROL to spare. posAtCoords is
   *  stubbed from the start: PM's own mouse handlers call it and jsdom has no
   *  elementFromPoint. */
  async function mountRegionEditor() {
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[HeaderFooterFeature]}
        content={REGION_DOC}
        renderToolbar={() => <button type="button">Toolbar control</button>}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )
    await screen.findByText('Header')
    const pm = document.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor }
    const editor = pm.editor!
    const posAtCoords = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null)
    const region = () => document.querySelector('.doc-region--header') as HTMLElement
    return { editor, api: api!, region, posAtCoords }
  }

  it('a single click does NOT drop the caret in (Google-Docs entry semantics)', async () => {
    const { editor, region } = await mountRegionEditor()

    const allowed = fireEvent.mouseDown(region())

    expect(allowed).toBe(false) // preventDefault — the caret never lands
    expect(gate(editor).editing).toBeNull()
    expect(region().classList.contains('doc-region--editing')).toBe(false)
  })

  it('double-click opens the gate and places the caret at the CLICK POINT', async () => {
    const { editor, region, posAtCoords } = await mountRegionEditor()
    posAtCoords.mockReturnValue({ pos: 3, inside: 0 }) // middle of "head"

    fireEvent.doubleClick(region(), { clientX: 15, clientY: 15 })

    expect(gate(editor).editing).toBe('documentHeader')
    expect(editor.state.selection.from).toBe(3)
    await waitFor(() => expect(region().classList.contains('doc-region--editing')).toBe(true))
    // Editing: single clicks behave normally again (move the caret inside).
    expect(fireEvent.mouseDown(region())).toBe(true)
  })

  it('double-click falls back to the region start when the coords resolve nowhere', async () => {
    const { editor, region } = await mountRegionEditor() // posAtCoords → null (label-bar double-click)

    fireEvent.doubleClick(region())

    expect(gate(editor).editing).toBe('documentHeader')
    expect(editor.state.selection.from).toBe(2) // getPos() + 2 → the region's first text position
  })

  it('Remove deletes the region and never leaves the gate ajar', async () => {
    const { editor, api, region } = await mountRegionEditor()
    fireEvent.doubleClick(region()) // remove while OPEN — the worst case for the gate
    expect(gate(editor).editing).toBe('documentHeader')

    fireEvent.click(screen.getByRole('button', { name: 'Remove header' }))

    await waitFor(() => expect(api.hasNode('documentHeader')).toBe(false))
    expect(gate(editor).editing).toBeNull()
  })

  it('exit rule: editor CONTROLS and portaled popovers keep the region open; anything else closes it', async () => {
    const { editor, region } = await mountRegionEditor()
    fireEvent.doubleClick(region())
    expect(gate(editor).editing).toBe('documentHeader')

    // A body-portaled popover (color picker, variables panel…) — stays open,
    // so formatting applies inside the region.
    const popover = document.createElement('div')
    popover.className = 'document-editor-popup'
    document.body.appendChild(popover)
    fireEvent.mouseDown(popover)
    expect(gate(editor).editing).toBe('documentHeader')
    popover.remove()

    // A toolbar button inside the editor shell — stays open.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Toolbar control' }))
    expect(gate(editor).editing).toBe('documentHeader')

    // Clicking elsewhere IN the document — closes (and the caret is expelled).
    fireEvent.mouseDown(screen.getByText('corpo'))
    expect(gate(editor).editing).toBeNull()

    // Reopen; clicking app chrome OUTSIDE the shell also closes.
    fireEvent.doubleClick(region())
    expect(gate(editor).editing).toBe('documentHeader')
    fireEvent.mouseDown(document.body)
    expect(gate(editor).editing).toBeNull()
  })
})
