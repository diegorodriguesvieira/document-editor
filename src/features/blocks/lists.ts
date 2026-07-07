import { BulletList } from '@tiptap/extension-bullet-list'
import { OrderedList } from '@tiptap/extension-ordered-list'
import { ListItem } from '@tiptap/extension-list-item'
import { defineFeature } from '../../editor'
import { icons } from '../icons'

/** Bullet and ordered lists (bundles the shared ListItem node). */
export const ListsFeature = defineFeature({
  id: 'lists',
  extensions: () => [BulletList, OrderedList, ListItem],
  commands: {
    'lists.bullet': (editor) => editor.chain().focus().toggleBulletList().run(),
    'lists.ordered': (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  toolbar: [
    {
      id: 'bulletList',
      group: 'blocks',
      label: 'Bullet list',
      icon: icons.bulletList,
      commandId: 'lists.bullet',
      isActive: (state) => state.isActive('bulletList'),
    },
    {
      id: 'orderedList',
      group: 'blocks',
      label: 'Numbered list',
      icon: icons.orderedList,
      commandId: 'lists.ordered',
      isActive: (state) => state.isActive('orderedList'),
    },
  ],
})
