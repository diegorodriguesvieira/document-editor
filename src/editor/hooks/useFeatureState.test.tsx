import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFeatureState } from './useFeatureState'
import { docWith, renderEditor } from '../../test/editorHarness'

describe('useFeatureState', () => {
  it('reads a slice of editor state and reacts to transactions', () => {
    const { editor, api } = renderEditor([], { content: docWith('hello') })

    const { result } = renderHook(() => useFeatureState(editor, (e) => e.getText()))
    expect(result.current).toBe('hello')

    act(() => {
      api.setJSON(docWith('world'))
    })
    expect(result.current).toBe('world')
  })

  it('returns null when there is no editor', () => {
    const { result } = renderHook(() => useFeatureState(null, (e) => e.getText()))
    expect(result.current).toBeNull()
  })
})
