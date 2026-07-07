import { Italic } from '@tiptap/extension-italic'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

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
      label: 'Italic',
      icon: icons.italic,
      commandId: 'italic.toggle',
      isActive: (state) => state.isActive('italic'),
    },
  ],
})
