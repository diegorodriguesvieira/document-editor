import { useMemo } from 'react'
import { useEditor } from '@tiptap/react'
import { buildExtensions } from '../core/buildExtensions'
import { createEditorApi, type EditorApi } from '../core/EditorApi'
import { createEmptyDocument, type DocumentJSON } from '../core/document'
import { resolveFeatures, type ResolvedFeatures } from '../core/registry'
import type { FeatureDefinition } from '../core/types'

export interface UseDocumentEditorOptions {
  /** Pass a stable (module-level/memoized) array — it drives editor identity. */
  features: FeatureDefinition[]
  content?: DocumentJSON
}

export interface DocumentEditorHandle {
  editor: ReturnType<typeof useEditor>
  api: EditorApi | null
  resolved: ResolvedFeatures
}

/**
 * React entry point: resolves the opt-in features and creates the editor,
 * recreating it only when the resolved feature set changes.
 */
export function useDocumentEditor(options: UseDocumentEditorOptions): DocumentEditorHandle {
  const resolved = useMemo(() => resolveFeatures(options.features), [options.features])

  const editor = useEditor(
    {
      extensions: buildExtensions(resolved),
      content: (options.content ?? createEmptyDocument()).doc,
    },
    [resolved],
  )

  const api = useMemo(
    () => (editor ? createEditorApi(editor, resolved) : null),
    [editor, resolved],
  )

  return { editor, api, resolved }
}
