import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentEditor } from './useDocumentEditor'
import { BoldFeature, ItalicFeature, createColorFeature } from '../../features'
import { collectNodeIds, docWith } from '../../test/editorHarness'

describe('useDocumentEditor', () => {
  it('does NOT recreate the editor when given a fresh-but-equivalent features array', () => {
    const { result, rerender } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [BoldFeature, ItalicFeature] },
    })
    const firstResolved = result.current.resolved
    const firstEditor = result.current.editor

    // New array literal, same ids in the same order — the common inline-prop case.
    rerender({ features: [BoldFeature, ItalicFeature] })
    expect(result.current.resolved).toBe(firstResolved)
    expect(result.current.editor).toBe(firstEditor)

    // Changing the set of feature ids DOES recreate.
    rerender({ features: [BoldFeature] })
    expect(result.current.resolved).not.toBe(firstResolved)
  })

  it('options are COMPOSITION-time config: a same-id, different-instance swap is ignored', () => {
    // Identity tracks feature IDS — swapping createColorFeature({palette A})
    // for ({palette B}) at runtime must neither recreate the editor nor adopt
    // the new options (the documented contract: pick options when you build
    // the array).
    const paletteA = createColorFeature({ palette: ['#111111'] })
    const paletteB = createColorFeature({ palette: ['#222222'] })
    const { result, rerender } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [paletteA] },
    })
    const firstResolved = result.current.resolved
    const firstEditor = result.current.editor

    rerender({ features: [paletteB] })
    expect(result.current.resolved).toBe(firstResolved)
    expect(result.current.editor).toBe(firstEditor)
  })

  it('calls onReady once with the api', async () => {
    const onReady = vi.fn()
    renderHook(() => useDocumentEditor({ features: [BoldFeature], onReady }))

    await waitFor(() => expect(onReady).toHaveBeenCalled())
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady.mock.calls[0][0]).toHaveProperty('getJSON')
  })

  it('calls onChange (debounced) with the serialized doc after an edit', async () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useDocumentEditor({ features: [BoldFeature], onChange }))
    await waitFor(() => expect(result.current.editor).not.toBeNull())

    act(() => {
      result.current.editor!.commands.insertContent('hi')
    })
    expect(onChange).not.toHaveBeenCalled() // debounced, not synchronous

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)![0]).toHaveProperty('doc')
  })

  it('a read-only toggle does NOT fire onChange — no phantom dirty/autosave', async () => {
    const onChange = vi.fn()
    const { result, rerender, unmount } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [BoldFeature], editable: true, onChange },
    })
    await waitFor(() => expect(result.current.editor).not.toBeNull())

    // setEditable emits 'update' with an empty transaction (no doc change) —
    // the debounced serialize must not be scheduled for it.
    rerender({ features: [BoldFeature], editable: false, onChange })
    await waitFor(() => expect(result.current.editor!.isEditable).toBe(false))

    // Unmount flushes any pending debounce SYNCHRONOUSLY — if the toggle had
    // scheduled one, this surfaces it without waiting out the debounce window.
    unmount()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a read-only mount of a raw document gets its uids without firing onChange', async () => {
    const onChange = vi.fn()
    const { result, unmount } = renderHook(() =>
      useDocumentEditor({ features: [BoldFeature], editable: false, content: docWith('raw'), onChange }),
    )
    await waitFor(() => expect(result.current.editor).not.toBeNull())
    expect(result.current.editor!.isEditable).toBe(false)

    // Ids are stamped at ENTRY (injectNodeIds), not by an editor transaction.
    // Alone this doesn't prove it — the async create-scan could have stamped
    // them during the waitFor above…
    const ids = collectNodeIds(result.current.editor!.getJSON())
    expect(ids).toHaveLength(1)
    expect(typeof ids[0]).toBe('string')

    // …so the other half of the proof: a create-scan fill would be a
    // doc-changing transaction after subscription, and the unmount flush
    // would surface it as onChange. Ids present AND onChange silent can
    // only mean entry-stamping.
    unmount()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('flushes a pending onChange on unmount — the last edits are never lost', async () => {
    const onChange = vi.fn()
    const { result, unmount } = renderHook(() =>
      useDocumentEditor({ features: [BoldFeature], onChange }),
    )
    await waitFor(() => expect(result.current.editor).not.toBeNull())

    act(() => {
      result.current.editor!.commands.insertContent('last words')
    })
    expect(onChange).not.toHaveBeenCalled() // still inside the debounce window

    unmount() // ← would previously drop the pending save on the floor

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(onChange.mock.calls[0][0].doc)).toContain('last words')
  })

  it('recreation (feature-set change): onReady never fires with a dead api, and fires with the new one', async () => {
    const ready = vi.fn()
    const { result, rerender } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [BoldFeature], onReady: ready },
    })
    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1))
    const firstEditor = result.current.editor

    // Change the feature SET → the editor is recreated. The transient render
    // pairs the new `resolved` with the soon-destroyed old editor — onReady
    // must skip that pass (its command methods would throw) and fire once the
    // live editor exists.
    rerender({ features: [BoldFeature, ItalicFeature], onReady: ready })
    await waitFor(() => expect(result.current.editor).not.toBe(firstEditor))
    await waitFor(() => expect(ready).toHaveBeenCalledTimes(2))

    // Every api the consumer ever saw was alive at call time — loading a doc
    // from onReady (the documented pattern) must never hit a dead editor.
    const lastApi = ready.mock.calls.at(-1)![0]
    expect(() => lastApi.setJSON({ doc: { type: 'doc', content: [{ type: 'paragraph' }] } }))
      .not.toThrow()
    expect(result.current.editor!.isDestroyed).toBe(false)
  })

  it('recreation flushes the pending onChange from the OLD editor (edits are not lost)', async () => {
    const onChange = vi.fn()
    const { result, rerender } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [BoldFeature], onChange },
    })
    await waitFor(() => expect(result.current.editor).not.toBeNull())

    act(() => {
      result.current.editor!.commands.insertContent('almost lost')
    })
    expect(onChange).not.toHaveBeenCalled() // inside the debounce window

    // Feature-set change destroys the old editor BEFORE our cleanup runs —
    // the flush must still deliver the snapshot taken at schedule time.
    rerender({ features: [BoldFeature, ItalicFeature], onChange })
    await waitFor(() =>
      expect(onChange.mock.calls.some((call) => JSON.stringify(call[0].doc).includes('almost lost'))).toBe(true),
    )
  })

  it('honors the LATEST onContentError prop (not the one frozen at creation)', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook((props) => useDocumentEditor(props), {
      initialProps: { features: [BoldFeature], onContentError: first },
    })
    await waitFor(() => expect(result.current.editor).not.toBeNull())
    const editor = result.current.editor!

    // Same editor instance, new handler prop. TipTap binds the handler ONCE
    // at creation and never re-applies options (deps are non-empty), so the
    // event must be ref-routed to reach the CURRENT prop — contentError also
    // fires long after creation (e.g. from paste with content check on).
    rerender({ features: [BoldFeature], onContentError: second })
    const error = new Error('invalid content')
    act(() => {
      editor.emit('contentError', { editor, error, disableCollaboration: () => {} })
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(error)
  })
})

