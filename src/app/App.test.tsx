import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { editorFromDOM as editor } from '../test/editorHarness'
import App from './App'

/** Select real text so the bubble (the only toolbar) has a reason to show. */
async function selectSomeText() {
  await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
  act(() => {
    editor().commands.insertContent('hello mundo')
    editor().commands.setTextSelection({ from: 1, to: 6 })
  })
  return await screen.findByRole('toolbar', { name: 'Formatting' })
}

describe('<App /> toolbar', () => {
  it('ships NO static toolbar — the bubble appears on selection, with the formatting set', async () => {
    render(<App />)

    // Before any selection there is no formatting toolbar anywhere.
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull()

    const bubble = await selectSomeText()
    expect(within(bubble).getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(within(bubble).getByRole('button', { name: 'Callout' })).toBeInTheDocument()
    expect(within(bubble).getByRole('button', { name: 'Comment' })).toBeInTheDocument()
  })

  it('ships the FULL feature set — the footer dock carries every team insert, no preset switcher', async () => {
    render(<App />)

    const items = await screen.findByRole('toolbar', { name: 'Insert' })
    for (const insert of ['Table', 'Image', 'Conditional block', 'Variables']) {
      expect(within(items).getByRole('button', { name: insert })).toBeInTheDocument()
    }
    // The header no longer offers feature presets.
    expect(screen.queryByLabelText(/Features/)).toBeNull()
  })

  it('composes the footer dock: zoom on the left, inserts centered, Send on the right', async () => {
    render(<App />)
    await screen.findByRole('toolbar', { name: 'Insert' })

    // The three zones live INSIDE the same fixed bar…
    const dock = document.querySelector('.app-dock') as HTMLElement
    expect(dock).not.toBeNull()
    const zoom = within(dock).getByRole('toolbar', { name: 'Zoom' })
    const items = within(dock).getByRole('toolbar', { name: 'Insert' })
    const send = within(dock).getByRole('button', { name: 'Send' })

    // …in left→center→right order (the grid maps DOM order to columns).
    expect(zoom.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(items.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('mounts the app-level feature on both surfaces (dock + bubble); history stays out of the bubble', async () => {
    render(<App />)

    // FOOTER DOCK: the app's "Insert date" contribution.
    const dock = await screen.findByRole('toolbar', { name: 'Insert' })
    expect(within(dock).getByRole('button', { name: 'Insert date' })).toBeInTheDocument()

    // BUBBLE: both app actions ride along — and undo/redo are filtered out
    // (not selection-scoped; keyboard covers them).
    const bubble = await selectSomeText()
    expect(within(bubble).getByRole('button', { name: 'Clear formatting' })).toBeInTheDocument()
    expect(within(bubble).getByRole('button', { name: 'Copy selection' })).toBeInTheDocument()
    expect(within(bubble).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows the comments panel only when there ARE comments (right rail stays clean otherwise)', async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())

    // No comments → no panel at all.
    expect(screen.queryByRole('complementary', { name: 'Review notes' })).toBeNull()

    // Anchor a comment (what comment.add does to the doc) → the app-rewritten
    // panel appears in the consumer-owned right rail, reactively.
    act(() => {
      editor()
        .chain()
        .insertContent('hello world')
        .setTextSelection({ from: 1, to: 6 })
        .setMark('comment', { commentId: 'c-1' })
        .run()
    })
    const cards = await screen.findByRole('complementary', { name: 'Review notes' })
    expect(within(cards).getByText(/on “hello”/)).toBeInTheDocument()
  })

  it('zooms the document in and out via the footer dock', async () => {
    const user = userEvent.setup()
    render(<App />)

    const zoomRail = await screen.findByRole('toolbar', { name: 'Zoom' })
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()
    // The number must actually reach the page scaler, not just the readout.
    const scale = () => (document.querySelector('.document-editor__scale') as HTMLElement).style.zoom

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom in' }))
    expect(within(zoomRail).getByText('110%')).toBeInTheDocument()
    expect(scale()).toBe('1.1')

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom out' }))
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()
    expect(scale()).toBe('1')
  })
})

describe('<App /> preview mode', () => {
  it('the toggle is HIDDEN while the document is blank — the empty state owns that moment', async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()

    act(() => {
      editor().commands.insertContent('agora tem conteúdo')
    })
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeInTheDocument()
  })

  it('the header button toggles read-only and back, live', async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const surface = () => document.querySelector('.ProseMirror') as HTMLElement
    expect(surface().getAttribute('contenteditable')).toBe('true')
    act(() => {
      editor().commands.insertContent('hello mundo')
    })
    await screen.findByRole('toolbar', { name: 'Insert' })

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(surface().getAttribute('contenteditable')).toBe('false'))
    // The app's own mutating chrome goes with it — no insert actions…
    expect(screen.queryByRole('toolbar', { name: 'Insert' })).toBeNull()
    // …while the read-only layout keeps the shell (zoom rail, Send).
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(surface().getAttribute('contenteditable')).toBe('true'))
    expect(await screen.findByRole('toolbar', { name: 'Insert' })).toBeInTheDocument()
  })
})
