import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createMockEditor } from './createMockEditor'
import { defineFeature } from './defineFeature'
import { EditorToolbar } from '../components/EditorToolbar'
import { resolveFeatures } from './registry'

const boldish = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  toolbar: [
    { id: 'bold', label: 'Bold', icon: 'B', commandId: 'bold.toggle', isActive: (s) => s.isActive('bold') },
  ],
})

const resolved = () => resolveFeatures([boldish])

describe('createMockEditor', () => {
  it('renders the toolbar and dispatches commands with no real editor', async () => {
    const mock = createMockEditor()
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolved()} />)

    const button = screen.getByRole('button', { name: 'Bold' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button)
    expect(mock.execCalls).toEqual([{ commandId: 'bold.toggle', payload: undefined }])
  })

  it('reflects active-state changes reactively', () => {
    const mock = createMockEditor()
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolved()} />)

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      mock.setActive(['bold'])
    })
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('starts from the given active set', () => {
    const mock = createMockEditor({ active: ['bold'] })
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolved()} />)
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
  })
})
