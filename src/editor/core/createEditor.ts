import { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { buildExtensions } from './buildExtensions'
import { createEditorApi, type EditorApi } from './EditorApi'
import { createEmptyDocument, type DocumentJSON } from './document'
import { resolveFeatures, type ResolvedFeatures } from './registry'
import type { FeatureDefinition } from './types'

export interface CreateEditorOptions {
  features: FeatureDefinition[]
  content?: DocumentJSON
  /** Optional mount point. Omit for a headless editor (SSR, tests, export). */
  element?: HTMLElement
  /** Called when INITIAL content (or an insertContent-style flow) fails schema
   *  validation instead of silently wiping the document. Defaults to throwing.
   *  `api.setJSON` does NOT route here — it throws synchronously. */
  onContentError?: (error: Error) => void
}

export interface CreatedEditor {
  editor: Editor
  api: EditorApi
  resolved: ResolvedFeatures
}

/**
 * The editor options every construction path shares — extensions, the content
 * fallback and the content-check policy (surface invalid content instead of
 * silently wiping the doc). ONE owner: `createEditor` and `useDocumentEditor`
 * both spread this, so the policy can never drift between them.
 */
export function baseEditorOptions(
  resolved: ResolvedFeatures,
  options: Pick<CreateEditorOptions, 'content' | 'onContentError'>,
) {
  return {
    extensions: buildExtensions(resolved),
    content: (options.content ?? createEmptyDocument()).doc,
    enableContentCheck: true as const,
    onContentError: ({ error }: { error: Error }) => {
      if (options.onContentError) options.onContentError(error)
      else throw error
    },
    // setEditable emits 'update' but no TRANSACTION, and React node views +
    // `useEditorState` subscribe to transactions — without a nudge, every
    // isEditable-driven chrome (conditional-block controls, region bars)
    // keeps rendering the stale mode after a direct `editor.setEditable`.
    // An update without a doc change IS the setEditable signature (core
    // gates every other 'update' on docChanged), and the no-op dispatch
    // can't re-enter: it emits only 'transaction', never 'update'.
    onUpdate: ({ editor, transaction }: { editor: Editor; transaction: Transaction }) => {
      if (!transaction.docChanged && !editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
      }
    },
  }
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
    ...baseEditorOptions(resolved, options),
  })
  return { editor, api: createEditorApi(editor, resolved), resolved }
}
