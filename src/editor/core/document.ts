import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

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

/**
 * Whether a top-level node of this type exists in `doc` — the check behind
 * `api.hasNode`, shared so feature commands holding a raw doc use the same
 * definition instead of re-rolling it.
 */
export function hasTopLevelNode(doc: PMNode, name: string): boolean {
  for (let i = 0; i < doc.childCount; i++) {
    if (doc.child(i).type.name === name) return true
  }
  return false
}

/**
 * Whether the document is still the BLANK initial document: exactly one empty
 * paragraph (what {@link createEmptyDocument} produces). This is the check
 * behind `api.isEmpty` and the empty-state overlay — deliberately NOT
 * TipTap's `editor.isEmpty`, which means "no text" and stays true for
 * structure without words (a freshly inserted table is all empty cells; same
 * for a callout or blockquote). Structure IS content: only the true blank
 * slate counts as empty.
 */
export function isBlankDocument(doc: PMNode): boolean {
  if (doc.childCount === 0) return true
  if (doc.childCount > 1) return false
  const only = doc.child(0)
  return only.type.name === 'paragraph' && only.childCount === 0
}
