import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InsertToolbar, createMockEditor, resolveFeatures } from '../../editor'
import { jsonHasNode, renderEditor } from '../../test/editorHarness'
import { MergeFieldFeature } from './mergeField'
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
    await user.click(screen.getByRole('button', { name: 'Insert variable' }))
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

    await user.click(screen.getByRole('button', { name: 'Insert variable' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('shows exactly the variables the consumer provides via context', async () => {
    const user = userEvent.setup()
    renderRail([{ id: 'custom.var', label: 'Custom Variable' }])

    await user.click(screen.getByRole('button', { name: 'Insert variable' }))
    expect(screen.getByRole('button', { name: 'Custom Variable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Client name' })).toBeNull()
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
    await user.click(screen.getByRole('button', { name: 'Insert variable' }))
    expect(screen.getByText('Loading variables…')).toBeInTheDocument()

    // Variables arrive from the "API": only the context value changes.
    rerender(ui([{ id: 'a', label: 'Arrived later' }]))
    // Modal stayed open (no remount) and now shows the loaded variable.
    expect(screen.getByRole('button', { name: 'Arrived later' })).toBeInTheDocument()
  })
})
