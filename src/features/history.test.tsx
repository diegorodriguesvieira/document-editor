import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BubbleBar, createMockEditor, resolveFeatures } from '../editor'
import { renderEditor } from '../test/editorHarness'
import { HistoryFeature } from './history'

/**
 * Undo/redo expose a real disabled state through the new EditorStateView
 * predicates (canUndo/canRedo) — no real editor needed, via the mock seam.
 */
describe('history bubble disabled state', () => {
  it('disables undo/redo when there is nothing to undo/redo', () => {
    const mock = createMockEditor({ canUndo: false, canRedo: false })
    render(<BubbleBar editor={null} api={mock.api} resolved={resolveFeatures([HistoryFeature])} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('enables undo when there is history to undo', () => {
    const mock = createMockEditor({ canUndo: true, canRedo: false })
    render(<BubbleBar editor={null} api={mock.api} resolved={resolveFeatures([HistoryFeature])} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('the commands rewind and replay real edits (round-trip on a real editor)', () => {
    const created = renderEditor([HistoryFeature])
    created.editor.commands.insertContent('primeira linha')
    expect(created.editor.getText()).toContain('primeira linha')

    expect(created.api.exec('history.undo')).toBe(true)
    expect(created.editor.getText()).not.toContain('primeira linha')
    expect(created.api.canRedo()).toBe(true)

    expect(created.api.exec('history.redo')).toBe(true)
    expect(created.editor.getText()).toContain('primeira linha')
  })
})
