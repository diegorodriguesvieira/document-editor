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
}

/**
 * The stable facade the app talks to instead of the raw TipTap `Editor`.
 * Light by design (engine-swap is hygiene, not a real requirement) — its job
 * is to keep `@tiptap/*` out of product code, not to make the engine swappable.
 */
export interface EditorApi extends EditorStateView {
  getJSON(): DocumentJSON
  setJSON(doc: DocumentJSON): void
  getHTML(): string
  /** Return focus to the editor (e.g. after a modal/popover closes). */
  focus(): void
  exec(commandId: string, payload?: unknown): boolean
  can(commandId: string): boolean
  on(event: 'update' | 'selection', callback: () => void): () => void
}

export function createEditorApi(editor: Editor, resolved: ResolvedFeatures): EditorApi {
  return {
    isActive: (name, attrs) => editor.isActive(name, attrs),
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
    can: (commandId) => commandId in resolved.commands,
    on: (event, callback) => {
      const name = event === 'selection' ? 'selectionUpdate' : 'update'
      editor.on(name, callback)
      return () => editor.off(name, callback)
    },
  }
}
