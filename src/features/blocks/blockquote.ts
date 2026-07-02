import { Blockquote } from '@tiptap/extension-blockquote'
import { defineFeature } from '../../editor'

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
      icon: 'Q',
      commandId: 'quote.toggle',
      isActive: (state) => state.isActive('blockquote'),
    },
  ],
})
