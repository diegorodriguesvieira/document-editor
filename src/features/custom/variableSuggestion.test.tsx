import { createRef, type Ref } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VariableMenu, variableInsertContent } from './variableSuggestion'
import type { SuggestionPopupRef } from '../../editor'
import { DocumentVariablesProvider, type DocumentVariable } from './documentVariables'

const VARS: DocumentVariable[] = [
  { id: 'cliente.nome', label: 'Client name' },
  { id: 'cliente.cnpj', label: 'Tax ID' },
  { id: 'contrato.numero', label: 'Contract number' },
]

function renderMenu(
  query: string,
  onPick: (variable: DocumentVariable) => void = vi.fn(),
  ref?: Ref<SuggestionPopupRef>,
) {
  return render(
    <DocumentVariablesProvider variables={VARS}>
      <VariableMenu ref={ref} query={query} command={onPick} />
    </DocumentVariablesProvider>,
  )
}

describe('<VariableMenu />', () => {
  it('lists every variable from context when the query is empty', () => {
    renderMenu('')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('hides condition flags — the @ list only offers insertable variables', () => {
    render(
      <DocumentVariablesProvider
        variables={VARS}
        conditions={[{ id: 'EC_DECISION_FULLTIME', label: 'If contract is full-time' }]}
      >
        <VariableMenu query="" command={vi.fn()} />
      </DocumentVariablesProvider>,
    )
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.queryByRole('option', { name: /If contract is full-time/ })).toBeNull()
  })

  it('filters to labels that start with the typed query', () => {
    renderMenu('cli') // matches "Client name" only
    expect(screen.getByRole('option', { name: /Client name/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Tax ID/ })).toBeNull()
  })

  it('shows an empty state when nothing matches', () => {
    renderMenu('zzz')
    expect(screen.getByText('No variables found')).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('picks a variable on click', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderMenu('', onPick)
    await user.click(screen.getByRole('option', { name: /Tax ID/ }))
    expect(onPick).toHaveBeenCalledWith(VARS[1])
  })

  it('navigates with the keyboard and selects with Enter (via the ref)', () => {
    const onPick = vi.fn()
    const ref = createRef<SuggestionPopupRef>()
    renderMenu('', onPick, ref)
    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
      })

    press('ArrowDown') // → Tax ID
    press('Enter')
    expect(onPick).toHaveBeenCalledWith(VARS[1])
  })
})

describe('variableInsertContent', () => {
  it('a signature-typed catalog entry inserts the dedicated signature NODE', () => {
    expect(variableInsertContent({ id: 'a', label: 'A', type: 'signature' })[0]).toEqual({
      type: 'signature',
      attrs: { id: 'a', label: 'A' },
    })
  })

  it("absent and default 'text' types insert a plain variable node — no type attr anywhere", () => {
    expect(variableInsertContent({ id: 'a', label: 'A' })[0]).toEqual({
      type: 'variable',
      attrs: { id: 'a', label: 'A' },
    })
    expect(variableInsertContent({ id: 'a', label: 'A', type: 'text' })[0]).toEqual({
      type: 'variable',
      attrs: { id: 'a', label: 'A' },
    })
  })
})
