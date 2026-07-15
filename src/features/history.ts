import { UndoRedo } from '@tiptap/extensions'
import { defineFeature } from '../editor'
import { icons } from './icons'

/** Undo/redo (TipTap v3 renamed History → UndoRedo, now in @tiptap/extensions). */
export const HistoryFeature = defineFeature({
  id: 'history',
  extensions: () => [UndoRedo],
  commands: {
    'history.undo': (editor) => editor.chain().focus().undo().run(),
    'history.redo': (editor) => editor.chain().focus().redo().run(),
  },
  bubble: [
    {
      id: 'undo',
      group: 'history',
      label: 'Undo',
      icon: icons.undo,
      commandId: 'history.undo',
      isDisabled: (state) => !state.canUndo(),
    },
    {
      id: 'redo',
      group: 'history',
      label: 'Redo',
      icon: icons.redo,
      commandId: 'history.redo',
      isDisabled: (state) => !state.canRedo(),
    },
  ],
})
