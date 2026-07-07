import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { DocumentEditor, type CreatedEditor, type DocumentJSON, type EditorApi } from '../../editor'
import { DividerFeature, ImageFeature } from '../../features'
import { dispatchDrop, docWith, editorFromDOM, parseSliceFromHTML, renderEditor } from '../../test/editorHarness'
import { closeRegion, HeaderFooterFeature } from './headerFooter'
import { MergeFieldFeature, mergeFieldDragHTML } from './mergeField'

const newEditor = () => renderEditor([HeaderFooterFeature])
const content = (created: CreatedEditor) => created.api.getJSON().doc.content ?? []
const gate = (editor: Editor) =>
  (editor.storage as unknown as { headerFooterGuard: { editing: string | null } }).headerFooterGuard
/** Fixture builders — every region/body doc in this file composes these. */
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const region = (type: string, text: string) => ({ type, content: [para(text)] })
/** The canonical sealed doc: [header 'head', body, footer 'foot']. */
const regionsDoc = (...body: unknown[]) =>
  ({
    doc: {
      type: 'doc',
      content: [region('documentHeader', 'head'), ...body, region('documentFooter', 'foot')],
    },
  }) as DocumentJSON
const REGIONS_DOC = regionsDoc(para('body'))

// A REAL keydown (commands.keyboardShortcut replays only captured steps —
// the Mod-A override must be exercised through the DOM path it ships on).
const pressModA = (editor: Editor) =>
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
  )

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
    created.api.setJSON(regionsDoc(para('body one'), para('body two')))
    const doc = created.editor.state.doc
    const headerSize = doc.firstChild!.nodeSize
    const footerSize = doc.lastChild!.nodeSize

    created.editor.commands.focus()
    created.editor.commands.setTextSelection(headerSize + 3) // caret in the body
    pressModA(created.editor)

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

    pressModA(created.editor)

    const { from, to } = created.editor.state.selection
    const selected = created.editor.state.doc.textBetween(from, to, ' ')
    expect(selected).toBe('head')
  })

  it('keyboard/selection cannot enter a CLOSED region — the caret is clamped back to the body', async () => {
    const created = newEditor()
    created.api.setJSON(REGIONS_DOC)
    const view = created.editor.view
    const headerSize = view.state.doc.firstChild!.nodeSize

    // What arrows/shift-selection do under the hood: a selection into the region.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    // …gets clamped back to the body start.
    expect(created.editor.state.selection.from).toBe(headerSize + 1)
  })

  it('Cmd+A in the body includes a leading IMAGE — Delete removes it and restores an empty body', () => {
    const created = renderEditor([HeaderFooterFeature, ImageFeature])
    created.api.setJSON(
      regionsDoc({ type: 'image', attrs: { src: 'data:,logo' } }, para('texto do corpo')),
    )
    const doc = created.editor.state.doc
    const headerSize = doc.firstChild!.nodeSize
    const imageSize = doc.child(1).nodeSize

    created.editor.commands.focus()
    created.editor.commands.setTextSelection(headerSize + imageSize + 2) // caret no corpo
    pressModA(created.editor)

    // A seleção começa ANTES da imagem (TextSelection a pularia).
    expect(created.editor.state.selection.from).toBe(headerSize)
    expect(created.editor.state.selection.from).toBeLessThanOrEqual(headerSize + imageSize - 1)

    created.editor.commands.deleteSelection()
    const nodes = created.api.getJSON().doc.content ?? []
    expect(nodes.some((n) => n.type === 'image')).toBe(false)
    // Regiões intactas + corpo restaurado com um parágrafo vazio editável.
    expect(nodes.map((n) => n.type)).toEqual(['documentHeader', 'paragraph', 'documentFooter'])
    const bounds = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBe(bounds + 1) // caret no corpo
  })

  it('deleting ALL of an open region keeps the caret inside it (typing refills the region)', () => {
    const created = newEditor()
    created.api.exec('header.add')
    created.editor.commands.insertContent('titulo aqui')

    // Cmd+A inside the region, then delete everything.
    created.editor.commands.focus()
    pressModA(created.editor)
    created.editor.commands.deleteSelection()

    // The header is empty but the caret must still be INSIDE it…
    const headerSize = created.editor.state.doc.firstChild!.nodeSize
    expect(created.editor.state.selection.from).toBeLessThan(headerSize)

    // …so typing refills the header, not the body.
    created.editor.commands.insertContent('NOVO')
    const nodes = created.api.getJSON().doc.content ?? []
    expect(nodes[0]?.content?.[0]?.content?.[0]?.text).toBe('NOVO')
  })

  it('an OPEN region admits the caret; closeRegion expels it and seals the region', async () => {
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
    const created = newEditor()
    created.api.setJSON(REGIONS_DOC)
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

    pressModA(created.editor)

    // The whole document, node boundaries included (PM's AllSelection).
    expect(created.editor.state.selection.from).toBe(0)
    expect(created.editor.state.selection.to).toBe(created.editor.state.doc.content.size)
  })

  it('the body select-all survives a JSON round-trip (RangeSelection is serializable)', async () => {
    const created = newEditor()
    created.api.setJSON(regionsDoc(para('corpo')))
    created.editor.commands.focus()
    created.editor.commands.setTextSelection(created.editor.state.doc.firstChild!.nodeSize + 2)
    pressModA(created.editor)

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

describe('header/footer guard — closed regions are sealed on EVERY path', () => {
  it('a selection anchored in the OPEN header cannot reach into the closed footer', async () => {
    const created = newEditor()
    created.api.setJSON(REGIONS_DOC)
    gate(created.editor).editing = 'documentHeader' // header open, footer closed
    const view = created.editor.view
    const doc = view.state.doc
    const footerFrom = doc.content.size - doc.lastChild!.nodeSize

    // Shift-End style extension: anchor inside the open header, head inside
    // the closed footer — the second endpoint used to go unchecked, letting
    // Delete erase closed-footer content in one gesture.
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(doc, 2, doc.content.size - 2),
      ),
    )
    const { from, to } = created.editor.state.selection
    expect(from).toBeGreaterThanOrEqual(doc.firstChild!.nodeSize)
    expect(to).toBeLessThanOrEqual(footerFrom)
  })

  it('clamping prefers the body\'s first TEXT — a leading image must not end up node-selected', async () => {
    const created = renderEditor([HeaderFooterFeature, ImageFeature])
    created.api.setJSON(
      regionsDoc({ type: 'image', attrs: { src: 'data:,logo' } }, para('Contrato')),
    )
    const view = created.editor.view

    // A selection landing in the closed header (what a load's mapped
    // selection produces): the clamp resolves at the image's block boundary —
    // it must settle on the first body TEXT, not node-select the image.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))

    const selection = created.editor.state.selection
    expect(selection instanceof NodeSelection).toBe(false)
    expect(selection.empty).toBe(true)
    expect(view.state.doc.resolve(selection.from).parent.textContent).toBe('Contrato')
    expect(view.dom.querySelector('.image-resizer--selected')).toBeNull()
  })

  it('clamping never lands INSIDE a closed region when the body has no text position', async () => {
    const created = renderEditor([HeaderFooterFeature, DividerFeature])
    created.api.setJSON(
      regionsDoc({ type: 'horizontalRule' } /* leaf-only body: no text position at all */),
    )
    const view = created.editor.view
    const headerSize = view.state.doc.firstChild!.nodeSize

    // A selection aimed into the closed footer: the naive body clamp inverts
    // (bodyTo < bodyFrom over a leaf-only body) and used to walk the caret
    // INTO the footer. It must land on the body's node instead.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 2)),
    )
    const selection = created.editor.state.selection
    expect(selection instanceof NodeSelection).toBe(true)
    expect(selection.from).toBe(headerSize)
    expect(view.state.doc.nodeAt(headerSize)?.type.name).toBe('horizontalRule')
  })

  it('drops into a CLOSED region are swallowed; an OPEN region accepts them', async () => {
    const created = newEditor()
    created.api.setJSON(REGIONS_DOC)
    const view = created.editor.view
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 0 }) // inside the header
    const drop = () =>
      dispatchDrop(view, null)

    expect(drop()).toBe(true) // closed → swallowed, nothing written
    gate(created.editor).editing = 'documentHeader'
    expect(drop()).toBeFalsy() // open → falls through to the default insert
  })

  it('outranks feature drop handlers: a chip drop into a closed header is blocked regardless of feature order', async () => {
    // MergeField listed FIRST — only the guard's priority puts it in front.
    const created = renderEditor([MergeFieldFeature, HeaderFooterFeature])
    created.api.setJSON(REGIONS_DOC)
    const view = created.editor.view
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 0 })
    const slice = parseSliceFromHTML(created.editor, mergeFieldDragHTML({ id: 'x', label: 'X' }))
    const before = created.editor.state

    const handled = dispatchDrop(view, slice)

    expect(handled).toBe(true) // the guard claimed it…
    expect(created.editor.state).toBe(before) // …and nothing was inserted
  })
})

