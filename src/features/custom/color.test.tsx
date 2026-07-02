import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EditorToolbar, createMockEditor, resolveFeatures } from '../../editor'
import { docWith, renderEditor } from '../../test/editorHarness'
import { ColorFeature } from './color'

const HELLO = docWith('hello')

describe('color feature', () => {
  it('applies and clears the text color on the selection (real editor)', () => {
    const created = renderEditor([ColorFeature], { content: HELLO })
    created.editor.commands.selectAll()

    expect(created.api.exec('color.set', '#188038')).toBe(true)
    expect(created.editor.getAttributes('textStyle').color).toBe('#188038')
    expect(created.api.getHTML()).toMatch(/color/i)

    expect(created.api.exec('color.unset')).toBe(true)
    expect(created.editor.getAttributes('textStyle').color).toBeFalsy()
  })

  it('dispatches color.set for a preset and color.unset for Default (mock editor)', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([ColorFeature])} />)

    // The swatch is closed by default.
    expect(document.querySelector('input[type="color"]')).toBeNull()

    // Open → pick a preset.
    await user.click(screen.getByRole('button', { name: 'Text color' }))
    expect(document.querySelector('input[type="color"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '#1a73e8' }))
    expect(mock.execCalls).toContainEqual({ commandId: 'color.set', payload: '#1a73e8' })

    // Reopen → Default clears the color.
    await user.click(screen.getByRole('button', { name: 'Text color' }))
    await user.click(screen.getByRole('button', { name: 'Default color' }))
    expect(mock.execCalls).toContainEqual({ commandId: 'color.unset', payload: undefined })
  })

  it('reflects the current color in the swatch reactively (real editor)', async () => {
    const created = renderEditor([ColorFeature], { content: HELLO })
    render(
      <EditorToolbar editor={created.editor} api={created.api} resolved={resolveFeatures([ColorFeature])} />,
    )

    created.editor.chain().selectAll().setColor('#d93025').run()

    await waitFor(() =>
      expect(document.querySelector('.color-swatch__dot')).toHaveStyle({
        backgroundColor: '#d93025',
      }),
    )
  })
})
