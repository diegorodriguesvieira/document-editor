import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EditorToolbar, createMockEditor, resolveFeatures } from '../../editor'
import { docWith, renderEditor } from '../../test/editorHarness'
import { ColorFeature, createColorFeature } from './color'

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

  it('createColorFeature takes a custom palette — the picker shows YOUR brand, not the default', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    const brand = createColorFeature({ palette: ['#ff0055', '#00c2a8'] })
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([brand])} />)

    await user.click(screen.getByRole('button', { name: 'Text color' }))

    // Your colors are in, the default palette is out…
    expect(screen.getByRole('button', { name: '#ff0055' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '#00c2a8' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '#d93025' })).toBeNull()
    // …and the Default reset + native "+" picker stay regardless.
    expect(screen.getByRole('button', { name: 'Default color' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom color' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '#00c2a8' }))
    expect(mock.execCalls).toContainEqual({ commandId: 'color.set', payload: '#00c2a8' })
  })

  it('clamps the popover to the viewport when the swatch sits near the right edge', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    render(<EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([ColorFeature])} />)

    const swatch = screen.getByRole('button', { name: 'Text color' })
    // The swatch rides the BUBBLE, which follows the selection — near the
    // right edge the ~190px grid must shift left instead of overflowing.
    swatch.getBoundingClientRect = () =>
      ({ top: 40, bottom: 76, left: 1000, right: 1036, width: 36, height: 36, x: 1000, y: 40, toJSON: () => ({}) }) as DOMRect
    await user.click(swatch)

    const popover = document.querySelector('.color-picker') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.style.left).toBe(`${window.innerWidth - 198}px`)
    expect(popover.style.top).toBe('82px')
  })

  it('reflects the current color in the swatch reactively (real editor)', async () => {
    const created = renderEditor([ColorFeature], { content: HELLO })
    render(
      <EditorToolbar editor={created.editor} api={created.api} resolved={resolveFeatures([ColorFeature])} />,
    )

    // The command re-renders the mounted ColorControl — that's the point of
    // the test — so it must run inside act.
    act(() => {
      created.editor.chain().selectAll().setColor('#d93025').run()
    })

    await waitFor(() =>
      expect(document.querySelector('.color-swatch__dot')).toHaveStyle({
        backgroundColor: '#d93025',
      }),
    )
  })
})
