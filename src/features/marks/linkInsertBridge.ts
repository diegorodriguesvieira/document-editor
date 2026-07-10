import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'

/**
 * UI-intent bridge for the insert-link form. A keyboard shortcut can't open a
 * React popover directly — commands run on the editor, not on component state —
 * so `LinkInsertControl` parks an opener here on mount and the `link.openInsert`
 * command (bound to Mod-k) calls it. It lives in its own tiny extension so it
 * never touches the Link mark's own storage.
 */
export interface LinkInsertBridge {
  /** Set by the mounted insert-link control; `null` when no dock is rendered. */
  open: (() => void) | null
}

export const LinkInsertBridgeExtension = Extension.create({
  name: 'linkInsertBridge',
  addStorage(): LinkInsertBridge {
    return { open: null }
  },
})

/** The one typed accessor for the bridge storage (mirrors the comments seam). */
export function linkInsertBridge(editor: Editor): LinkInsertBridge {
  return (editor.storage as unknown as { linkInsertBridge: LinkInsertBridge }).linkInsertBridge
}
