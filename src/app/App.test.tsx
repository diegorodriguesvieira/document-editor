import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { editorFromDOM as editor } from '../test/editorHarness'
import App from './App'

/** Select real text so the bubble (the only toolbar) has a reason to show. */
async function selectSomeText() {
  await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
  act(() => {
    editor().commands.insertContent('hello world')
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
      editor().commands.insertContent('now with content')
    })
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeInTheDocument()
  })

  it('the header button toggles read-only and back, live', async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const surface = () => document.querySelector('.ProseMirror') as HTMLElement
    expect(surface().getAttribute('contenteditable')).toBe('true')
    act(() => {
      editor().commands.insertContent('hello world')
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
      editor().commands.insertContent('hello world for review')
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false'),
    )
    act(() => {
      editor().commands.setTextSelection({ from: 1, to: 6 })
    })
  }

  it('EDIT mode offers no way to COMMENT — and no panel while the doc has none', async () => {
    render(<App />)
    const bubble = await selectSomeText()
    expect(within(bubble).queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull()
    // The panel lives in both modes now, but self-hides while empty.
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
  })

  it('select → balloon → composer → Enter saves via the mock API → card → Delete removes it', async () => {
    await enterPreviewSelecting()

    // The balloon floats in (TipTap's real BubbleMenu, ~250ms debounce).
    await userEvent.click(await screen.findByRole('button', { name: 'Add comment' }))

    // The panel opens with the composer; typing reveals the actions.
    const field = await screen.findByRole('textbox', { name: 'Comment text' })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    await userEvent.type(field, 'change this word{Enter}')

    // Saved on the fake backend (300ms) → refetched (300ms more) → the
    // composer closes and the card lands: avatar initials + author + text,
    // no quote. Waiting on the composer first keeps the text query from
    // matching the textarea's own content mid-save.
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull(),
      { timeout: 3000 },
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    expect(await within(panel).findByText('change this word')).toBeInTheDocument()
    expect(within(panel).getByText('Diego Rodrigues')).toBeInTheDocument()
    expect(within(panel).getByText('DR')).toBeInTheDocument()
    expect(within(panel).queryByText(/hello/)).toBeNull()
    // The saved comment is ANCHORED: its highlight decoration wraps the
    // selected word (nothing was written into the document).
    const highlight = () => document.querySelector('.ProseMirror span.comment[data-comment-id]')
    expect(highlight()?.textContent).toBe('hello')

    // Own comment → 3-dots → Delete → DELETE endpoint + refetch → card leaves
    // (and the tombstoned row sheds its highlight).
    await userEvent.click(within(panel).getByRole('button', { name: 'Comment actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirm delete?' }))
    await waitFor(() => expect(screen.queryByText('change this word')).toBeNull())
    await waitFor(() => expect(highlight()).toBeNull())
  })

  it('a saved comment can be REPLIED to from the panel — one level, via the mock API', async () => {
    await enterPreviewSelecting()
    await userEvent.click(await screen.findByRole('button', { name: 'Add comment' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Comment text' }),
      'root comment{Enter}',
    )
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull(),
      { timeout: 3000 },
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await within(panel).findByText('root comment')

    await userEvent.click(within(panel).getByRole('button', { name: 'Reply' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Reply text' }),
      'direct reply{Enter}',
    )

    // Saved (300ms) + refetched (300ms): the composer closes FIRST (else a
    // text query could match the textarea still holding the typed reply)…
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Reply text' })).toBeNull(),
      { timeout: 3000 },
    )
    // …then the reply lands nested in the thread…
    const row = (await within(panel).findByText('direct reply')).closest('li') as HTMLElement
    // …which still counts as ONE open thread, and offers no reply-to-reply.
    expect(within(panel).getByRole('tab', { name: 'Comments (1)' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('resolving from the panel sheds the highlight and moves the thread to the Resolved tab', async () => {
    await enterPreviewSelecting()
    await userEvent.click(await screen.findByRole('button', { name: 'Add comment' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Comment text' }),
      'resolvable{Enter}',
    )
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull(),
      { timeout: 3000 },
    )
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    const card = (await within(panel).findByText('resolvable')).closest('li') as HTMLElement
    // Only this comment resolves in THIS editor (earlier tests' shared db
    // leftovers point at uids from other editors — orphans, no highlight).
    const highlight = () => document.querySelector('.ProseMirror span.comment[data-comment-id]')
    expect(highlight()).not.toBeNull()

    await userEvent.click(within(card).getByRole('button', { name: 'Resolve' }))

    // PATCH (300ms) + refetch (300ms) → the resolved row sheds its highlight…
    await waitFor(() => expect(highlight()).toBeNull(), { timeout: 3000 })
    // …the card leaves the open tab and lives on, frozen, under Resolved.
    expect(within(panel).queryByText('resolvable')).toBeNull()
    await userEvent.click(within(panel).getByRole('tab', { name: 'Resolved' }))
    const frozen = within(panel).getByText('resolvable').closest('li') as HTMLElement
    expect(within(frozen).getByText('“hello”')).toBeInTheDocument()
    expect(within(frozen).queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it('the highlight and the panel SURVIVE the switch back to edit mode — only composing is review-only', async () => {
    await enterPreviewSelecting()
    await userEvent.click(await screen.findByRole('button', { name: 'Add comment' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Comment text' }),
      'survives edit mode{Enter}',
    )
    await waitFor(
      () => expect(screen.queryByRole('textbox', { name: 'Comment text' })).toBeNull(),
      { timeout: 3000 },
    )
    await screen.findByRole('complementary', { name: 'Comments' })

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true'),
    )

    // The highlight rode along into edit mode, and the panel kept its card (await:
    // the draft clears BEFORE the refetch lands — the card can lag ~300ms).
    expect(document.querySelector('.ProseMirror span.comment[data-comment-id]')?.textContent).toBe(
      'hello',
    )
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    expect(await within(panel).findByText('survives edit mode')).toBeInTheDocument()

    // …but selecting text summons only the FORMATTING bubble, never the balloon.
    act(() => {
      editor().commands.setTextSelection({ from: 8, to: 12 })
    })
    await screen.findByRole('toolbar', { name: 'Formatting' })
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull()
  })
})
