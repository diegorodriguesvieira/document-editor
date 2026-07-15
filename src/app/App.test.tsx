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
    // No Comment button: commenting is a REVIEW-mode (preview) surface now.
    expect(within(bubble).queryByRole('button', { name: 'Comment' })).toBeNull()
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

describe('<App /> review comments (preview mode)', () => {
  /** Enter preview with real content and a text selection ready to comment. */
  async function enterPreviewSelecting() {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    act(() => {
      editor().commands.insertContent('hello mundo para revisar')
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false'),
    )
    act(() => {
      editor().commands.setTextSelection({ from: 1, to: 6 })
    })
  }

  it('nothing comment-related exists in EDIT mode', async () => {
    render(<App />)
    const bubble = await selectSomeText()
    expect(within(bubble).queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
  })

  it('select → balloon → composer → Enter saves via the mock API → card → Delete removes it', async () => {
    await enterPreviewSelecting()

    // The balloon floats in (TipTap's real BubbleMenu, ~250ms debounce).
    await userEvent.click(await screen.findByRole('button', { name: 'Add comment' }))

    // The panel opens with the composer; typing reveals the actions.
    const field = await screen.findByRole('textbox', { name: 'Comment text' })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    await userEvent.type(field, 'trocar essa palavra{Enter}')

    // Saved on the fake backend (300ms) → refetched (300ms more) → the
    // composer closes and the card lands: avatar initials + author + text,
    // no quote. Waiting on the composer first keeps the text query from
    // matching the textarea's own content mid-save.
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull(),
      { timeout: 3000 },
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    expect(await within(panel).findByText('trocar essa palavra')).toBeInTheDocument()
    expect(within(panel).getByText('Diego Rodrigues')).toBeInTheDocument()
    expect(within(panel).getByText('DR')).toBeInTheDocument()
    expect(within(panel).queryByText(/hello/)).toBeNull()

    // Own comment → 3-dots → Delete → DELETE endpoint + refetch → card leaves.
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('trocar essa palavra')).toBeNull())
  })
})
