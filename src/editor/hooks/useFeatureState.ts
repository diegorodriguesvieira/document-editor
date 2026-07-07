import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

/**
 * Thin wrapper over TipTap's `useEditorState` — the seam feature UI reads
 * editor state through (only this file and `useToolbar`, which predates it,
 * touch the raw hook). Same selector + equality optimization: no re-render
 * unless the slice changes. Encapsulating it here keeps React↔engine coupling
 * from leaking into every component.
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
