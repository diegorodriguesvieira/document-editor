import { defineFeature } from '../editor'

/**
 * APP-LEVEL feature — the living example of extending the editor without
 * touching the SDK: one `defineFeature` object contributes to both surfaces.
 * Note there is no `extensions()` payload at all: pure UI + commands.
 *
 * - `insert`  → a new item on the FOOTER DOCK ("Insert date"), which also
 *               shows up in the `/` menu automatically.
 * - `bubble`  → actions for the BUBBLE (the only toolbar surface): "Clear
 *               formatting" with a real declarative disabled state, and "Copy
 *               selection". Placement stays a consumer decision via `filter` —
 *               the app keeps the 'history' group out of the bubble.
 */
export const AppExtrasFeature = defineFeature({
  id: 'app-extras',
  extensions: () => [],
  commands: {
    'appExtras.insertDate': (editor) =>
      editor.chain().focus().insertContent(new Date().toLocaleDateString()).run(),
    'appExtras.clearFormatting': (editor) => editor.chain().focus().unsetAllMarks().run(),
    'appExtras.copySelection': (editor) => {
      const { from, to, empty } = editor.state.selection
      if (empty) return false
      void navigator.clipboard?.writeText(editor.state.doc.textBetween(from, to, ' '))
      return true
    },
  },
  insert: [
    { id: 'insert-date', label: 'Insert date', icon: '📅', commandId: 'appExtras.insertDate' },
  ],
  bubble: [
    {
      id: 'clear-formatting',
      group: 'actions',
      label: 'Clear formatting',
      icon: '🧹',
      commandId: 'appExtras.clearFormatting',
      isDisabled: (state) => state.isSelectionEmpty(),
    },
    {
      id: 'copy-selection',
      group: 'selection', // selection-scoped actions (they disable on a caret)
      label: 'Copy selection',
      icon: '⧉',
      commandId: 'appExtras.copySelection',
      isDisabled: (state) => state.isSelectionEmpty(),
    },
  ],
})
