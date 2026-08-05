import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { editorFromDOM as editor } from '../test/editorHarness'
import App, { commentsApi } from './App'

/* The demo backend is module-scope, so every test here is a new SESSION
 * against the SAME server — including its version counter. Zero latency keeps
 * a session's LAST save (the SDK flushes a pending onChange on unmount) from
 * landing after the next session already read the version it holds, which
 * would 409 that session before it ever typed. */
commentsApi.latencyMs = 0

/** Let the previous session's unmount flush land before the next one mounts. */
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

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

    // Saved on the fake backend → refetched → the composer closes and the
    // card lands: avatar initials + author + text, no quote. Waiting on the
    // composer first keeps the text query from matching the textarea's own
    // content mid-save.
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

    // Saved + refetched: the composer closes FIRST (else a text query could
    // match the textarea still holding the typed reply)…
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

    // PATCH + refetch → the resolved row sheds its highlight…
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

/* Last in the file on purpose: the conflict test saves from "another session",
 * which replaces the mock's saved document — and the quote validator of every
 * comment test above reads that document. */
describe('<App /> autosave envelope', () => {
  const RETRYING = 'Changes are not saved — your next edit retries the whole save.'
  /** One save cycle = the serialize debounce (250ms) + the app's autosave
   *  window (1500ms) + the mock's latency, with room to spare under load. */
  const CYCLE = 6000
  /** Only the envelope PUTs — the log also carries the panel's GET /comments. */
  const envelopePuts = () => commentsApi.log.filter((line) => line.includes('(envelope)')).length
  const edit = (text: string) =>
    act(() => {
      editor().commands.insertContent(text)
    })

  let view: ReturnType<typeof render>
  beforeEach(async () => {
    commentsApi.failNext.clear()
    view = render(<App />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
  }, 20000)

  it('teardown FLUSHES a pending autosave window — closing the tab does not drop the last edits', async () => {
    const before = envelopePuts()
    edit('typed, paused, then gone')
    // Long enough to arm the autosave window, short enough to still be inside
    // it: the unmount is what has to send, not the timer.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })

    view.unmount()

    await waitFor(() => expect(envelopePuts()).toBe(before + 1), { timeout: CYCLE })
  }, 20000)

  it('edits during a slow save coalesce into ONE follow-up envelope — never a self-conflict', async () => {
    // The pump allows one envelope in flight. Without that rule the second
    // debounced onChange would send a SECOND envelope carrying the same
    // version token, and the server — having just bumped on the first —
    // would reject it as a conflict that never happened.
    commentsApi.latencyMs = 150
    try {
      const before = envelopePuts()
      edit('aaa')
      // Three more bursts while the first envelope is in flight.
      edit('bbb')
      edit('ccc')
      edit('ddd')

      // Drain to idle instead of sleeping a fixed amount: the count must go
      // UP at least once and then hold still across two settle windows (this
      // suite also runs under whole-suite load, where fixed sleeps flake).
      await waitFor(() => expect(envelopePuts()).toBeGreaterThan(before), { timeout: CYCLE })
      let settled = envelopePuts()
      await waitFor(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 250))
          const now = envelopePuts()
          const stable = now === settled
          settled = now
          expect(stable).toBe(true)
        },
        { timeout: CYCLE },
      )

      // At most two: the in-flight one plus the single coalesced follow-up.
      expect(settled - before).toBeLessThanOrEqual(2)
      // And no conflict was ever raised — the reload notice never appeared.
      expect(screen.queryByText(/refresh/i)).toBeNull()
    } finally {
      commentsApi.latencyMs = 0
    }
  }, 20000)

  it('a rejected envelope raises the retry banner — dismissible, and cleared by the next confirmed save', async () => {
    commentsApi.failNext.add('save')

    edit('first edit')

    expect(await screen.findByText(RETRYING, {}, { timeout: CYCLE })).toBeInTheDocument()
    // Dismissible: there is nothing for the user to DO, so they may silence it.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(RETRYING)).toBeNull())
    // A LATER failure raises it again — dismissing silences one, not the state.
    edit(' still failing')
    expect(await screen.findByText(RETRYING, {}, { timeout: CYCLE })).toBeInTheDocument()

    // Nothing was persisted and nothing was dropped: the next cycle resends,
    // carrying the state as it is by then, and the banner clears itself.
    commentsApi.failNext.delete('save')
    edit(' and more')
    await waitFor(() => expect(screen.queryByText(RETRYING)).toBeNull(), { timeout: CYCLE })
  }, 20000)

  it('a stale versionId is TERMINAL: the reload notice replaces the retry, and saving stops', async () => {
    // Another session saves — the server version moves past the one this app
    // has been holding since it mounted.
    await act(async () => {
      await commentsApi.saveEnvelope({
        versionId: commentsApi.versionId,
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        anchors: [],
        creates: [],
      })
    })

    edit('my edit')

    const notice = await screen.findByText(/saved in another session/, {}, { timeout: CYCLE })
    const banner = notice.closest('.app__banner--conflict') as HTMLElement
    expect(within(banner).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // The retry banner stays away — this is not something an edit can fix, and
    // there is no Dismiss either: the notice outlives the session.
    expect(screen.queryByText(RETRYING)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()

    // Terminal — further edits do not even attempt an envelope.
    const attempted = envelopePuts()
    edit(' and another')
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(envelopePuts()).toBe(attempted)
  }, 20000)
})
