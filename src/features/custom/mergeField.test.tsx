import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import {
  InsertToolbar,
  createEditor,
  createMockEditor,
  resolveFeatures,
  type CreatedEditor,
} from '../../editor'
import { MergeFieldFeature, MergeFieldVariablesProvider, type MergeVariable } from './mergeField'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function hasNode(node: JSONContent, type: string): boolean {
  if (node.type === type) return true
  return node.content?.some((child) => hasNode(child, type)) ?? false
}

const SAMPLE: MergeVariable[] = [
  { id: 'client.name', label: 'Nome do cliente' },
  { id: 'company.name', label: 'Empresa' },
]

// The bar reads variables from context (the consumer), via the provider.
function renderRail(variables: MergeVariable[], api = createMockEditor().api) {
  return render(
    <MergeFieldVariablesProvider variables={variables}>
      <InsertToolbar editor={null} api={api} resolved={resolveFeatures([MergeFieldFeature])} />
    </MergeFieldVariablesProvider>,
  )
}

describe('mergeField', () => {
  it('opens the @ modal and dispatches insert for the picked variable (no real editor)', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    renderRail(SAMPLE, mock.api)

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Inserir variável' }))
    expect(screen.getByRole('dialog', { name: 'Variáveis' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nome do cliente' }))
    expect(mock.execCalls).toContainEqual({
      commandId: 'mergeField.insert',
      payload: { id: 'client.name', label: 'Nome do cliente' },
    })
  })

  it('inserts a mergeField node (+ trailing space) into the document (real editor)', () => {
    created = createEditor({
      features: [MergeFieldFeature],
      element: mountTarget(),
      content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
    })

    expect(
      created.api.exec('mergeField.insert', { id: 'client.name', label: 'Nome do cliente' }),
    ).toBe(true)
    expect(hasNode(created.api.getJSON().doc, 'mergeField')).toBe(true)
    expect(created.api.getHTML()).toContain('data-merge-field="client.name"')

    const paragraph = created.api.getJSON().doc.content?.[0]
    expect(paragraph?.content?.at(-1)).toMatchObject({ type: 'text', text: ' ' })
  })

  it('returns focus to the editor when the modal closes', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    const focusSpy = vi.spyOn(mock.api, 'focus')
    renderRail(SAMPLE, mock.api)

    await user.click(screen.getByRole('button', { name: 'Inserir variável' }))
    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('shows exactly the variables the consumer provides via context', async () => {
    const user = userEvent.setup()
    renderRail([{ id: 'custom.var', label: 'Variável Custom' }])

    await user.click(screen.getByRole('button', { name: 'Inserir variável' }))
    expect(screen.getByRole('button', { name: 'Variável Custom' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nome do cliente' })).toBeNull()
  })

  it('updates the modal when variables arrive later — same feature, no remount', async () => {
    const user = userEvent.setup()
    const api = createMockEditor().api
    const ui = (variables: MergeVariable[]) => (
      <MergeFieldVariablesProvider variables={variables}>
        <InsertToolbar editor={null} api={api} resolved={resolveFeatures([MergeFieldFeature])} />
      </MergeFieldVariablesProvider>
    )

    // Starts empty (still "loading").
    const { rerender } = render(ui([]))
    await user.click(screen.getByRole('button', { name: 'Inserir variável' }))
    expect(screen.getByText('Carregando variáveis…')).toBeInTheDocument()

    // Variables arrive from the "API": only the context value changes.
    rerender(ui([{ id: 'a', label: 'Chegou Depois' }]))
    // Modal stayed open (no remount) and now shows the loaded variable.
    expect(screen.getByRole('button', { name: 'Chegou Depois' })).toBeInTheDocument()
  })
})
