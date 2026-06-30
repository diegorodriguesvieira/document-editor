import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor, type CreatedEditor } from '../core/createEditor'
import { defineFeature } from '../core/defineFeature'
import { useToolbar } from './useToolbar'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('useToolbar', () => {
  it('derives one button per contribution with live state and a run() action', () => {
    const run = vi.fn(() => true)
    const feature = defineFeature({
      id: 'demo',
      extensions: () => [],
      commands: { 'demo.run': run },
      toolbar: [
        { id: 'demo', label: 'Demo', commandId: 'demo.run', isActive: () => false, isDisabled: () => true },
      ],
    })
    created = createEditor({ features: [feature], element: mountTarget() })

    const { result } = renderHook(() => useToolbar(created!.editor, created!.api, created!.resolved))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].item.id).toBe('demo')
    expect(result.current[0].active).toBe(false)
    expect(result.current[0].disabled).toBe(true)

    act(() => {
      result.current[0].run()
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('appends extra items after the feature contributions', () => {
    const feature = defineFeature({
      id: 'a',
      extensions: () => [],
      toolbar: [{ id: 'a', label: 'A', commandId: 'a' }],
    })
    created = createEditor({ features: [feature], element: mountTarget() })

    const extra = [{ id: 'x', label: 'X', commandId: 'x' }]
    const { result } = renderHook(() =>
      useToolbar(created!.editor, created!.api, created!.resolved, extra),
    )

    expect(result.current.map((button) => button.item.id)).toEqual(['a', 'x'])
  })
})
