import type { Editor } from '@tiptap/core'
import { exportHTML, toDocumentJSON, type DocumentJSON } from './document'
import type { ResolvedFeatures } from './registry'

/**
 * The slice of editor state the toolbar reads. Both the real `EditorApi` and
 * the in-memory `createMockEditor` implement it — that seam is what makes the
 * toolbar and feature wiring testable without a real TipTap editor.
 */
export interface EditorStateView {
  isActive(name: string, attrs?: Record<string, unknown>): boolean
  /** Whether there is history to undo / redo (drives a real disabled state). */
  canUndo(): boolean
  canRedo(): boolean
  /** Whether the document is effectively empty. */
  isEmpty(): boolean
  /** Whether the selection is a caret (nothing selected) — lets a toolbar item
   *  declare `isDisabled: (s) => s.isSelectionEmpty()` for selection-dependent
   *  actions (link, comment…) without reaching for the raw editor. */
  isSelectionEmpty(): boolean
}

/**
 * The stable facade the app talks to instead of the raw TipTap `Editor`.
 * Light by design (engine-swap is hygiene, not a real requirement) — its job
 * is to keep `@tiptap/*` out of product code, not to make the engine swappable.
 */
export interface EditorApi extends EditorStateView {
  getJSON(): DocumentJSON
  /** Replace the whole document — a heavy O(n) load (full reparse), not an
   *  update channel. Throws if `doc` contains content invalid for the active
   *  schema (e.g. a node whose feature is disabled). */
  setJSON(doc: DocumentJSON): void
  getHTML(): string
  /** Whether a top-level node of this type exists in the document. */
  hasNode(name: string): boolean
  /** Return focus to the editor (e.g. after a modal/popover closes). */
  focus(): void
  exec(commandId: string, payload?: unknown): boolean
  /** Whether a command id is registered by an enabled feature. Useful to probe
   *  for optional features — NOT an applicability check (it doesn't ask the
   *  selection whether the command could run right now). */
  has(commandId: string): boolean
  on(event: 'update' | 'selection', callback: () => void): () => void
}

export function createEditorApi(editor: Editor, resolved: ResolvedFeatures): EditorApi {
  return {
    isActive: (name, attrs) => editor.isActive(name, attrs),
    canUndo: () => editor.can().undo?.() ?? false,
    canRedo: () => editor.can().redo?.() ?? false,
    isEmpty: () => editor.isEmpty,
    isSelectionEmpty: () => editor.state.selection.empty,
    hasNode: (name) => {
      const { doc } = editor.state
      for (let i = 0; i < doc.childCount; i++) {
        if (doc.child(i).type.name === name) return true
      }
      return false
    },
    getJSON: () => toDocumentJSON(editor),
    setJSON: (doc) => {
      editor.commands.setContent(doc.doc)
    },
    getHTML: () => exportHTML(editor),
    focus: () => {
      editor.commands.focus()
    },
    exec: (commandId, payload) => {
      const command = resolved.commands[commandId]
      return command ? command(editor, payload) : false
    },
    has: (commandId) => commandId in resolved.commands,
    on: (event, callback) => {
      const name = event === 'selection' ? 'selectionUpdate' : 'update'
      editor.on(name, callback)
      return () => editor.off(name, callback)
    },
  }
}
