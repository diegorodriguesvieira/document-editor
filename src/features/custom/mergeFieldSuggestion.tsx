import { forwardRef, useMemo } from 'react'
import type { Extension } from '@tiptap/core'
import { createSuggestionPopup, useListKeyboardNav, type SuggestionPopupRef } from '../../editor'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'

/**
 * Floating list shown while typing `@…`. Reads the (consumer-provided)
 * variables from context and filters them by the typed query — so it stays in
 * sync with async-loaded variables without rebuilding the editor. Reuses the
 * `.slash-menu` look and the shared {@link useListKeyboardNav}.
 */
export const MergeFieldMenu = forwardRef<
  SuggestionPopupRef,
  { query: string; command: (variable: DocumentVariable) => void }
>(function MergeFieldMenu({ query, command }, ref) {
  const variables = useDocumentVariables()
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return variables
    // "starts with" the typed text, matched against any word of the label.
    return variables.filter((variable) =>
      variable.label
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
    )
  }, [variables, query])

  const { index, setIndex } = useListKeyboardNav(ref, items, command)

  if (items.length === 0) {
    return <div className="slash-menu slash-menu--empty">No variables found</div>
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Variables">
      {items.map((variable, i) => (
        <button
          key={variable.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className="slash-menu__item"
          data-active={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(event) => {
            event.preventDefault()
            command(variable)
          }}
        >
          <span className="slash-menu__icon">@</span>
          {variable.label}
        </button>
      ))}
    </div>
  )
})

/**
 * The chip + trailing-space payload BOTH insertion paths share (the `@`
 * suggestion here and the `mergeField.insert` command) — one shape, so the
 * "cursor isn't glued to the chip" rule can't drift between them.
 */
export function mergeFieldInsertContent(field: { id: string; label?: string }) {
  return [
    { type: 'mergeField', attrs: { id: field.id, label: field.label ?? field.id } },
    { type: 'text', text: ' ' },
  ]
}

/**
 * React-coupled `@` trigger: typing `@` opens {@link MergeFieldMenu}; picking a
 * variable replaces the `@query` with an inline merge-field chip (+ a trailing
 * space). Built from the shared {@link createSuggestionPopup} primitive.
 */
export function createMergeFieldSuggestion(): Extension {
  return createSuggestionPopup<DocumentVariable, DocumentVariable>({
    name: 'mergeFieldSuggestion',
    char: '@',
    component: MergeFieldMenu,
    // The popup owns filtering (it reads variables from context), so the
    // plugin's own item list is unused.
    items: () => [],
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).insertContent(mergeFieldInsertContent(props)).run()
    },
  })
}
