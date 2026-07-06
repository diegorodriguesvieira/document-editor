interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  /** Real disabled affordances at the zoom bounds (see the SDK's useZoom). */
  canZoomIn?: boolean
  canZoomOut?: boolean
}

/**
 * Horizontal zoom controls for the app's footer dock (left zone). The state
 * and policy live in the SDK's `useZoom` hook — this is just the app's UI on
 * top of it (zoom is presentation state, not an editor command).
 */
export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  canZoomIn = true,
  canZoomOut = true,
}: ZoomControlsProps) {
  return (
    <div className="zoom-controls" role="toolbar" aria-label="Zoom">
      <button
        type="button"
        className="zoom-controls__btn"
        title="Zoom out"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onZoomOut}
      >
        −
      </button>
      <span className="zoom-controls__zoom" aria-hidden>
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        className="zoom-controls__btn"
        title="Zoom in"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onZoomIn}
      >
        +
      </button>
    </div>
  )
}
