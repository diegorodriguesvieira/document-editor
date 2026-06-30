import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenuView } from './EditorContextMenu'
import type { ContextMenuGroup } from '../core/types'

const GROUPS: ContextMenuGroup[] = [
  {
    id: 'row',
    label: 'Linha',
    items: [
      { id: 'above', label: 'Inserir linha acima', icon: '↑', commandId: 'table.addRowBefore' },
      { id: 'del-row', label: 'Excluir linha', icon: '🗑', commandId: 'table.deleteRow', danger: true },
    ],
  },
  {
    id: 'table',
    items: [{ id: 'del-table', label: 'Excluir tabela', commandId: 'table.delete', danger: true }],
  },
]

describe('<ContextMenuView />', () => {
  it('renders grouped items with a heading and runs the command on click', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    render(<ContextMenuView x={10} y={10} groups={GROUPS} onRun={onRun} onClose={() => {}} />)

    expect(screen.getByText('Linha')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Inserir linha acima/ })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Excluir tabela/ }))
    expect(onRun).toHaveBeenCalledWith('table.delete')
  })

  it('marks destructive items with the danger class', () => {
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: /Excluir linha/ })).toHaveClass(
      'context-menu__item--danger',
    )
  })

  it('closes on Escape and on outside click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ContextMenuView x={0} y={0} groups={GROUPS} onRun={() => {}} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
