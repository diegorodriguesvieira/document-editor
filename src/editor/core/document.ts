import type { Editor, JSONContent } from '@tiptap/core'

/** Bump when the persisted document shape changes; drives migrations later. */
export const SCHEMA_VERSION = 1

/**
 * Canonical, persistable document. We commit to ProseMirror JSON (versioned)
 * as the contract — this is the real insurance against a future engine swap:
 * portability of *data*, not of the engine.
 */
export interface DocumentJSON {
  schemaVersion: number
  doc: JSONContent
}

export function createEmptyDocument(): DocumentJSON {
  return {
    schemaVersion: SCHEMA_VERSION,
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  }
}

export function toDocumentJSON(editor: Editor): DocumentJSON {
  return { schemaVersion: SCHEMA_VERSION, doc: editor.getJSON() }
}

/** Rendered HTML, suitable to cache for read-only display. */
export function exportHTML(editor: Editor): string {
  return editor.getHTML()
}
