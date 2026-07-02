import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InsertToolbar, createMockEditor, resolveFeatures } from '../../editor'
import { jsonHasNode, renderEditor } from '../../test/editorHarness'
import { MergeFieldFeature, mergeFieldDragHTML } from './mergeField'
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
