import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocumentEditor, InsertToolbar, createMockEditor, resolveFeatures } from '../../editor'
import { docWith, jsonHasNode, renderEditor } from '../../test/editorHarness'
import { chipFromSlice, MergeFieldFeature, mergeFieldDragHTML } from './mergeField'
import { DocumentVariablesProvider, type DocumentVariable } from './documentVariables'

const SAMPLE: DocumentVariable[] = [
  { id: 'client.name', label: 'Client name' },
  { id: 'company.name', label: 'Company' },
]

// The bar reads variables from context (the consumer), via the provider.
function renderRail(variables: DocumentVariable[], api = createMockEditor().api) {
  return render(
    <DocumentVariablesProvider variables={variables}>
      <InsertToolbar editor={null} api={api} resolved={resolveFeatures([MergeFieldFeature])} />
    </DocumentVariablesProvider>,
  )
}

describe('mergeField', () => {
  it('opens the @ modal and dispatches insert for the picked variable (no real editor)', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    renderRail(SAMPLE, mock.api)

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    expect(screen.getByRole('dialog', { name: 'Variables' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Client name' }))
    expect(mock.execCalls).toContainEqual({
      commandId: 'mergeField.insert',
      payload: { id: 'client.name', label: 'Client name' },
    })
  })

  it('inserts a mergeField node (+ trailing space) into the document (real editor)', () => {
    const created = renderEditor([MergeFieldFeature], {
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })

    expect(
      created.api.exec('mergeField.insert', { id: 'client.name', label: 'Client name' }),
    ).toBe(true)
    expect(jsonHasNode(created.api.getJSON().doc, 'mergeField')).toBe(true)
    expect(created.api.getHTML()).toContain('data-merge-field="client.name"')

    const paragraph = created.api.getJSON().doc.content?.[0]
    expect(paragraph?.content?.at(-1)).toMatchObject({ type: 'text', text: ' ' })
  })

  it('returns focus to the editor when the modal closes', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    const focusSpy = vi.spyOn(mock.api, 'focus')
    renderRail(SAMPLE, mock.api)

    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('shows exactly the variables the consumer provides via context', async () => {
    const user = userEvent.setup()
    renderRail([{ id: 'custom.var', label: 'Custom Variable' }])

    await user.click(screen.getByRole('button', { name: 'Variables' }))
    expect(screen.getByRole('button', { name: 'Custom Variable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Client name' })).toBeNull()
  })

  it('groups variables by their optional `group` (ungrouped = flat, no header)', async () => {
    const user = userEvent.setup()
    renderRail([
      { id: 'c.nome', label: 'Client name', group: 'Client details' },
      { id: 'k.numero', label: 'Contract number', group: 'Contract details' },
      { id: 'solto', label: 'Ungrouped var' },
    ])

    await user.click(screen.getByRole('button', { name: 'Variables' }))
    expect(screen.getByText('Client details')).toBeInTheDocument()
    expect(screen.getByText('Contract details')).toBeInTheDocument()
    // The ungrouped variable renders without inventing a header for it.
    expect(screen.getByRole('button', { name: 'Ungrouped var' })).toBeInTheDocument()
  })

  it('search filters by label and id', async () => {
    const user = userEvent.setup()
    renderRail(SAMPLE)

    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.type(screen.getByRole('searchbox'), 'client')

    // Matches label ("Client name") and id ("client.name") — Company is out.
    expect(screen.getByRole('button', { name: 'Client name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Company' })).toBeNull()

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText(/No variable matches/)).toBeInTheDocument()
  })

  it('picking inserts AND closes — unless pinned, which keeps it open', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    renderRail(SAMPLE, mock.api)

    // Unpinned: menu semantics — pick closes.
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(screen.getByRole('button', { name: 'Client name' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Pinned: pick twice, panel stays.
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(screen.getByRole('button', { name: 'Pin panel' }))
    await user.click(screen.getByRole('button', { name: 'Client name' }))
    await user.click(screen.getByRole('button', { name: 'Company' }))
    expect(screen.getByRole('dialog', { name: 'Variables' })).toBeInTheDocument()
    expect(mock.execCalls.filter((call) => call.commandId === 'mergeField.insert')).toHaveLength(3)
  })

  it('outside click closes — unless pinned; Escape closes even pinned', async () => {
    const user = userEvent.setup()
    renderRail(SAMPLE)

    // Unpinned: clicking outside (the document body) closes.
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Pinned: outside clicks keep it open…
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(screen.getByRole('button', { name: 'Pin panel' }))
    await user.click(document.body)
    expect(screen.getByRole('dialog', { name: 'Variables' })).toBeInTheDocument()

    // …but Escape is an explicit close and always works.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('chips are draggable and stage the chip HTML as the drag payload', async () => {
    const user = userEvent.setup()
    renderRail(SAMPLE)
    await user.click(screen.getByRole('button', { name: 'Variables' }))

    const chip = screen.getByRole('button', { name: 'Client name' })
    expect(chip).toHaveAttribute('draggable', 'true')

    const staged: Record<string, string> = {}
    const dataTransfer = {
      setData: (type: string, value: string) => {
        staged[type] = value
      },
      effectAllowed: 'none',
    }
    fireEvent.dragStart(chip, { dataTransfer })

    expect(staged['text/html']).toBe(mergeFieldDragHTML(SAMPLE[0]))
    expect(staged['text/html']).toContain('data-merge-field="client.name"')
    expect(staged['text/plain']).toBe('{{Client name}}')
    expect(dataTransfer.effectAllowed).toBe('copy')

    // "Lift" feedback: the source chip fades right away…
    expect(chip.classList.contains('mf-chip--dragging')).toBe(true)
    // …but the panel's step-aside MUST be deferred past the dragstart task:
    // restyling the source's ancestor (pointer-events: none) while Chromium is
    // still initiating the drag ABORTS it (the "can't drag anymore" bug).
    expect(screen.getByRole('dialog').classList.contains('mf-panel--drag-through')).toBe(false)
    await waitFor(() =>
      expect(screen.getByRole('dialog').classList.contains('mf-panel--drag-through')).toBe(true),
    )
    fireEvent.dragEnd(chip)
    // Both recover when the drag ends (dropped or cancelled).
    expect(chip.classList.contains('mf-chip--dragging')).toBe(false)
    expect(screen.getByRole('dialog').classList.contains('mf-panel--drag-through')).toBe(false)
  })

  it('carries the DOCUMENT chip as the drag image, and the ghost leaves the DOM after snapshot', async () => {
    const user = userEvent.setup()
    renderRail(SAMPLE)
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    const chip = screen.getByRole('button', { name: 'Client name' })

    // jsdom's DataTransfer has no setDragImage — the code guards on that. Hand
    // it one to exercise the browser path.
    const setDragImage = vi.fn()
    fireEvent.dragStart(chip, {
      dataTransfer: { setData: () => {}, effectAllowed: 'none', setDragImage },
    })

    expect(setDragImage).toHaveBeenCalledTimes(1)
    const [ghost, offsetX, offsetY] = setDragImage.mock.calls[0] as [HTMLElement, number, number]
    // You drag what you are about to drop: the {{label}} chip, not the button.
    expect(ghost.className).toBe('mf-drag-ghost')
    expect(ghost.textContent).toBe('{{Client name}}')
    expect([offsetX, offsetY]).toEqual([12, 12])
    // The browser snapshots the ghost at dragstart; it must be IN the document
    // then, and free to leave on the next frame.
    expect(document.body.contains(ghost)).toBe(true)
    await waitFor(() => expect(document.body.contains(ghost)).toBe(false))

    fireEvent.dragEnd(chip)
  })

  it('the drag payload parses back into a mergeField chip (what PM does on drop)', () => {
    const created = renderEditor([MergeFieldFeature], {
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    // PM's native drop = parse text/html through the schema; insertContent
    // exercises that same parse pipeline.
    created.editor.commands.insertContent(
      mergeFieldDragHTML({ id: 'client.name', label: 'Client name' }),
    )
    const paragraph = created.api.getJSON().doc.content?.[0]
    expect(paragraph?.content?.[0]).toMatchObject({
      type: 'mergeField',
      attrs: { id: 'client.name', label: 'Client name' },
    })
  })

  it('attribute-escapes hostile ids/labels in the drag payload and round-trips them', () => {
    const hostile = { id: 'a"b', label: 'x" onmouseover="alert(1)' }
    const html = mergeFieldDragHTML(hostile)
    expect(html).toContain('data-merge-field="a&quot;b"')
    // The quotes must not break out of attribute position: re-parsing the
    // payload yields ONLY the two data-* attributes, values intact.
    const host = document.createElement('div')
    host.innerHTML = html
    const span = host.firstElementChild!
    expect(span.getAttributeNames().sort()).toEqual(['data-label', 'data-merge-field'])
    expect(span.getAttribute('data-label')).toBe(hostile.label)

    const created = renderEditor([MergeFieldFeature], {
      content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })
    created.editor.commands.insertContent(html)
    const paragraph = created.api.getJSON().doc.content?.[0]
    expect(paragraph?.content?.[0]).toMatchObject({ type: 'mergeField', attrs: hostile })
  })

  it('recovers the panel even if the dragged chip unmounts mid-drag (document-level reset)', async () => {
    const user = userEvent.setup()
    const api = createMockEditor().api
    const ui = (variables: DocumentVariable[]) => (
      <DocumentVariablesProvider variables={variables}>
        <InsertToolbar editor={null} api={api} resolved={resolveFeatures([MergeFieldFeature])} />
      </DocumentVariablesProvider>
    )
    const { rerender } = render(ui(SAMPLE))
    await user.click(screen.getByRole('button', { name: 'Variables' }))

    const chip = screen.getByRole('button', { name: 'Client name' })
    fireEvent.dragStart(chip, {
      dataTransfer: { setData: () => {}, effectAllowed: 'none' },
    })
    await waitFor(() =>
      expect(screen.getByRole('dialog').classList.contains('mf-panel--drag-through')).toBe(true),
    )

    // The consumer's variable list updates mid-drag: the dragged chip unmounts,
    // so its own onDragEnd handler will never run.
    rerender(ui([{ id: 'other', label: 'Other' }]))
    expect(screen.queryByRole('button', { name: 'Client name' })).toBeNull()

    // The drag still ends SOMEWHERE (drop on the page, dragend on <body>) —
    // the document-level capture listener restores the panel.
    fireEvent.drop(document.body)
    expect(screen.getByRole('dialog').classList.contains('mf-panel--drag-through')).toBe(false)
  })

  it('anchors the panel to the STICKY .insert-rail, not the full-height rail wrapper', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DocumentVariablesProvider variables={SAMPLE}>
        <DocumentEditor features={[MergeFieldFeature]} />
      </DocumentVariablesProvider>,
    )
    const stickyBar = container.querySelector('.insert-rail') as HTMLElement
    const wrapper = container.querySelector('.document-editor__rail') as HTMLElement
    expect(stickyBar).not.toBeNull()
    expect(wrapper).not.toBeNull()
    const rectAt = (top: number, right: number) =>
      ({ top, right, left: right - 48, bottom: top + 300, width: 48, height: 300, x: right - 48, y: top, toJSON: () => ({}) }) as DOMRect
    // Simulate a scrolled document: the sticky bar is pinned at 72px while the
    // full-height wrapper has scrolled far above the viewport.
    stickyBar.getBoundingClientRect = () => rectAt(72, 60)
    wrapper.getBoundingClientRect = () => rectAt(-400, 60)

    await user.click(screen.getByRole('button', { name: 'Variables' }))
    const dialog = screen.getByRole('dialog', { name: 'Variables' })
    // Anchored to the sticky bar (72px / right+12) — NOT dragged to -400px by
    // the scrolling wrapper (the "panel rides the paper" bug).
    expect(dialog.style.top).toBe('72px')
    expect(dialog.style.left).toBe('72px')
  })

  it('updates the modal when variables arrive later — same feature, no remount', async () => {
    const user = userEvent.setup()
    const api = createMockEditor().api
    const ui = (variables: DocumentVariable[]) => (
      <DocumentVariablesProvider variables={variables}>
        <InsertToolbar editor={null} api={api} resolved={resolveFeatures([MergeFieldFeature])} />
      </DocumentVariablesProvider>
    )

    // Starts empty (still "loading").
    const { rerender } = render(ui([]))
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    expect(screen.getByText('Loading variables…')).toBeInTheDocument()

    // Variables arrive from the "API": only the context value changes.
    rerender(ui([{ id: 'a', label: 'Arrived later' }]))
    // Modal stayed open (no remount) and now shows the loaded variable.
    expect(screen.getByRole('button', { name: 'Arrived later' })).toBeInTheDocument()
  })
})

describe('drop → caret to the right of the chip', () => {
  it('chipFromSlice accepts a bare chip or one chip alone in a paragraph — nothing richer', async () => {
    const { DOMParser } = await import('@tiptap/pm/model')
    const created = renderEditor([MergeFieldFeature])
    const parse = (html: string) => {
      const el = document.createElement('div')
      el.innerHTML = html
      return DOMParser.fromSchema(created.editor.schema).parseSlice(el)
    }

    const bare = parse(mergeFieldDragHTML(SAMPLE[0]))
    expect(chipFromSlice(bare)?.attrs.id).toBe('client.name')

    const inParagraph = parse(`<p>${mergeFieldDragHTML(SAMPLE[0])}</p>`)
    expect(chipFromSlice(inParagraph)?.attrs.id).toBe('client.name')

    const richer = parse(`<p>texto ${mergeFieldDragHTML(SAMPLE[0])}</p>`)
    expect(chipFromSlice(richer)).toBeNull()
  })

  /** A mounted editor + the pieces a drop needs: a parsed payload slice and a
   *  stubbed posAtCoords (jsdom has no layout to resolve pixel coordinates). */
  async function dropRig(text = 'Hello') {
    const { DOMParser } = await import('@tiptap/pm/model')
    const created = renderEditor([MergeFieldFeature], { content: docWith(text) })
    const view = created.editor.view
    const parse = (html: string) => {
      const el = document.createElement('div')
      el.innerHTML = html
      return DOMParser.fromSchema(created.editor.schema).parseSlice(el)
    }
    // Dispatch exactly like ProseMirror's own drop path does: through the
    // handleDrop prop chain.
    const drop = (slice: ReturnType<typeof parse>, moved = false) =>
      view.someProp('handleDrop', (handler) =>
        handler(view, new MouseEvent('drop', { clientX: 10, clientY: 10 }) as DragEvent, slice, moved),
      )
    return { created, view, parse, drop }
  }

  it('handleDrop inserts the chip + a space and lands the caret right after them', async () => {
    const { created, view, parse, drop } = await dropRig('Hello')
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 3, inside: 0 }) // between "He" and "llo"
    const focus = vi.spyOn(view, 'focus')

    expect(drop(parse(mergeFieldDragHTML(SAMPLE[0])))).toBe(true)

    const paragraph = created.api.getJSON().doc.content?.[0]
    expect(paragraph?.content).toMatchObject([
      { type: 'text', text: 'He' },
      { type: 'mergeField', attrs: { id: 'client.name', label: 'Client name' } },
      { type: 'text', text: ' llo' }, // the trailing space rides with the rest
    ])
    // Caret: insert(3) + chip(1) + space(1) → typing continues after the gap,
    // never with the chip node-selected (PM's default drop behavior).
    expect(created.editor.state.selection.empty).toBe(true)
    expect(created.editor.state.selection.from).toBe(5)
    expect(focus).toHaveBeenCalled()
  })

  it('pops the landing animation on the dropped chip and cleans the class up after it runs', async () => {
    const { view, parse, drop } = await dropRig()
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
    drop(parse(mergeFieldDragHTML(SAMPLE[0])))

    // Scoped to THIS drop — a load/undo recreating node views must not animate.
    const chip = view.dom.querySelector('.merge-field--dropped')
    expect(chip).not.toBeNull()
    fireEvent.animationEnd(chip!)
    expect(view.dom.querySelector('.merge-field--dropped')).toBeNull()
  })

  it('an internal drag (moved) falls through to ProseMirror move semantics', async () => {
    const { created, view, parse, drop } = await dropRig()
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 3, inside: 0 })
    const before = created.editor.state

    expect(drop(parse(mergeFieldDragHTML(SAMPLE[0])), true)).toBeFalsy()
    expect(created.editor.state).toBe(before) // untouched — PM does the move
  })

  it('anything richer than one chip falls through to the default drop', async () => {
    const { created, view, parse, drop } = await dropRig()
    vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 3, inside: 0 })
    const before = created.editor.state

    expect(drop(parse(`<p>texto ${mergeFieldDragHTML(SAMPLE[0])}</p>`))).toBeFalsy()
    expect(created.editor.state).toBe(before)
  })

  it('bails when the drop coordinates do not resolve to a document position', async () => {
    const { created, view, parse, drop } = await dropRig()
    vi.spyOn(view, 'posAtCoords').mockReturnValue(null)
    const before = created.editor.state

    expect(drop(parse(mergeFieldDragHTML(SAMPLE[0])))).toBeFalsy()
    expect(created.editor.state).toBe(before)
  })
})