describe('contract edges (StrictMode, setJSON errors)', () => {
  it('onReady fires ONCE per editor instance under React.StrictMode', async () => {
    // StrictMode re-runs mount effects with unchanged deps; without the
    // api-identity guard a dev-mode consumer double-fetches/double-loads.
    const onReady = vi.fn()
    renderHook(() => useDocumentEditor({ features: [BoldFeature], onReady }), {
      wrapper: StrictMode,
    })
    await waitFor(() => expect(onReady).toHaveBeenCalled())
    // Drain a beat: the double-invoked effect would fire on the next tick.
    await act(async () => {})
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('api.setJSON of invalid content THROWS synchronously — it does NOT route to onContentError', async () => {
    // TipTap 3.17: setContent's JSON path has no contentError plumbing —
    // the docs tell consumers to try/catch their async load. Pin both halves
    // so an upgrade that changes the routing is caught.
    const onContentError = vi.fn()
    const { result } = renderHook(() =>
      useDocumentEditor({ features: [BoldFeature], onContentError }),
    )
    await waitFor(() => expect(result.current.api).not.toBeNull())

    const bad = { doc: { type: 'doc', content: [{ type: 'notAFeatureNode' }] } }
    expect(() =>
      act(() => {
        result.current.api!.setJSON(bad as never)
      }),
    ).toThrow()
    expect(onContentError).not.toHaveBeenCalled()
  })
})
