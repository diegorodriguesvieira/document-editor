interface ZoomRailProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
}

/**
 * Right-side rail (same design as the left insert rail) with zoom controls.
 * Zoom is presentation state owned by the app — not an editor command — so it
 * lives here, not in a feature.
 */
export function ZoomRail({ zoom, onZoomIn, onZoomOut }: ZoomRailProps) {
  return (
    <div className="insert-rail" role="toolbar" aria-orientation="vertical" aria-label="Zoom">
      <button
        type="button"
        className="insert-rail__btn"
        title="Zoom in"
        aria-label="Zoom in"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onZoomIn}
      >
        +
      </button>
      <span className="insert-rail__zoom" aria-hidden>
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        className="insert-rail__btn"
        title="Zoom out"
        aria-label="Zoom out"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onZoomOut}
      >
        −
      </button>
    </div>
  )
}
