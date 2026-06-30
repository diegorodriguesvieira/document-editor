import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { defineFeature } from '../../editor'

/** Horizontal rule / divider. */
export const DividerFeature = defineFeature({
  id: 'divider',
  extensions: () => [HorizontalRule],
  commands: {
    'divider.insert': (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  insert: [{ id: 'divider', label: 'Divisor', icon: 'D', commandId: 'divider.insert' }],
})
