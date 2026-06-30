import type { Editor, JSONContent } from '@tiptap/core'

/**
 * Canonical, persistable document envelope. We commit to ProseMirror JSON as the
 * contract — the real insurance against a future engine swap is portability of
 * *data*, not of the engine. (A thin envelope, with room for metadata like a
 * title or page regions later.)
 */
export interface DocumentJSON {
  doc: JSONContent
}

export function createEmptyDocument(): DocumentJSON {
  return { doc: { type: 'doc', content: [{ type: 'paragraph' }] } }
}

export function toDocumentJSON(editor: Editor): DocumentJSON {
  return { doc: editor.getJSON() }
}

/** Rendered HTML, suitable to cache for read-only display. */
export function exportHTML(editor: Editor): string {
  return editor.getHTML()
}
