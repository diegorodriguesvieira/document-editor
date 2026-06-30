import { useEffect, useReducer } from 'react'
import type { EditorApi } from '../core/EditorApi'
import type { PageRegion } from '../core/types'

/**
 * The hover affordances at the top/bottom of the page — "Add header +" /
 * "Add footer +". Each shows only while its region's node is absent
 * (re-checked on every document change) and runs the region's add command on
 * click. Auto-mounted by {@link DocumentEditor} when a feature contributes
 * page regions.
 */
export function PageAffordances({
  api,
  regions,
  position,
}: {
  api: EditorApi
  regions: PageRegion[]
  position: 'top' | 'bottom'
}) {
  // Re-render on document changes so presence (hasNode) stays fresh.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => api.on('update', bump), [api])

  const shown = regions.filter((region) => region.position === position && !api.hasNode(region.nodeName))
  if (shown.length === 0) return null

  return (
    <>
      {shown.map((region) => (
        <button
          key={region.id}
          type="button"
          className="page-affordance"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => api.exec(region.addCommandId)}
        >
          <span className="page-affordance__line" />
          <span className="page-affordance__label">{region.label} +</span>
          <span className="page-affordance__line" />
        </button>
      ))}
    </>
  )
}
