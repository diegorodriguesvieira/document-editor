import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockEditor } from '../core/createMockEditor'
import { defineFeature } from '../core/defineFeature'
import { BubbleBar } from './BubbleBar'
import { resolveFeatures } from '../core/registry'
import { renderEditor } from '../../test/editorHarness'

const commandFeature = (run = vi.fn(() => true)) =>
  defineFeature({
    id: 'demo',
    extensions: () => [],
    commands: { 'demo.run': run },
    bubble: [{ id: 'demo', label: 'Demo', icon: 'D', commandId: 'demo.run', isActive: () => false }],
  })

describe('<BubbleBar />', () => {
  it('renders one button per contribution and runs its command on click', async () => {
    const run = vi.fn(() => true)
    const { editor, api, resolved } = renderEditor([commandFeature(run)])

    render(<BubbleBar editor={editor} api={api} resolved={resolved} />)

    const button = screen.getByRole('button', { name: 'Demo' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('applies a custom container className (restyle without forking)', () => {
    const mock = createMockEditor()
    render(
      <BubbleBar
        editor={null}
        api={mock.api}
        resolved={resolveFeatures([])}
        className="custom-bar"
      />,
    )
    expect(screen.getByRole('toolbar')).toHaveClass('custom-bar')
  })

  it('lets the consumer override the button markup via renderButton', () => {
    const mock = createMockEditor()
    render(
      <BubbleBar
        editor={null}
        api={mock.api}
        resolved={resolveFeatures([commandFeature()])}
        renderButton={(button) => (
          <a role="link" onClick={button.run}>
            {button.item.label}
          </a>
        )}
      />,
    )
    expect(screen.getByRole('link', { name: 'Demo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demo' })).toBeNull()
  })

  it('appends children as custom controls (slot)', () => {
    const mock = createMockEditor()
    render(
      <BubbleBar editor={null} api={mock.api} resolved={resolveFeatures([])}>
        <button type="button">Custom</button>
      </BubbleBar>,
    )
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
  })

  it('lets a feature ship a fully custom control via a bubble item render', () => {
    const feature = defineFeature({
      id: 'meta',
      extensions: () => [],
      bubble: [{ id: 'meta', label: 'Meta', render: () => <span data-testid="custom">hi</span> }],
    })
    const mock = createMockEditor()

    render(<BubbleBar editor={null} api={mock.api} resolved={resolveFeatures([feature])} />)
    expect(screen.getByTestId('custom')).toHaveTextContent('hi')
  })

  it('shows only the contributions that pass the filter (e.g. a bubble menu)', () => {
    const marks = defineFeature({
      id: 'marks',
      extensions: () => [],
      commands: { bold: () => true },
      bubble: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold' }],
    })
    const history = defineFeature({
      id: 'history',
      extensions: () => [],
      commands: { undo: () => true },
      bubble: [{ id: 'undo', group: 'history', label: 'Undo', commandId: 'undo' }],
    })
    const mock = createMockEditor()

    render(
      <BubbleBar
        editor={null}
        api={mock.api}
        resolved={resolveFeatures([marks, history])}
        filter={(item) => item.group !== 'history'}
      />,
    )

    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
