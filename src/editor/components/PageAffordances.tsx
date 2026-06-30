import { useCallback, useEffect, useState } from 'react'
import type { EditorApi } from '../core/EditorApi'
import type { PageRegion } from '../core/types'

/**
 * The hover affordances at the top/bottom of the page — "Add header +" /
 * "Add footer +". Each shows only while its region's node is absent and runs
 * the region's add command on click. Auto-mounted by {@link DocumentEditor}
 * when a feature contributes page regions.
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
  const compute = useCallback(
    () => regions.filter((region) => region.position === position && !api.hasNode(region.nodeName)),
    [api, regions, position],
  )

  // Selector with equality-skip: re-compute presence on every change, but only
  // re-render when the SET of shown affordances actually changes — not on every
  // keystroke (which `getJSON`-free is cheap, but the re-render isn't free).
  const [shown, setShown] = useState(compute)
  useEffect(() => {
    const recompute = () =>
      setShown((prev) => {
        const next = compute()
        const same = prev.length === next.length && prev.every((r, i) => r.id === next[i].id)
        return same ? prev : next
      })
    recompute() // sync in case the doc changed between init and subscribe
    return api.on('update', recompute)
  }, [api, compute])

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
