import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EditorToolbar, createMockEditor, resolveFeatures } from '../editor'
import { HistoryFeature } from './history'

/**
 * Undo/redo expose a real disabled state through the new EditorStateView
 * predicates (canUndo/canRedo) — no real editor needed, via the mock seam.
 */
describe('history toolbar disabled state', () => {
  it('disables undo/redo when there is nothing to undo/redo', () => {
    const mock = createMockEditor({ canUndo: false, canRedo: false })
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([HistoryFeature])} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('enables undo when there is history to undo', () => {
    const mock = createMockEditor({ canUndo: true, canRedo: false })
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([HistoryFeature])} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})
