import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SlashMenu, type SlashMenuRef } from './SlashMenu'
import type { ToolbarItem } from '../core/types'

const ITEMS: ToolbarItem[] = [
  { id: 'h1', label: 'Título 1', icon: 'H1', commandId: 'heading.h1' },
  { id: 'quote', label: 'Citação', icon: 'Q', commandId: 'quote.toggle' },
  { id: 'table', label: 'Tabela', icon: 'T', commandId: 'table.insert' },
]

describe('<SlashMenu />', () => {
  it('renders the items and runs the command on click', async () => {
    const user = userEvent.setup()
    const command = vi.fn()
    render(<SlashMenu items={ITEMS} command={command} />)

    expect(screen.getByRole('option', { name: /Título 1/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Tabela/ }))
    expect(command).toHaveBeenCalledWith(ITEMS[2])
  })

  it('navigates with the keyboard and selects with Enter (via the ref)', () => {
    const command = vi.fn()
    const ref = createRef<SlashMenuRef>()
    render(<SlashMenu ref={ref} items={ITEMS} command={command} />)

    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
      })

    expect(screen.getByRole('option', { name: /Título 1/ })).toHaveAttribute('aria-selected', 'true')

    press('ArrowDown') // → Citação
    press('ArrowDown') // → Tabela
    expect(screen.getByRole('option', { name: /Tabela/ })).toHaveAttribute('aria-selected', 'true')

    press('Enter')
    expect(command).toHaveBeenCalledWith(ITEMS[2])
  })

  it('shows an empty state when nothing matches', () => {
    render(<SlashMenu items={[]} command={() => {}} />)
    expect(screen.getByText('Nada encontrado')).toBeInTheDocument()
  })
})
