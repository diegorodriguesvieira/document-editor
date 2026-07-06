import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

  it('pins the EditorApi defaults a fresh mock reports (and their overrides)', () => {
    const { api } = createMockEditor()
    expect(api.canUndo()).toBe(false)
    expect(api.canRedo()).toBe(false)
    expect(api.isEmpty()).toBe(false)
    expect(api.isSelectionEmpty()).toBe(true) // a fresh editor's caret
    expect(api.getHTML()).toBe('')
    expect(api.hasNode('paragraph')).toBe(true) // the empty document's paragraph
    expect(api.hasNode('table')).toBe(false)
    api.focus() // part of the interface — must be a safe no-op

    const rich = createMockEditor({ canRedo: true, isEmpty: true, isSelectionEmpty: false })
    expect(rich.api.canRedo()).toBe(true)
    expect(rich.api.isEmpty()).toBe(true)
    expect(rich.api.isSelectionEmpty()).toBe(false)
  })

  it('setJSON swaps the doc and notifies update subscribers; unsubscribe detaches', () => {
    const mock = createMockEditor()
    const onUpdate = vi.fn()
    const off = mock.api.on('update', onUpdate)

    const doc = {
      doc: { type: 'doc', content: [{ type: 'callout', content: [{ type: 'paragraph' }] }] },
    }
    mock.api.setJSON(doc)
    expect(mock.api.getJSON()).toBe(doc)
    expect(mock.api.hasNode('callout')).toBe(true)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    // exec also notifies (toolbars re-read state after a command)…
    mock.api.exec('x.y')
    expect(onUpdate).toHaveBeenCalledTimes(2)

    off()
    mock.emitUpdate()
    expect(onUpdate).toHaveBeenCalledTimes(2) // detached for real
  })

  it('exposes both event channels to hand-drive tests (emitUpdate/emitSelection)', () => {
    const mock = createMockEditor()
    const onUpdate = vi.fn()
    const onSelection = vi.fn()
    mock.api.on('update', onUpdate)
    mock.api.on('selection', onSelection)

    mock.emitUpdate()
    mock.emitSelection()

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onSelection).toHaveBeenCalledTimes(1)
  })
})
