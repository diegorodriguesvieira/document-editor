import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('<App /> toolbar', () => {
  it('shows opted-in features, an app-level custom button, and the team IA control', async () => {
    const user = userEvent.setup()
    render(<App />)

    const toolbar = await screen.findByRole('toolbar', { name: 'Formatação' })
    // Feature opt-in.
    expect(within(toolbar).getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    // Level 2: app-level custom button via the children slot.
    expect(within(toolbar).getByRole('button', { name: /HTML/ })).toBeInTheDocument()
    // Full-only features are absent in the basic preset.
    expect(within(toolbar).queryByRole('button', { name: 'Destaque' })).toBeNull()
    expect(within(toolbar).queryByRole('button', { name: /IA/ })).toBeNull()

    // Opt into the full preset → callout + the team's custom-render IA button appear.
    await user.selectOptions(screen.getByLabelText(/Features/), 'full')
    await waitFor(() => {
      const tb = screen.getByRole('toolbar', { name: 'Formatação' })
      expect(within(tb).getByRole('button', { name: 'Destaque' })).toBeInTheDocument()
      expect(within(tb).getByRole('button', { name: /IA/ })).toBeInTheDocument()
    })
  })

  it('swaps to a completely custom toolbar (Level 4) without losing features', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('toolbar', { name: 'Formatação' })

    await user.selectOptions(screen.getByLabelText(/Toolbar/), 'pill')

    await waitFor(() => {
      const pill = document.querySelector('.pill-toolbar')
      expect(pill).not.toBeNull()
      // Same registry data, different skin: bold is still there.
      expect(within(pill as HTMLElement).getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    })
  })
})
