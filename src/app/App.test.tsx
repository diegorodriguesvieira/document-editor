import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Editor } from '../editor'
import App from './App'

/** The app's editor instance (ProseMirror exposes it on its root element). */
function editor(): Editor {
  const pm = document.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor }
  return pm.editor!
}

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

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom in' }))
    expect(within(zoomRail).getByText('110%')).toBeInTheDocument()

    await user.click(within(zoomRail).getByRole('button', { name: 'Zoom out' }))
    expect(within(zoomRail).getByText('100%')).toBeInTheDocument()
  })
})
