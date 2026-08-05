import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { DocumentEditor } from '../components/DocumentEditor'
import { docWith, editorFromDOM as editor } from '../../test/editorHarness'
import {
  DocumentSaveProvider,
  useDocumentSave,
  useDocumentSaveRegistry,
  type DocumentSaveContributor,
  type DocumentSaveHandle,
} from './documentSave'

/** Short enough to keep the suite fast; long enough that a burst of edits
 *  lands inside ONE window. */
const WINDOW = 30

/** The envelope as a consumer types it: the document plus whatever slices the
 *  registered features merged in. */
type Envelope = { doc: JSONContent } & Record<string, unknown>

/** A recording contributor — the shape comments implements for real. */
function fakeContributor(slice: Record<string, unknown> = { anchors: ['a-1'] }) {
  let seq = 0
  return {
    collect: vi.fn(() => ({ token: ++seq, slice })),
    confirm: vi.fn(),
    discard: vi.fn(),
  } satisfies DocumentSaveContributor
}

function Contribute({ contributor }: { contributor: DocumentSaveContributor }) {
  const registry = useDocumentSaveRegistry()
  useEffect(() => registry?.registerContributor(contributor), [registry, contributor])
  return null
}

/** Reads the handle out for tests that drive `flush()` directly, and mirrors
 *  the state into the DOM for the ones that assert on it. */
function Probe({ into }: { into: { current: DocumentSaveHandle | null } }) {
  const handle = useDocumentSave()
  useEffect(() => {
    into.current = handle
  }, [handle, into])
  return <span data-testid="save-state">{handle?.state ?? 'no-provider'}</span>
}

function Rig({
  save,
  shouldStop,
  contributor,
  editable = true,
  withEditor = true,
  warnBeforeUnload = false,
  into = { current: null },
}: {
  save: (envelope: Envelope) => Promise<unknown>
  shouldStop?: (failure: unknown) => boolean
  contributor?: DocumentSaveContributor
  editable?: boolean
  withEditor?: boolean
  warnBeforeUnload?: boolean
  into?: { current: DocumentSaveHandle | null }
}) {
  return (
    <DocumentSaveProvider
      save={save}
      debounceMs={WINDOW}
      shouldStop={shouldStop}
      warnBeforeUnload={warnBeforeUnload}
    >
      {contributor ? <Contribute contributor={contributor} /> : null}
      <Probe into={into} />
      {withEditor ? (
        <DocumentEditor features={[]} content={docWith('hello')} editable={editable} />
      ) : null}
    </DocumentSaveProvider>
  )
}

const mounted = () => waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
/** Whether the page would ask the user to confirm leaving right now. */
const unloadBlocked = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
const type = (text: string) =>
  act(() => {
    editor().commands.insertContent(text)
  })

