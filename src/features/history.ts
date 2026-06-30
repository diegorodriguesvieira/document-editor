import { UndoRedo } from '@tiptap/extensions'
import { defineFeature } from '../editor'

/** Undo/redo (TipTap v3 renamed History → UndoRedo, now in @tiptap/extensions). */
export const HistoryFeature = defineFeature({
  id: 'history',
  extensions: () => [UndoRedo],
  commands: {
    'history.undo': (editor) => editor.chain().focus().undo().run(),
    'history.redo': (editor) => editor.chain().focus().redo().run(),
  },
  toolbar: [
    {
      id: 'undo',
      group: 'history',
      label: 'Undo',
      icon: '↶',
      commandId: 'history.undo',
      isDisabled: (state) => !state.canUndo(),
    },
    {
      id: 'redo',
      group: 'history',
      label: 'Redo',
      icon: '↷',
      commandId: 'history.redo',
      isDisabled: (state) => !state.canRedo(),
    },
  ],
})
