import { defineFeature } from '../editor'

/**
 * APP-LEVEL feature — the living example of extending the editor without
 * touching the SDK: one `defineFeature` object contributes to three surfaces.
 * Note there is no `extensions()` payload at all: pure UI + commands.
 *
 * - `insert`  → a new item on the LEFT RAIL ("Insert date"), which also shows
 *               up in the `/` menu automatically.
 * - `toolbar` → a new TOP TOOLBAR action ("Clear formatting") with a real,
 *               declarative disabled state.
 * - `toolbar` + `group: 'selection'` → a BUBBLE-ONLY action ("Copy selection"):
 *               placement is decided by the consumer's `filter` — the top bar
 *               filters the 'selection' group out, the bubble keeps it.
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
  toolbar: [
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
      group: 'selection', // ← the bubble-only group (see App's toolbar filters)
      label: 'Copy selection',
      icon: '⧉',
      commandId: 'appExtras.copySelection',
      isDisabled: (state) => state.isSelectionEmpty(),
    },
  ],
})
