import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockEditor } from '../core/createMockEditor'
import { defineFeature } from '../core/defineFeature'
import { EditorToolbar } from './EditorToolbar'
import { resolveFeatures } from '../core/registry'
import { renderEditor } from '../../test/editorHarness'

const commandFeature = (run = vi.fn(() => true)) =>
  defineFeature({
    id: 'demo',
    extensions: () => [],
    commands: { 'demo.run': run },
    toolbar: [{ id: 'demo', label: 'Demo', icon: 'D', commandId: 'demo.run', isActive: () => false }],
  })

describe('<EditorToolbar />', () => {
  it('renders one button per contribution and runs its command on click', async () => {
    const run = vi.fn(() => true)
    const { editor, api, resolved } = renderEditor([commandFeature(run)])

    render(<EditorToolbar editor={editor} api={api} resolved={resolved} />)

    const button = screen.getByRole('button', { name: 'Demo' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('applies a custom container className (restyle without forking)', () => {
    const { editor, api, resolved } = renderEditor([])
    render(
      <EditorToolbar
        editor={editor}
        api={api}
        resolved={resolved}
        className="custom-bar"
      />,
    )
    expect(screen.getByRole('toolbar')).toHaveClass('custom-bar')
  })

  it('lets the consumer override the button markup via renderButton', () => {
    const { editor, api, resolved } = renderEditor([commandFeature()])
    render(
      <EditorToolbar
        editor={editor}
        api={api}
        resolved={resolved}
        renderButton={(button) => (
          // eslint-disable-next-line jsx-a11y/anchor-is-valid
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
    const { editor, api, resolved } = renderEditor([])
    render(
      <EditorToolbar editor={editor} api={api} resolved={resolved}>
        <button type="button">Custom</button>
      </EditorToolbar>,
    )
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
  })

  it('lets a feature ship a fully custom control via ToolbarItem.render', () => {
    const feature = defineFeature({
      id: 'meta',
      extensions: () => [],
      toolbar: [{ id: 'meta', label: 'Meta', render: () => <span data-testid="custom">hi</span> }],
    })
    const { editor, api, resolved } = renderEditor([feature])

    render(<EditorToolbar editor={editor} api={api} resolved={resolved} />)
    expect(screen.getByTestId('custom')).toHaveTextContent('hi')
  })

  it('shows only the contributions that pass the filter (e.g. a bubble menu)', () => {
    const marks = defineFeature({
      id: 'marks',
      extensions: () => [],
      commands: { bold: () => true },
      toolbar: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold' }],
    })
    const history = defineFeature({
      id: 'history',
      extensions: () => [],
      commands: { undo: () => true },
      toolbar: [{ id: 'undo', group: 'history', label: 'Undo', commandId: 'undo' }],
    })
    const mock = createMockEditor()

    render(
      <EditorToolbar
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
