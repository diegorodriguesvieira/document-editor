import { createRef, type Ref } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MergeFieldMenu, type MergeFieldMenuRef } from './mergeFieldSuggestion'
import { DocumentVariablesProvider, type DocumentVariable } from './documentVariables'

const VARS: DocumentVariable[] = [
  { id: 'cliente.nome', label: 'Nome do cliente' },
  { id: 'cliente.cnpj', label: 'CNPJ' },
  { id: 'contrato.numero', label: 'Número do contrato' },
]

function renderMenu(
  query: string,
  onPick: (variable: DocumentVariable) => void = vi.fn(),
  ref?: Ref<MergeFieldMenuRef>,
) {
  return render(
    <DocumentVariablesProvider variables={VARS}>
      <MergeFieldMenu ref={ref} query={query} onPick={onPick} />
    </DocumentVariablesProvider>,
  )
}

describe('<MergeFieldMenu />', () => {
  it('lists every variable from context when the query is empty', () => {
    renderMenu('')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('filters to labels that start with the typed query', () => {
    renderMenu('cli') // the "cliente" word of "Nome do cliente"
    expect(screen.getByRole('option', { name: /Nome do cliente/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /CNPJ/ })).toBeNull()
  })

  it('shows an empty state when nothing matches', () => {
    renderMenu('zzz')
    expect(screen.getByText('Nenhuma variável encontrada')).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('picks a variable on click', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderMenu('', onPick)
    await user.click(screen.getByRole('option', { name: /CNPJ/ }))
    expect(onPick).toHaveBeenCalledWith(VARS[1])
  })

  it('navigates with the keyboard and selects with Enter (via the ref)', () => {
    const onPick = vi.fn()
    const ref = createRef<MergeFieldMenuRef>()
    renderMenu('', onPick, ref)
    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
      })

    press('ArrowDown') // → CNPJ
    press('Enter')
    expect(onPick).toHaveBeenCalledWith(VARS[1])
  })
})
