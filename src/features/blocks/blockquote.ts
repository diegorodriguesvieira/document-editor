import { Blockquote } from '@tiptap/extension-blockquote'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Blockquote ("Quote"). */
export const QuoteFeature = defineFeature({
  id: 'quote',
  extensions: () => [Blockquote],
  commands: {
    'quote.toggle': (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  // Both spellings: layouts differ on whether Shift+' reports as `"`.
  keymap: { "Mod-Shift-'": 'quote.toggle', 'Mod-"': 'quote.toggle' },
  insert: [
    {
      id: 'quote',
      label: 'Quote',
      icon: icons.quote,
      commandId: 'quote.toggle',
      isActive: (state) => state.isActive('blockquote'),
    },
  ],
})
