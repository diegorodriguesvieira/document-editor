import { Italic } from '@tiptap/extension-italic'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Italic mark. Its own Mod-i shortcut comes from the extension.
 *
 *  Contributes — bubble: "Italic" · command: `italic.toggle`. */
export const ItalicFeature = defineFeature({
  id: 'italic',
  extensions: () => [Italic],
  commands: {
    'italic.toggle': (editor) => editor.chain().focus().toggleItalic().run(),
  },
  bubble: [
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
