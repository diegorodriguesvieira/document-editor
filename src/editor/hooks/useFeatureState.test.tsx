import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createEditor } from '../core/createEditor'
import { useFeatureState } from './useFeatureState'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const docWith = (text: string) => ({
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

describe('useFeatureState', () => {
  it('reads a slice of editor state and reacts to transactions', () => {
    const created = createEditor({ features: [], content: docWith('hello') })
    editor = created.editor

    const { result } = renderHook(() => useFeatureState(editor!, (e) => e.getText()))
    expect(result.current).toBe('hello')

    act(() => {
      created.api.setJSON(docWith('world'))
    })
    expect(result.current).toBe('world')
  })

  it('returns null when there is no editor', () => {
    const { result } = renderHook(() => useFeatureState(null, (e) => e.getText()))
    expect(result.current).toBeNull()
  })
})
