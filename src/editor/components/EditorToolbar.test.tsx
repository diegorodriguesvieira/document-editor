import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor, type CreatedEditor } from '../core/createEditor'
import { createMockEditor } from '../core/createMockEditor'
import { defineFeature } from '../core/defineFeature'
import { EditorToolbar } from './EditorToolbar'
import { resolveFeatures } from '../core/registry'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

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
    created = createEditor({ features: [commandFeature(run)], element: mountTarget() })

    render(<EditorToolbar editor={created.editor} api={created.api} resolved={created.resolved} />)

    const button = screen.getByRole('button', { name: 'Demo' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('applies a custom container className (restyle without forking)', () => {
    created = createEditor({ features: [], element: mountTarget() })
    render(
      <EditorToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
        className="custom-bar"
      />,
    )
    expect(screen.getByRole('toolbar')).toHaveClass('custom-bar')
  })

  it('lets the consumer override the button markup via renderButton', () => {
    created = createEditor({ features: [commandFeature()], element: mountTarget() })
    render(
      <EditorToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
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
    created = createEditor({ features: [], element: mountTarget() })
    render(
      <EditorToolbar editor={created.editor} api={created.api} resolved={created.resolved}>
        <button type="button">Custom</button>
      </EditorToolbar>,
    )
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
  })

  it('lets a feature ship a fully custom control via ToolbarItem.render', () => {
    const feature = defineFeature({
      id: 'meta',
      extensions: () => [],
      toolbar: [{ id: 'meta', label: 'Meta', render: () => <span data-testid="custom">olá</span> }],
    })
    created = createEditor({ features: [feature], element: mountTarget() })

    render(<EditorToolbar editor={created.editor} api={created.api} resolved={created.resolved} />)
    expect(screen.getByTestId('custom')).toHaveTextContent('olá')
  })

  it('shows only the contributions that pass the filter (e.g. a bubble menu)', () => {
    const marks = defineFeature({
      id: 'marks',
      extensions: () => [],
      toolbar: [{ id: 'bold', group: 'marks', label: 'Negrito', commandId: 'bold' }],
    })
    const history = defineFeature({
      id: 'history',
      extensions: () => [],
      toolbar: [{ id: 'undo', group: 'history', label: 'Desfazer', commandId: 'undo' }],
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

    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull()
  })
})
