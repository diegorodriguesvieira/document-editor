import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Horizontal rule / divider.
 *
 *  Contributes — insert: "Divider" · command: `divider.insert`. */
export const DividerFeature = defineFeature({
  id: 'divider',
  extensions: () => [HorizontalRule],
  commands: {
    'divider.insert': (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  insert: [{ id: 'divider', label: 'Divider', icon: icons.divider, commandId: 'divider.insert' }],
})
