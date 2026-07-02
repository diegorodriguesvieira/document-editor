import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SlashMenu } from './SlashMenu'
import type { SuggestionPopupRef } from '../hooks/createSuggestionPopup'
import type { ToolbarItem } from '../core/types'

const ITEMS: ToolbarItem[] = [
  { id: 'h1', label: 'Heading 1', icon: 'H1', commandId: 'heading.h1' },
  { id: 'quote', label: 'Quote', icon: 'Q', commandId: 'quote.toggle' },
  { id: 'table', label: 'Table', icon: 'T', commandId: 'table.insert' },
]

describe('<SlashMenu />', () => {
  it('renders the items and runs the command on click', async () => {
    const user = userEvent.setup()
    const command = vi.fn()
    render(<SlashMenu items={ITEMS} command={command} />)

    expect(screen.getByRole('option', { name: /Heading 1/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Table/ }))
    expect(command).toHaveBeenCalledWith(ITEMS[2])
  })

  it('navigates with the keyboard and selects with Enter (via the ref)', () => {
    const command = vi.fn()
    const ref = createRef<SuggestionPopupRef>()
    render(<SlashMenu ref={ref} items={ITEMS} command={command} />)

    const press = (key: string) =>
      act(() => {
        ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key }) })
      })

    expect(screen.getByRole('option', { name: /Heading 1/ })).toHaveAttribute('aria-selected', 'true')

    press('ArrowDown') // → Quote
    press('ArrowDown') // → Table
    expect(screen.getByRole('option', { name: /Table/ })).toHaveAttribute('aria-selected', 'true')

    press('Enter')
    expect(command).toHaveBeenCalledWith(ITEMS[2])
  })

  it('shows an empty state when nothing matches', () => {
    render(<SlashMenu items={[]} command={() => {}} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })
})
