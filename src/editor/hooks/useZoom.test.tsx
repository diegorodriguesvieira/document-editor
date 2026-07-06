import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useZoom } from './useZoom'

describe('useZoom', () => {
  it('starts at 100% and steps by 0.1 in both directions', () => {
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoom).toBe(1)

    act(() => result.current.zoomIn())
    expect(result.current.zoom).toBe(1.1)

    act(() => result.current.zoomOut())
    expect(result.current.zoom).toBe(1)
  })

  it('never accumulates floating-point drift across steps', () => {
    const { result } = renderHook(() => useZoom())
    act(() => {
      result.current.zoomIn()
      result.current.zoomIn()
      result.current.zoomIn()
    })
    // Naive addition would give 1.3000000000000003 — the readout math and the
    // bound checks both depend on exact values.
    expect(result.current.zoom).toBe(1.3)
  })

  it('clamps at the bounds and reports them through canZoomIn/canZoomOut', () => {
    const { result } = renderHook(() => useZoom())
    expect(result.current.canZoomIn).toBe(true)
    expect(result.current.canZoomOut).toBe(true)

    act(() => {
      for (let i = 0; i < 20; i++) result.current.zoomIn() // way past max
    })
    expect(result.current.zoom).toBe(2)
    expect(result.current.canZoomIn).toBe(false)
    act(() => result.current.zoomIn()) // disabled in the UI, a no-op here
    expect(result.current.zoom).toBe(2)

    act(() => {
      for (let i = 0; i < 30; i++) result.current.zoomOut()
    })
    expect(result.current.zoom).toBe(0.5)
    expect(result.current.canZoomOut).toBe(false)
  })

  it('setZoom clamps arbitrary values (sliders, reset buttons)', () => {
    const { result } = renderHook(() => useZoom())
    act(() => result.current.setZoom(99))
    expect(result.current.zoom).toBe(2)

    act(() => result.current.setZoom(0))
    expect(result.current.zoom).toBe(0.5)

    act(() => result.current.setZoom(1.25))
    expect(result.current.zoom).toBe(1.25)
  })

  it('honors custom policy — initial, bounds and step (initial clamps too)', () => {
    const { result } = renderHook(() => useZoom({ initial: 9, min: 1, max: 3, step: 0.25 }))
    expect(result.current.zoom).toBe(3) // initial clamped into the bounds

    act(() => result.current.setZoom(1.5))
    act(() => result.current.zoomIn())
    expect(result.current.zoom).toBe(1.75)

    act(() => result.current.setZoom(0.2))
    expect(result.current.zoom).toBe(1) // custom min
  })
})