describe('header/footer node view (the React chrome)', () => {
  // Header-only (no footer): the node-view tests double-click INTO the header.
  const REGION_DOC = {
    doc: { type: 'doc', content: [region('documentHeader', 'head'), para('corpo')] },
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
    const editor = editorFromDOM()
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

describe('closed regions cannot be deleted or entered via NodeSelection paths', () => {

  it('Backspace/Delete at the body edges cannot node-select a closed region (selectable: false)', async () => {
    // PM's Backspace chain ends in selectNodeBackward: with a selectable
    // region, TWO plain Backspaces at the body start deleted the whole
    // header (select, then delete). Non-selectable makes it a no-op.
    const created = renderEditor([HeaderFooterFeature])
    created.api.setJSON(REGIONS_DOC)
    const view = created.editor.view
    const headerSize = view.state.doc.firstChild!.nodeSize

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headerSize + 1)))
    expect(created.editor.commands.selectNodeBackward()).toBe(false)
    expect(created.editor.state.selection instanceof NodeSelection).toBe(false)

    const bodyEnd = view.state.doc.content.size - view.state.doc.lastChild!.nodeSize - 2
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyEnd)))
    expect(created.editor.commands.selectNodeForward()).toBe(false)
    expect(created.editor.state.selection instanceof NodeSelection).toBe(false)

    const nodes = created.api.getJSON().doc.content ?? []
    expect(nodes[0]?.type).toBe('documentHeader')
    expect(nodes[nodes.length - 1]?.type).toBe('documentFooter')
  })

  it('a PROGRAMMATIC NodeSelection of a closed region is expelled by the gate', async () => {
    // NodeSelection.create ignores `selectable` — the gate is the second
    // seal: the region-wrapping selection (endpoints at depth 0, invisible
    // to the endpoint walk) must clamp back to the body.
    const created = renderEditor([HeaderFooterFeature])
    created.api.setJSON(REGIONS_DOC)
    const view = created.editor.view

    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))

    const selection = created.editor.state.selection
    expect(selection instanceof NodeSelection).toBe(false)
    expect(view.state.doc.resolve(selection.from).parent.textContent).toBe('body')
    expect(created.api.getJSON().doc.content?.[0]?.type).toBe('documentHeader')
  })

  it('the normalizer clamps its OWN rewrite — a region paste cannot strand the caret in a closed region', async () => {
    // PM never re-runs appendTransaction on a plugin's own appended tr: the
    // full-doc rewrite used to park the mapped selection inside the closed
    // footer, and the NEXT keystroke wrote there before the gate expelled it.
    const created = renderEditor([HeaderFooterFeature])
    created.api.setJSON(regionsDoc(para('body one'), para('body two')))
    const view = created.editor.view
    const headerSize = view.state.doc.firstChild!.nodeSize
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headerSize + 5)))

    // External-HTML paste shape: a duplicate header lands mid-body and the
    // normalizer rewrites the whole doc.
    created.editor.commands.insertContent('<div data-document-header><p>PASTED</p></div>')

    const { doc, selection } = created.editor.state
    const bounds = { from: doc.firstChild!.nodeSize, to: doc.content.size - doc.lastChild!.nodeSize }
    expect(selection.from).toBeGreaterThanOrEqual(bounds.from)
    expect(selection.to).toBeLessThanOrEqual(bounds.to)

    // The next keystroke must land in the BODY, never the sealed regions.
    created.editor.commands.insertContent('X')
    const nodes = created.api.getJSON().doc.content ?? []
    const text = (node: any) => JSON.stringify(node)
    expect(text(nodes[0])).not.toContain('X')
    expect(text(nodes[nodes.length - 1])).not.toContain('X')
    expect(text(nodes)).toContain('X')
  })
})
