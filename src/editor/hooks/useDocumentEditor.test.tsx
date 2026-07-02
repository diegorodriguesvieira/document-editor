import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentEditor } from './useDocumentEditor'
import { BoldFeature, ItalicFeature } from '../../features'

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
})
