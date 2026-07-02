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
    const toolbar = await screen.findByRole('toolbar', { name: 'Formatting' })
    // Full preset is the default: bold + the app-level HTML button + team features.
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /HTML/ })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Callout' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Comment' })).toBeInTheDocument()

    // Switch to the basic preset → the full-only features disappear.
    await user.selectOptions(screen.getByLabelText(/Features/), 'basic')
    await waitFor(() => {
      const tb = screen.getByRole('toolbar', { name: 'Formatting' })
      expect(within(tb).queryByRole('button', { name: 'Callout' })).toBeNull()
      expect(within(tb).queryByRole('button', { name: 'Comment' })).toBeNull()
      expect(within(tb).getByRole('button', { name: 'Bold' })).toBeInTheDocument()
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
      expect(within(pill as HTMLElement).getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    })
  })

  it('mounts the app-level feature on every surface (rail, toolbar, bubble-only via group)', async () => {
    const user = userEvent.setup()
    render(<App />)

    // LEFT RAIL: the app's "Insert date" contribution.
    const rail = await screen.findByRole('toolbar', { name: 'Insert' })
    expect(within(rail).getByRole('button', { name: 'Insert date' })).toBeInTheDocument()

    // TOP TOOLBAR: "Clear formatting" shows; the 'selection' group does NOT
    // (it is bubble-only — placement decided by the consumer's filter).
    await user.selectOptions(screen.getByLabelText(/Toolbar/), 'default')
    const toolbar = await screen.findByRole('toolbar', { name: 'Formatting' })
    expect(within(toolbar).getByRole('button', { name: 'Clear formatting' })).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'Copy selection' })).toBeNull()
  })

  it('renders the app-rewritten comments UI in the consumer-owned right rail', async () => {
    render(<App />)
    const cards = await screen.findByRole('complementary', { name: 'Review notes' })
    expect(within(cards).getByText(/Select text and hit/)).toBeInTheDocument()
  })

  it('zooms the document in and out via the right rail', async () => {
    const user = userEvent.setup()
    render(<App />)

    const zoomRail = await screen.findByRole('toolbar', { name: 'Zoom' })
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom in' }))
    expect(within(zoomRail).getByText('110%')).toBeInTheDocument()

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom out' }))
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()
  })
})
