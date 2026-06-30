import { Editor } from '@tiptap/core'
import { buildExtensions } from './buildExtensions'
import { createEditorApi, type EditorApi } from './EditorApi'
import { createEmptyDocument, migrateDocument, type DocumentJSON } from './document'
import { resolveFeatures, type ResolvedFeatures } from './registry'
import type { FeatureDefinition } from './types'

export interface CreateEditorOptions {
  features: FeatureDefinition[]
  content?: DocumentJSON
  /** Optional mount point. Omit for a headless editor (SSR, tests, export). */
  element?: HTMLElement
  /** Called when content fails schema validation instead of silently wiping the
   *  document. Defaults to throwing. */
  onContentError?: (error: Error) => void
}

export interface CreatedEditor {
  editor: Editor
  api: EditorApi
  resolved: ResolvedFeatures
}

/**
 * Headless constructor — builds a real editor without React. Useful for
 * server-side serialization/export and for tests. The app uses
 * `useDocumentEditor` instead.
 */
export function createEditor(options: CreateEditorOptions): CreatedEditor {
  const resolved = resolveFeatures(options.features)
  const editor = new Editor({
    element: options.element,
    extensions: buildExtensions(resolved),
    content: migrateDocument(options.content ?? createEmptyDocument(), resolved.migrations).doc,
    // Surface invalid content rather than silently collapsing the doc to empty.
    enableContentCheck: true,
    onContentError: ({ error }) => {
      if (options.onContentError) options.onContentError(error)
      else throw error
    },
  })
  return { editor, api: createEditorApi(editor, resolved), resolved }
}
