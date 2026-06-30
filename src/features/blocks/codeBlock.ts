import { CodeBlock } from '@tiptap/extension-code-block'
import { defineFeature } from '../../editor'

/** Fenced code block. */
export const CodeBlockFeature = defineFeature({
  id: 'codeBlock',
  extensions: () => [CodeBlock],
  commands: {
    'codeBlock.toggle': (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  insert: [
    {
      id: 'codeBlock',
      label: 'Bloco de código',
      icon: 'C',
      commandId: 'codeBlock.toggle',
      isActive: (state) => state.isActive('codeBlock'),
    },
  ],
})
