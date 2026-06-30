import { Blockquote } from '@tiptap/extension-blockquote'
import { defineFeature } from '../../editor'

/** Blockquote ("Quote"). */
export const QuoteFeature = defineFeature({
  id: 'quote',
  extensions: () => [Blockquote],
  commands: {
    'quote.toggle': (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
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
