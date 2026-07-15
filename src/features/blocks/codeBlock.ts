import { CodeBlock } from '@tiptap/extension-code-block'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Fenced code block.
 *
 *  Contributes — insert: "Code block" · command: `codeBlock.toggle` ·
 *  keymap: Mod-Shift-c. */
export const CodeBlockFeature = defineFeature({
  id: 'codeBlock',
  extensions: () => [CodeBlock],
  commands: {
    'codeBlock.toggle': (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  keymap: { 'Mod-Shift-c': 'codeBlock.toggle' },
  insert: [
    {
      id: 'codeBlock',
      label: 'Code block',
      icon: icons.code,
      commandId: 'codeBlock.toggle',
      isActive: (state) => state.isActive('codeBlock'),
    },
  ],
})
