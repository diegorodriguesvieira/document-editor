import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

/**
 * Thin wrapper over TipTap's `useEditorState` — the *only* place in the app
 * that knows about that hook. Reads a slice of editor state reactively, with
 * the same selector + equality optimization (no re-render unless the slice
 * changes). Encapsulating it here is what keeps React↔engine coupling in one
 * spot instead of leaking into every component.
 */
export function useFeatureState<T>(
  editor: Editor | null,
  selector: (editor: Editor) => T,
): T | null {
  return useEditorState({
    editor,
    // v3 still invokes the selector with a null editor while none is mounted.
    selector: (snapshot) => (snapshot.editor ? selector(snapshot.editor) : null),
  })
}
