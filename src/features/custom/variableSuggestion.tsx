import { forwardRef, useMemo } from 'react'
import type { Extension } from '@tiptap/core'
import {
  createSuggestionPopup,
  SuggestionList,
  useListKeyboardNav,
  type SuggestionPopupRef,
} from '../../editor'
import { useDocumentVariables, type DocumentVariable } from './documentVariables'

/**
 * Floating list shown while typing `@…`. Reads the (consumer-provided)
 * variables from context and filters them by the typed query — so it stays in
 * sync with async-loaded variables without rebuilding the editor. Reuses the
 * `.slash-menu` look and the shared {@link useListKeyboardNav}.
 */
export const VariableMenu = forwardRef<
  SuggestionPopupRef,
  { query: string; command: (variable: DocumentVariable) => void }
>(function VariableMenu({ query, command }, ref) {
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

  return (
    <SuggestionList
      items={items}
      index={index}
      setIndex={setIndex}
      onPick={command}
      ariaLabel="Variables"
      emptyText="No variables found"
      itemKey={(variable) => variable.id}
      icon={() => '@'}
      label={(variable) => variable.label}
    />
  )
})

/**
 * The chip + trailing-space payload BOTH insertion paths share (the `@`
 * suggestion here and the `variable.insert` command) — one shape, so the
 * "cursor isn't glued to the chip" rule can't drift between them.
 */
export function variableInsertContent(field: { id: string; label?: string }) {
  return [
    { type: 'variable', attrs: { id: field.id, label: field.label ?? field.id } },
    { type: 'text', text: ' ' },
  ]
}

/**
 * React-coupled `@` trigger: typing `@` opens {@link VariableMenu}; picking a
 * variable replaces the `@query` with an inline variable chip (+ a trailing
 * space). Built from the shared {@link createSuggestionPopup} primitive.
 */
export function createVariableNodeSuggestion(): Extension {
  return createSuggestionPopup<DocumentVariable, DocumentVariable>({
    name: 'variableSuggestion',
    char: '@',
    component: VariableMenu,
    // The popup owns filtering (it reads variables from context), so the
    // plugin's own item list is unused.
    items: () => [],
    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).insertContent(variableInsertContent(props)).run()
    },
  })
}
