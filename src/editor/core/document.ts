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
