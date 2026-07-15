import { Bold } from '@tiptap/extension-bold'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Bold mark. Its own Mod-b shortcut comes from the extension.
 *
 *  Contributes — bubble: "Bold" · command: `bold.toggle`. */
export const BoldFeature = defineFeature({
  id: 'bold',
  extensions: () => [Bold],
  commands: {
    'bold.toggle': (editor) => editor.chain().focus().toggleBold().run(),
  },
  bubble: [
    {
      id: 'bold',
      group: 'marks',
      label: 'Bold',
      icon: icons.bold,
      commandId: 'bold.toggle',
      isActive: (state) => state.isActive('bold'),
    },
  ],
})
