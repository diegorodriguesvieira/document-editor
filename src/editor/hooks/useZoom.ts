import { useCallback, useState } from 'react'

export interface UseZoomOptions {
  /** Starting zoom (1 = 100%). Default 1. */
  initial?: number
  /** Lower bound. Default 0.5. */
  min?: number
  /** Upper bound. Default 2. */
  max?: number
  /** Increment used by zoomIn/zoomOut. Default 0.1. */
  step?: number
}

/**
 * Ready-made zoom STATE for the `DocumentEditor`'s `zoom` prop. The scaling
 * mechanics (CSS zoom, in-column scrolling past 100%, chrome staying put) are
 * the SDK's; zoom is presentation state the CONSUMER owns — this hook is that
 * state with the policy handled: clamping, stepping and float-drift rounding.
 * Render any UI you like on top:
 *
 *   const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()
 *   <button onClick={zoomIn} disabled={!canZoomIn}>+</button>
 *   <DocumentEditor zoom={zoom} … />
 *
 * Values are rounded to 2 decimals after every change so 0.1-steps never
 * accumulate floating-point drift — keep min/max/step 2-decimal numbers.
 */
export function useZoom(options: UseZoomOptions = {}) {
  const { initial = 1, min = 0.5, max = 2, step = 0.1 } = options

  const clamp = useCallback(
    (value: number) => Math.round(Math.min(Math.max(value, min), max) * 100) / 100,
    [min, max],
  )

  const [zoom, setZoomState] = useState(() => clamp(initial))

  const setZoom = useCallback((value: number) => setZoomState(clamp(value)), [clamp])
  const zoomIn = useCallback(() => setZoomState((current) => clamp(current + step)), [clamp, step])
  const zoomOut = useCallback(() => setZoomState((current) => clamp(current - step)), [clamp, step])

  return {
    /** Feed this to `<DocumentEditor zoom={zoom} />`. */
    zoom,
    zoomIn,
    zoomOut,
    /** Clamped setter — for sliders, dropdowns or a reset button. */
    setZoom,
    /** Real disabled affordances for the buttons. */
    canZoomIn: zoom < max,
    canZoomOut: zoom > min,
  }
}
