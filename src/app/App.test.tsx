import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('<App /> toolbar', () => {
  it('defaults to the full preset; switching to basic hides the full-only features', async () => {
    const user = userEvent.setup()
    render(<App />)

    // The bubble toolbar is the default now (shows on selection); switch to the
    // static toolbar so we can assert on its buttons directly.
    await user.selectOptions(screen.getByLabelText(/Toolbar/), 'default')
    const toolbar = await screen.findByRole('toolbar', { name: 'Formatação' })
    // Full preset is the default: bold + the app-level HTML button + team features.
    expect(within(toolbar).getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /HTML/ })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Destaque' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /IA/ })).toBeInTheDocument()

    // Switch to the basic preset → the full-only features disappear.
    await user.selectOptions(screen.getByLabelText(/Features/), 'basic')
    await waitFor(() => {
      const tb = screen.getByRole('toolbar', { name: 'Formatação' })
      expect(within(tb).queryByRole('button', { name: 'Destaque' })).toBeNull()
      expect(within(tb).queryByRole('button', { name: /IA/ })).toBeNull()
      expect(within(tb).getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    })
  })

  it('swaps to a completely custom toolbar (Level 4) without losing features', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(await screen.findByLabelText(/Toolbar/), 'pill')

    await waitFor(() => {
      const pill = document.querySelector('.pill-toolbar')
      expect(pill).not.toBeNull()
      // Same registry data, different skin: bold is still there.
      expect(within(pill as HTMLElement).getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    })
  })

  it('zooms the document in and out via the right rail', async () => {
    const user = userEvent.setup()
    render(<App />)

    const zoomRail = await screen.findByRole('toolbar', { name: 'Zoom' })
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()

    await user.click(within(zoomRail).getByRole('button', { name: 'Aumentar zoom' }))
    expect(within(zoomRail).getByText('110%')).toBeInTheDocument()

    await user.click(within(zoomRail).getByRole('button', { name: 'Diminuir zoom' }))
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()
  })
})
