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
    { id: 'undo', group: 'history', label: 'Desfazer', icon: '↶', commandId: 'history.undo' },
    { id: 'redo', group: 'history', label: 'Refazer', icon: '↷', commandId: 'history.redo' },
  ],
})
