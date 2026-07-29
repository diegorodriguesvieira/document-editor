import { useEffect, useMemo, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import type { Editor, EditorEvents } from '@tiptap/core'
import { createEditorApi, type EditorApi } from '../core/EditorApi'
import { baseEditorOptions } from '../core/createEditor'
import type { DocumentJSON } from '../core/document'
import { resolveFeatures, type ResolvedFeatures } from '../core/registry'
import type { FeatureDefinition } from '../core/types'
import { createSlashCommands } from './slashCommands'

export interface UseDocumentEditorOptions {
  /** The opt-in features. Editor identity tracks the SET + ORDER of feature
   *  ids (not the array reference), so an inline `features={[Bold, Italic]}`
   *  is safe — it won't recreate the editor on every parent render. */
  features: FeatureDefinition[]
  content?: DocumentJSON
  /** `false` puts the editor in READ-ONLY mode: the document renders with its
   *  full layout but rejects typing, and the SDK chrome that mutates content
   *  (insert dock default, page-region affordances, context menu, node-view
   *  controls) hides itself. Live-toggleable — flipping it does NOT recreate
   *  the editor (no undo/scroll loss). Defaults to `true`. Programmatic
   *  `api.exec`/`api.setJSON` stay available either way — read-only gates the
   *  UI, not the API. */
  editable?: boolean
  /** Called when INITIAL content (or an insertContent-style flow) fails schema
   *  validation — e.g. a node whose feature is disabled — instead of silently
   *  wiping the document. Defaults to throwing. Note: `api.setJSON` does NOT
   *  route here; it throws synchronously — try/catch your async load. */
  onContentError?: (error: Error) => void
  /** Called (debounced) with the serialized document after each change.
   *  `getJSON` is O(n), so this is debounced — never serialize per keystroke.
   *  Fires only on real doc changes — a read-only toggle (`setEditable`)
   *  never reaches it, so it's safe to treat every call as dirty. */
  onChange?: (doc: DocumentJSON) => void
  /** Called with the api when the editor becomes ready — once per editor
   *  instance (a feature-set change recreates the editor and fires it again
   *  with the fresh api). Use it to load a doc async (`api.setJSON`) or wire
   *  export — no remount, no `key` hack. */
  onReady?: (api: EditorApi) => void
}

export interface DocumentEditorHandle {
  editor: Editor | null
  api: EditorApi | null
  resolved: ResolvedFeatures
}

/**
 * React entry point: resolves the opt-in features and creates the editor,
 * recreating it only when the resolved feature set changes.
 */
export function useDocumentEditor(options: UseDocumentEditorOptions): DocumentEditorHandle {
  // Key identity by the feature ids (in order), so a fresh-but-equivalent
  // inline array doesn't recreate the editor and drop focus/selection/undo.
  const featureKey = options.features.map((feature) => feature.id).join('\0')
  const resolved = useMemo(() => resolveFeatures(options.features), [featureKey])

  // TipTap binds the contentError handler ONCE at creation and never re-applies
  // options while deps are non-empty — ref-route it so later prop values are
  // honored (contentError also fires from insertContent-style flows, long
  // after creation; setContent/setJSON is the exception — it THROWS
  // synchronously instead). The wrapper keeps the default-throw policy when
  // no handler is set at fire time.
  const onContentErrorRef = useRef(options.onContentError)
  onContentErrorRef.current = options.onContentError

  // Same construction policy as createEditor (content fallback + content check),
  // plus the React-only `/` menu mirroring the insert dock.
  const base = baseEditorOptions(resolved, {
    content: options.content,
    onContentError: (error) => {
      const handler = onContentErrorRef.current
      if (handler) handler(error)
      else throw error
    },
  })
  const editable = options.editable ?? true
  const editor = useEditor(
    {
      ...base,
      editable,
      extensions: [
        ...base.extensions,
        ...(resolved.inserts.some((item) => item.commandId) ? [createSlashCommands(resolved)] : []),
      ],
    },
    [resolved],
  )

  // Live editable toggle — setEditable, not recreation. The re-render nudge
  // for isEditable-driven chrome (setEditable emits no transaction) lives in
  // baseEditorOptions.onUpdate, shared by every construction path.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === editable) return
    editor.setEditable(editable)
  }, [editor, editable])

  const api = useMemo(
    () => (editor ? createEditorApi(editor, resolved) : null),
    [editor, resolved],
  )

  // Callbacks via refs so changing them doesn't re-subscribe or re-fire.
  const onReadyRef = useRef(options.onReady)
  onReadyRef.current = options.onReady
  const readyApiRef = useRef<EditorApi | null>(null)
  useEffect(() => {
    // On a feature-set change, the render that carries the NEW `resolved`
    // still holds the OLD editor (useEditor swaps instances inside its own
    // effect, destroying the old one synchronously first) — so this pass
    // sees an api bound to a dead editor, whose command methods would throw.
    // Skip it; the follow-up render fires with the live pair. The identity
    // guard keeps the "once per editor instance" promise under StrictMode's
    // double-invoked effects (recreation still re-fires: new editor → new api).
    if (api && editor && !editor.isDestroyed && readyApiRef.current !== api) {
      readyApiRef.current = api
      onReadyRef.current?.(api)
    }
  }, [api, editor])

  const onChangeRef = useRef(options.onChange)
  onChangeRef.current = options.onChange
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Snapshot at SCHEDULE time (a cheap reference — ProseMirror docs are
    // immutable) so the flush can deliver the last edits even after TipTap
    // has destroyed this editor: recreation destroys the old instance
    // BEFORE this cleanup runs, so reading the editor here would throw.
    let pendingDoc: typeof editor.state.doc | undefined
    const fire = () => {
      timer = undefined
      const doc = pendingDoc
      pendingDoc = undefined
      if (doc) onChangeRef.current?.({ doc: doc.toJSON() })
    }
    const handler = ({ transaction, appendedTransactions }: EditorEvents['update']) => {
      // setEditable also emits 'update' (empty tr, no doc change) — a
      // read-only toggle must not serialize an unchanged doc into onChange
      // (phantom dirty/autosave). Appended trs count as changes: core can
      // emit with a no-op root tr whose appendTransaction results DID
      // change the doc.
      if (!transaction.docChanged && !appendedTransactions.some((tr) => tr.docChanged)) return
      if (!onChangeRef.current) return
      pendingDoc = editor.state.doc
      clearTimeout(timer)
      timer = setTimeout(fire, 250)
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      // FLUSH a pending debounce: dropping it here would silently lose the
      // user's last ≤250ms of edits on unmount / editor recreation — the one
      // save that matters most.
      if (timer !== undefined) {
        clearTimeout(timer)
        fire()
      }
    }
  }, [editor])

  return { editor, api, resolved }
}
