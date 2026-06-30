import { Blockquote } from '@tiptap/extension-blockquote'
import { defineFeature } from '../../editor'

/** Blockquote ("Citação"). */
export const QuoteFeature = defineFeature({
  id: 'quote',
  extensions: () => [Blockquote],
  commands: {
    'quote.toggle': (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  insert: [
    {
      id: 'quote',
      label: 'Citação',
      icon: 'Q',
      commandId: 'quote.toggle',
      isActive: (state) => state.isActive('blockquote'),
    },
  ],
})
