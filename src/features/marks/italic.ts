import { Italic } from '@tiptap/extension-italic'
import { defineFeature } from '../../editor'

/** Italic mark. Its own Mod-i shortcut comes from the extension. */
export const ItalicFeature = defineFeature({
  id: 'italic',
  extensions: () => [Italic],
  commands: {
    'italic.toggle': (editor) => editor.chain().focus().toggleItalic().run(),
  },
  toolbar: [
    {
      id: 'italic',
      group: 'marks',
      label: 'Itálico',
      icon: 'I',
      commandId: 'italic.toggle',
      isActive: (state) => state.isActive('italic'),
    },
  ],
})
