import { Fragment } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'

/**
 * The side panels contributed by the enabled features (the `panels` channel),
 * in `order`. {@link DocumentEditor} mounts this automatically in the right
 * rail; a consumer replacing the rail via `renderRightBar` drops it wherever
 * it fits: `renderRightBar={(ctx) => <><MyRail/><FeaturePanels {...ctx}/></>}`.
 */
export function FeaturePanels({
  editor,
  api,
  resolved,
}: {
  editor: Editor | null
  api: EditorApi
  resolved: ResolvedFeatures
}) {
  if (resolved.panels.length === 0) return null
  return (
    <>
      {resolved.panels.map((panel) => (
        <Fragment key={panel.id}>{panel.render({ editor, api })}</Fragment>
      ))}
    </>
  )
}
