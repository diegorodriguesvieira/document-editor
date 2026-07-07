import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('the popover is a body-portaled MUI Popper carrying the region-gate MARKER', async () => {
    // Positioning (viewport flip/clamp) is Popper's job now — jsdom mounts it
    // at 0,0, so the pin here is structure: portaled OUTSIDE the toolbar, on
    // <body>, with the functional 'document-editor-popup' class the
    // header/footer gate reads to keep regions open for clicks inside it.
    const user = userEvent.setup()
    const mock = createMockEditor()
    const { container } = render(
      <EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([ColorFeature])} />,
    )

    await user.click(screen.getByRole('button', { name: 'Text color' }))

    const popover = document.querySelector('.color-picker') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.classList.contains('document-editor-popup')).toBe(true)
    expect(container.contains(popover)).toBe(false) // portaled out of the bar
    expect(popover.closest('body')).toBe(document.body)
  })

  it('reflects the current color in the swatch reactively (real editor)', async () => {
    const created = renderEditor([ColorFeature], { content: HELLO })
    render(
      <EditorToolbar editor={created.editor} api={created.api} resolved={created.resolved} />,
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

describe('color.set payload validation (the value lands in a style attribute)', () => {
  it('rejects CSS-injection payloads, non-strings and empties — the HTML contract stays clean', () => {
    const created = renderEditor([ColorFeature], { content: HELLO })
    created.editor.commands.selectAll()

    // Declaration smuggling through the exported style attribute.
    expect(created.api.exec('color.set', 'red;background:url(//evil/x)')).toBe(false)
    expect(created.api.exec('color.set', '#fff}body{display:none')).toBe(false)
    // Junk payloads a custom control could send by accident.
    expect(created.api.exec('color.set', { hex: '#fff' } as never)).toBe(false)
    expect(created.api.exec('color.set')).toBe(false)
    expect(created.api.exec('color.set', '   ')).toBe(false)

    expect(created.api.getHTML()).not.toContain('background')
    expect(created.editor.getAttributes('textStyle').color).toBeFalsy()

    // The legitimate path is untouched.
    expect(created.api.exec('color.set', '#188038')).toBe(true)
  })
})

describe('the native custom picker (the "+" input)', () => {
  it('live-applies each picked value and the popover STAYS open while picking', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    render(
      <EditorToolbar editor={null} api={mock.api} resolved={resolveFeatures([ColorFeature])} />,
    )
    await user.click(screen.getByRole('button', { name: 'Text color' }))

    const input = document.querySelector('input[type="color"]') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: '#123456' } })

    expect(mock.execCalls).toContainEqual({ commandId: 'color.set', payload: '#123456' })
    // Picking is a live preview — the popover must not dismiss mid-drag.
    expect(document.querySelector('.color-picker')).not.toBeNull()
  })
})
