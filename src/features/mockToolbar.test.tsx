import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EditorToolbar, createMockEditor, resolveFeatures } from '../editor'
import { BoldFeature, HeadingFeature } from './index'

/**
 * The payoff of the EditorApi seam: real features render and dispatch through
 * the toolbar with NO TipTap editor, no jsdom ProseMirror, no `.focus()`.
 */
describe('real features with createMockEditor', () => {
  it('renders real feature buttons, reflects active state, and dispatches commands', async () => {
    const mock = createMockEditor({ active: ['bold'] })
    const resolved = resolveFeatures([BoldFeature, HeadingFeature])

    render(<EditorToolbar editor={null} api={mock.api} resolved={resolved} />)

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Heading 1' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Heading 1' }))
    expect(mock.execCalls.map((call) => call.commandId)).toContain('heading.h1')
  })
})
