import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
