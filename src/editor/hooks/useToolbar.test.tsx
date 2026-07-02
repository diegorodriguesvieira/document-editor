import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defineFeature } from '../core/defineFeature'
import { useToolbar } from './useToolbar'
import { renderEditor } from '../../test/editorHarness'

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
    const { editor, api, resolved } = renderEditor([feature])

    const { result } = renderHook(() => useToolbar(editor, api, resolved))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].item.id).toBe('demo')
    expect(result.current[0].active).toBe(false)
    expect(result.current[0].disabled).toBe(true)

    act(() => {
      result.current[0].run()
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

})
