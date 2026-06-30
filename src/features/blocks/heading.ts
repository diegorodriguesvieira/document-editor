import { Heading } from '@tiptap/extension-heading'
import { defineFeature } from '../../editor'

/** Headings H1–H3. */
export const HeadingFeature = defineFeature({
  id: 'heading',
  extensions: () => [Heading.configure({ levels: [1, 2, 3] })],
  commands: {
    'heading.h1': (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    'heading.h2': (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    'heading.h3': (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  toolbar: [
    {
      id: 'h1',
      group: 'blocks',
      label: 'Heading 1',
      icon: 'H1',
      commandId: 'heading.h1',
      isActive: (state) => state.isActive('heading', { level: 1 }),
    },
    {
      id: 'h2',
      group: 'blocks',
      label: 'Heading 2',
      icon: 'H2',
      commandId: 'heading.h2',
      isActive: (state) => state.isActive('heading', { level: 2 }),
    },
    {
      id: 'h3',
      group: 'blocks',
      label: 'Heading 3',
      icon: 'H3',
      commandId: 'heading.h3',
      isActive: (state) => state.isActive('heading', { level: 3 }),
    },
  ],
})