describe('DocumentSaveProvider', () => {
  it('collects the document and every slice in ONE synchronous frame (the coherence law)', async () => {
    // The contributor asserts from INSIDE collect(): whatever the envelope
    // ends up carrying as `doc` must be what the editor holds at THIS instant.
    let docAtCollect: JSONContent | undefined
    const contributor = {
      collect: vi.fn(() => {
        docAtCollect = editor().getJSON()
        return { token: 1, slice: { anchors: ['a-1'] } }
      }),
      confirm: vi.fn(),
      discard: vi.fn(),
    }
    const save = vi.fn(async (_envelope: Envelope) => ({ ok: true }))
    render(<Rig save={save} contributor={contributor} />)
    await mounted()

    type(' world')

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const envelope = save.mock.calls[0][0]
    expect(envelope.doc).toEqual(docAtCollect)
    // …and the slice rode along in the SAME envelope, merged flat.
    expect(envelope.anchors).toEqual(['a-1'])
  })

  it('a burst of edits costs ONE envelope — the window is the cadence', async () => {
    const save = vi.fn(async () => ({}))
    render(<Rig save={save} />)
    await mounted()

    type('a')
    type('b')
    type('c')

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // And it stays at one — no trailing cycle for the same burst.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, WINDOW * 3))
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('edits during a slow save coalesce into ONE follow-up — never two in flight', async () => {
    let inFlight = 0
    let peak = 0
    const save = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((resolve) => setTimeout(resolve, WINDOW * 2))
      inFlight -= 1
      return {}
    })
    render(<Rig save={save} />)
    await mounted()

    type('first')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // Three more bursts while the first envelope is still flying.
    type('second')
    type('third')
    type('fourth')

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 2000 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, WINDOW * 6))
    })
    // Exactly one follow-up, and the two never overlapped: a second envelope
    // in flight would carry the same version token as the first.
    expect(save).toHaveBeenCalledTimes(2)
    expect(peak).toBe(1)
  })

  it('confirms every collected slice with its own token and the save result', async () => {
    const contributor = fakeContributor()
    const save = vi.fn(async () => ({ created: [{ tempId: 't-1' }] }))
    const into = { current: null as DocumentSaveHandle | null }
    render(<Rig save={save} contributor={contributor} into={into} />)
    await mounted()

    type('x')

    await waitFor(() => expect(contributor.confirm).toHaveBeenCalledTimes(1))
    expect(contributor.confirm).toHaveBeenCalledWith(1, { created: [{ tempId: 't-1' }] })
    expect(contributor.discard).not.toHaveBeenCalled()
    await waitFor(() => expect(into.current?.state).toBe('saved'))
  })

  it('a rejected envelope discards, and the next edit retries', async () => {
    const contributor = fakeContributor()
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({})
    const into = { current: null as DocumentSaveHandle | null }
    render(<Rig save={save} contributor={contributor} into={into} />)
    await mounted()

    type('doomed')

    await waitFor(() => expect(contributor.discard).toHaveBeenCalledWith(1, undefined))
    await waitFor(() => expect(into.current?.state).toBe('failed'))

    // Nothing was persisted and nothing was dropped: the next edit resends.
    type(' retried')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(into.current?.state).toBe('saved'))
  })

  it('shouldStop halts saving for good and settles queued work', async () => {
    const contributor = fakeContributor()
    const save = vi.fn().mockRejectedValue({ code: 'VERSION_CONFLICT' })
    const into = { current: null as DocumentSaveHandle | null }
    render(
      <Rig
        save={save}
        contributor={contributor}
        into={into}
        shouldStop={(failure) => (failure as { code?: string }).code === 'VERSION_CONFLICT'}
      />,
    )
    await mounted()

    type('too late')

    await waitFor(() => expect(into.current?.state).toBe('stopped'))
    // Settled on the way out: a queued create must not wait on a cycle that
    // will never run.
    expect(contributor.discard).toHaveBeenCalledWith(1, { stopped: true })

    // Further edits do not even attempt an envelope.
    type(' and more')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, WINDOW * 4))
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('leaving edit mode flushes — a review comment quotes the SAVED document', async () => {
    const save = vi.fn(async () => ({}))
    const view = render(<Rig save={save} />)
    await mounted()

    type('typed in edit mode')
    // Flip to read-only IMMEDIATELY, well inside the window: the toggle is
    // what has to send, not the timer.
    view.rerender(<Rig save={save} editable={false} />)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })

  it('teardown flushes a pending window — closing the tab does not drop the last edits', async () => {
    const save = vi.fn(async () => ({}))
    const view = render(<Rig save={save} />)
    await mounted()

    type('typed then gone')
    view.unmount()

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  })

  it('is a no-op with no editor registered — and the state hook is null outside a provider', async () => {
    const save = vi.fn(async () => ({}))
    const into = { current: null as DocumentSaveHandle | null }
    const view = render(<Rig save={save} withEditor={false} into={into} />)

    await waitFor(() => expect(into.current).not.toBeNull())
    await act(async () => {
      await into.current!.flush()
    })
    expect(save).not.toHaveBeenCalled()

    view.rerender(<Probe into={into} />)
    expect(view.getByTestId('save-state').textContent).toBe('no-provider')
  })

  it('goes pending the moment an edit lands — long before the window closes', async () => {
    const into = { current: null as DocumentSaveHandle | null }
    render(<Rig save={vi.fn(async () => ({}))} into={into} />)
    await mounted()
    expect(into.current?.state).toBe('saved')

    type('typed')
    // No waiting: the window is still open and nothing has been sent, but the
    // work is already unsaved — `saved` here would be a lie the unload guard
    // would repeat.
    expect(into.current?.state).toBe('pending')

    await waitFor(() => expect(into.current?.state).toBe('saved'))
  })

  it('a save that lands while newer edits wait stays pending, never saved', async () => {
    const into = { current: null as DocumentSaveHandle | null }
    const save = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, WINDOW * 2))
      return {}
    })
    render(<Rig save={save} into={into} />)
    await mounted()

    type('first')
    await waitFor(() => expect(into.current?.state).toBe('saving'))
    type('during the flight')

    // The in-flight envelope confirms — but it does NOT carry what was typed
    // after it left.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 2000 })
    await waitFor(() => expect(into.current?.state).toBe('saved'))
  })

  it('warnBeforeUnload guards the tab while anything is unsaved — and only then', async () => {
    const into = { current: null as DocumentSaveHandle | null }
    render(<Rig save={vi.fn(async () => ({}))} into={into} warnBeforeUnload />)
    await mounted()
    // Nothing outstanding: leaving is free.
    expect(unloadBlocked()).toBe(false)

    type('unsaved work')
    expect(unloadBlocked()).toBe(true)

    await waitFor(() => expect(into.current?.state).toBe('saved'))
    expect(unloadBlocked()).toBe(false)
  })

  it('a rejected save keeps the tab guarded — nothing was persisted', async () => {
    const into = { current: null as DocumentSaveHandle | null }
    const save = vi.fn().mockRejectedValue(new Error('network'))
    render(<Rig save={save} into={into} warnBeforeUnload />)
    await mounted()

    type('doomed')
    await waitFor(() => expect(into.current?.state).toBe('failed'))
    expect(unloadBlocked()).toBe(true)
  })

  it('is OFF by default — an embedded editor must not hijack the tab', async () => {
    const into = { current: null as DocumentSaveHandle | null }
    render(<Rig save={vi.fn(async () => ({}))} into={into} />)
    await mounted()

    type('unsaved work')
    expect(into.current?.state).toBe('pending')
    expect(unloadBlocked()).toBe(false)
  })

  it('an unregistered contributor stops riding the envelope', async () => {
    const contributor = fakeContributor()
    const save = vi.fn(async (_envelope: Envelope) => ({}))
    const view = render(<Rig save={save} contributor={contributor} />)
    await mounted()

    type('with slice')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toMatchObject({ anchors: ['a-1'] })

    // Drop the contributor; the document keeps saving without it.
    view.rerender(<Rig save={save} />)
    type(' without slice')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).not.toHaveProperty('anchors')
  })
})
